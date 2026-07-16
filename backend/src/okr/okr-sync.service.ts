import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { LarkService } from '../shared/lark/lark.service';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';

/** OKR 同步状态（存 Redis，供管理端轮询）。 */
export type OkrSyncStatus = {
  status: 'idle' | 'running' | 'success' | 'partial_success' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  users?: number;
  processedUsers?: number;
  failedUsers?: number;
  categories?: number;
  cycles?: number;
  objectives?: number;
  keyResults?: number;
  indicators?: number;
  progresses?: number;
  alignments?: number;
  /** 分类是目标的可选逻辑引用，分类权限不足不会阻断员工核心 OKR。 */
  categoryError?: string;
  /** 单个员工失败不阻断其他员工；这里只保留简短错误，便于定位权限或数据问题。 */
  userErrors?: Array<{ openId: string; error: string }>;
  error?: string;
};

type OkrSyncCounts = Required<
  Pick<
    OkrSyncStatus,
    | 'cycles'
    | 'objectives'
    | 'keyResults'
    | 'indicators'
    | 'progresses'
    | 'alignments'
  >
>;

type LarkClient = ReturnType<LarkService['getClient']>;
type OkrV2Client = LarkClient['okr']['v2'];

/** 从 SDK 的 WithIterator 返回类型中提取单条 item，避免手抄一套易漂移的 OKR 类型。 */
type IteratorItem<T> =
  Awaited<T> extends {
    [Symbol.asyncIterator](): AsyncGenerator<infer Page, void, unknown>;
  }
    ? NonNullable<Page> extends { items?: Array<infer Item> }
      ? Item
      : never
    : never;

type OkrCategoryItem = IteratorItem<
  ReturnType<OkrV2Client['okrCategory']['listWithIterator']>
>;
type OkrCycleItem = IteratorItem<
  ReturnType<OkrV2Client['okrCycle']['listWithIterator']>
>;
type OkrObjectiveItem = IteratorItem<
  ReturnType<OkrV2Client['okrCycleObjective']['listWithIterator']>
>;
type OkrKeyResultItem = IteratorItem<
  ReturnType<OkrV2Client['okrObjectiveKeyResult']['listWithIterator']>
>;
type OkrProgressItem = IteratorItem<
  ReturnType<OkrV2Client['okrObjectiveProgress']['listWithIterator']>
>;
type OkrAlignmentItem = IteratorItem<
  ReturnType<OkrV2Client['okrObjectiveAlignment']['listWithIterator']>
>;
type OkrIndicatorItem = NonNullable<
  NonNullable<
    Awaited<ReturnType<OkrV2Client['okrObjectiveIndicator']['list']>>['data']
  >['indicator']
>;

const SYNC_LOCK_KEY = 'okr:sync:lock';
const SYNC_STATUS_KEY = 'okr:sync:status';
const USER_SYNC_LOCK_PREFIX = 'okr:sync:user:lock:';
const USER_SYNC_STATUS_PREFIX = 'okr:sync:user:status:';
// 员工量较大时会串行访问多层分页接口，锁保留 2 小时防止重复全量同步。
const SYNC_LOCK_TTL_SECONDS = 7200;
// 单人同步同样可能遍历多个周期和子资源，30 分钟内不重复向飞书发起同一员工同步。
const USER_SYNC_LOCK_TTL_SECONDS = 1800;
const USER_SYNC_STATUS_TTL_SECONDS = 86400;
const PAGE_SIZE = 100;
const MAX_STATUS_ERRORS = 50;

const emptyCounts = (): OkrSyncCounts => ({
  cycles: 0,
  objectives: 0,
  keyResults: 0,
  indicators: 0,
  progresses: 0,
  alignments: 0,
});

const addCounts = (target: OkrSyncCounts, source: OkrSyncCounts) => {
  target.cycles += source.cycles;
  target.objectives += source.objectives;
  target.keyResults += source.keyResults;
  target.indicators += source.indicators;
  target.progresses += source.progresses;
  target.alignments += source.alignments;
};

/** SDK 字段从有值变为缺省时必须清空旧值，不能让 Prisma 因 undefined 跳过更新。 */
const asNullableJson = (value: unknown) =>
  value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);

type LarkBadRequestDetails = {
  request: {
    method?: string;
    url?: string;
    params?: unknown;
    data?: unknown;
  };
  error: {
    httpStatus: number;
    response: unknown;
    message: string;
  };
};

/** SDK 抛出的是 Axios 风格错误；仅识别 HTTP 400，其他异常必须继续上抛。 */
const getLarkBadRequestDetails = (
  error: unknown,
): LarkBadRequestDetails | null => {
  if (!error || typeof error !== 'object') return null;

  const response = (
    error as {
      response?: {
        status?: number;
        data?: unknown;
      };
    }
  ).response;
  if (response?.status !== 400) return null;

  const config = (
    error as {
      config?: {
        method?: string;
        url?: string;
        params?: unknown;
        data?: unknown;
      };
    }
  ).config;
  const responseData = response.data;
  const responseMessage =
    responseData && typeof responseData === 'object' && 'msg' in responseData
      ? String(responseData.msg)
      : error instanceof Error
        ? error.message
        : 'Bad Request';

  return {
    // 严格白名单提取请求信息，不记录 Authorization、token 等敏感请求头。
    request: {
      method: config?.method,
      url: config?.url,
      params: config?.params,
      data: config?.data,
    },
    error: {
      httpStatus: response.status,
      response: responseData,
      message: responseMessage,
    },
  };
};

@Injectable()
export class OkrSyncService {
  private readonly logger = new Logger(OkrSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly larkService: LarkService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 触发一次全量员工 OKR 同步；后台执行，接口立即返回 running。 */
  async triggerSync(): Promise<OkrSyncStatus> {
    const locked = await this.redis.set(
      SYNC_LOCK_KEY,
      new Date().toISOString(),
      'EX',
      SYNC_LOCK_TTL_SECONDS,
      'NX',
    );
    if (!locked) {
      throw new ConflictException('已有 OKR 同步任务在执行中，请稍后再试');
    }

    const status: OkrSyncStatus = {
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await this.writeStatus(status);

    void this.runFullSync(status).finally(() => {
      void this.redis.del(SYNC_LOCK_KEY);
    });

    return status;
  }

  async getStatus(): Promise<OkrSyncStatus> {
    const raw = await this.redis.get(SYNC_STATUS_KEY);
    return raw ? (JSON.parse(raw) as OkrSyncStatus) : { status: 'idle' };
  }

  /**
   * 触发指定员工的增量式全量刷新。接口幂等：已有同人任务时返回其 running 状态，
   * 供员工自评、360°和上级评估页面同时复用。
   */
  async triggerUserSync(openId: string): Promise<OkrSyncStatus> {
    const lockKey = this.userLockKey(openId);
    const locked = await this.redis.set(
      lockKey,
      new Date().toISOString(),
      'EX',
      USER_SYNC_LOCK_TTL_SECONDS,
      'NX',
    );
    if (!locked) {
      const current = await this.getUserStatus(openId);
      return current.status === 'idle' ? { status: 'running' } : current;
    }

    const status: OkrSyncStatus = {
      status: 'running',
      startedAt: new Date().toISOString(),
      users: 1,
      processedUsers: 0,
      failedUsers: 0,
    };
    await this.writeUserStatus(openId, status);

    void this.runUserSync(openId, status).finally(() => {
      void this.redis.del(lockKey);
    });
    return status;
  }

  async getUserStatus(openId: string): Promise<OkrSyncStatus> {
    const raw = await this.redis.get(this.userStatusKey(openId));
    return raw ? (JSON.parse(raw) as OkrSyncStatus) : { status: 'idle' };
  }

  private async writeStatus(status: OkrSyncStatus) {
    await this.redis.set(SYNC_STATUS_KEY, JSON.stringify(status));
  }

  private async writeUserStatus(openId: string, status: OkrSyncStatus) {
    await this.redis.set(
      this.userStatusKey(openId),
      JSON.stringify(status),
      'EX',
      USER_SYNC_STATUS_TTL_SECONDS,
    );
  }

  private userLockKey(openId: string) {
    return `${USER_SYNC_LOCK_PREFIX}${encodeURIComponent(openId)}`;
  }

  private userStatusKey(openId: string) {
    return `${USER_SYNC_STATUS_PREFIX}${encodeURIComponent(openId)}`;
  }

  /** 单人所有 SDK 层级成功后才清陈旧快照；失败时继续保留页面可展示的缓存。 */
  private async runUserSync(openId: string, status: OkrSyncStatus) {
    const syncStartedAt = new Date(status.startedAt ?? Date.now());
    try {
      const counts = await this.syncUser(openId);
      await this.cleanupStaleUserData(openId, syncStartedAt);
      Object.assign(status, counts, {
        status: 'success',
        processedUsers: 1,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Object.assign(status, {
        status: 'failed',
        failedUsers: 1,
        error: message,
        userErrors: [{ openId, error: message }],
        finishedAt: new Date().toISOString(),
      });
      this.logger.warn(`员工 ${openId} 的页面 OKR 同步失败：${message}`);
    } finally {
      await this.writeUserStatus(openId, status);
    }
  }

  /**
   * 先同步租户分类，再以本地通讯录员工 open_id 串行拉取 OKR。
   * 串行访问用于降低并发峰值；开放平台若返回限频错误，会按员工记录失败并允许后续重跑。
   */
  private async runFullSync(status: OkrSyncStatus) {
    const syncStartedAt = new Date(status.startedAt ?? Date.now());
    try {
      // 分类权限与员工 OKR 内容权限相互独立，分类失败时保留 category_id 继续主流程。
      try {
        status.categories = await this.syncCategories();
        await this.prisma.larkOkrCategory.deleteMany({
          where: { synced_at: { lt: syncStartedAt } },
        });
      } catch (error) {
        status.categoryError =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `OKR 分类同步失败（继续同步员工 OKR）：${status.categoryError}`,
        );
      }

      const users = await this.prisma.larkUser.findMany({
        select: { open_id: true },
        orderBy: { open_id: 'asc' },
      });
      status.users = users.length;

      const total = emptyCounts();
      const userErrors: Array<{ openId: string; error: string }> = [];

      for (const user of users) {
        try {
          addCounts(total, await this.syncUser(user.open_id));
          // 只有该员工全部层级拉取成功后才清理陈旧行，避免权限/网络失败误删本地快照。
          await this.cleanupStaleUserData(user.open_id, syncStartedAt);
          status.processedUsers = (status.processedUsers ?? 0) + 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          userErrors.push({ openId: user.open_id, error: message });
          this.logger.warn(`员工 ${user.open_id} 的 OKR 同步失败：${message}`);
        }
      }

      Object.assign(status, total);
      status.failedUsers = userErrors.length;
      status.userErrors = userErrors.length
        ? userErrors.slice(0, MAX_STATUS_ERRORS)
        : undefined;
      if (users.length > 0 && userErrors.length === users.length) {
        status.status = 'failed';
        status.error =
          '所有员工的 OKR 同步均失败，请检查应用权限和数据访问范围';
      } else if (userErrors.length > 0 || status.categoryError) {
        status.status = 'partial_success';
      } else {
        status.status = 'success';
      }
      status.finishedAt = new Date().toISOString();

      this.logger.log(
        `OKR 同步完成：员工 ${users.length - userErrors.length}/${users.length}，` +
          `周期 ${total.cycles}，目标 ${total.objectives}，关键结果 ${total.keyResults}，` +
          `指标 ${total.indicators}，进展 ${total.progresses}，对齐 ${total.alignments}`,
      );
    } catch (error) {
      status.status = 'failed';
      status.finishedAt = new Date().toISOString();
      status.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`OKR 全量同步失败：${status.error}`);
    } finally {
      await this.writeStatus(status);
    }
  }

  private async syncCategories(): Promise<number> {
    const iterator = await this.larkService
      .getClient()
      .okr.v2.okrCategory.listWithIterator({
        params: { page_size: PAGE_SIZE },
      });
    let synced = 0;

    for await (const page of iterator) {
      for (const item of page?.items ?? []) {
        await this.upsertCategory(item);
        synced += 1;
      }
    }

    return synced;
  }

  private async syncUser(openId: string): Promise<OkrSyncCounts> {
    const client = this.larkService.getClient();
    const counts = emptyCounts();
    let pageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await client.okr.v2.okrCycle.list({
        params: {
          user_id: openId,
          user_id_type: 'open_id',
          page_size: PAGE_SIZE,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
      if (response.code !== 0) {
        throw new Error(
          `获取员工 OKR 周期失败（code=${response.code ?? 'unknown'}）：${response.msg ?? 'unknown error'}`,
        );
      }

      const page = response.data;
      for (const cycle of page?.items ?? []) {
        await this.upsertCycle(cycle, openId);
        counts.cycles += 1;
        addCounts(
          counts,
          await this.continueOnBadRequest(
            `周期 ${cycle.id} 的目标`,
            () => this.syncCycleObjectives(cycle.id, openId),
            emptyCounts,
          ),
        );
      }

      hasMore = page?.has_more ?? false;
      if (!hasMore) continue;
      const nextPageToken = page?.page_token;
      if (!nextPageToken || nextPageToken === pageToken) {
        // has_more=true 却没有新的游标时继续请求会死循环，也会把不完整数据误判为成功。
        throw new Error('获取员工 OKR 周期失败：飞书未返回有效的下一页标记');
      }
      pageToken = nextPageToken;
    }

    return counts;
  }

  private async syncCycleObjectives(
    cycleId: string,
    fallbackOwnerOpenId: string,
  ): Promise<OkrSyncCounts> {
    const client = this.larkService.getClient();
    const counts = emptyCounts();
    const iterator = await client.okr.v2.okrCycleObjective.listWithIterator({
      path: { cycle_id: cycleId },
      params: {
        page_size: PAGE_SIZE,
        user_id_type: 'open_id',
        department_id_type: 'open_department_id',
      },
    });

    for await (const page of iterator) {
      for (const objective of page?.items ?? []) {
        await this.upsertObjective(objective, fallbackOwnerOpenId);
        counts.objectives += 1;

        const ownerOpenId = objective.owner.user_id ?? fallbackOwnerOpenId;
        counts.indicators += await this.continueOnBadRequest(
          `目标 ${objective.id} 的指标`,
          () => this.syncObjectiveIndicator(objective.id, ownerOpenId),
          () => 0,
        );
        counts.progresses += await this.continueOnBadRequest(
          `目标 ${objective.id} 的进展`,
          () => this.syncObjectiveProgresses(objective.id, ownerOpenId),
          () => 0,
        );
        counts.alignments += await this.continueOnBadRequest(
          `目标 ${objective.id} 的对齐关系`,
          () => this.syncObjectiveAlignments(objective.id, ownerOpenId),
          () => 0,
        );
        addCounts(
          counts,
          await this.continueOnBadRequest(
            `目标 ${objective.id} 的关键结果`,
            () => this.syncObjectiveKeyResults(objective.id, ownerOpenId),
            emptyCounts,
          ),
        );
      }
    }

    return counts;
  }

  private async syncObjectiveKeyResults(
    objectiveId: string,
    fallbackOwnerOpenId: string,
  ): Promise<OkrSyncCounts> {
    const client = this.larkService.getClient();
    const counts = emptyCounts();
    const iterator = await client.okr.v2.okrObjectiveKeyResult.listWithIterator(
      {
        path: { objective_id: objectiveId },
        params: {
          page_size: PAGE_SIZE,
          user_id_type: 'open_id',
          department_id_type: 'open_department_id',
        },
      },
    );

    for await (const page of iterator) {
      for (const keyResult of page?.items ?? []) {
        await this.upsertKeyResult(keyResult, fallbackOwnerOpenId);
        counts.keyResults += 1;
        const ownerOpenId = keyResult.owner.user_id ?? fallbackOwnerOpenId;
        counts.indicators += await this.continueOnBadRequest(
          `关键结果 ${keyResult.id} 的指标`,
          () => this.syncKeyResultIndicator(keyResult.id, ownerOpenId),
          () => 0,
        );
        counts.progresses += await this.continueOnBadRequest(
          `关键结果 ${keyResult.id} 的进展`,
          () => this.syncKeyResultProgresses(keyResult.id, ownerOpenId),
          () => 0,
        );
      }
    }

    return counts;
  }

  private async syncObjectiveIndicator(
    objectiveId: string,
    fallbackOwnerOpenId: string,
  ): Promise<number> {
    const response = await this.larkService
      .getClient()
      .okr.v2.okrObjectiveIndicator.list({
        path: { objective_id: objectiveId },
        params: {
          user_id_type: 'open_id',
          department_id_type: 'open_department_id',
        },
      });
    const indicator = response.data?.indicator;
    if (!indicator) return 0;

    await this.upsertIndicator(indicator, fallbackOwnerOpenId);
    return 1;
  }

  private async syncKeyResultIndicator(
    keyResultId: string,
    fallbackOwnerOpenId: string,
  ): Promise<number> {
    const response = await this.larkService
      .getClient()
      .okr.v2.okrKeyResultIndicator.list({
        path: { key_result_id: keyResultId },
        params: {
          user_id_type: 'open_id',
          department_id_type: 'open_department_id',
        },
      });
    const indicator = response.data?.indicator;
    if (!indicator) return 0;

    // 目标与关键结果指标在 SDK 中使用相同的数据结构。
    await this.upsertIndicator(indicator, fallbackOwnerOpenId);
    return 1;
  }

  private async syncObjectiveProgresses(
    objectiveId: string,
    fallbackOwnerOpenId: string,
  ): Promise<number> {
    const iterator = await this.larkService
      .getClient()
      .okr.v2.okrObjectiveProgress.listWithIterator({
        path: { objective_id: objectiveId },
        params: {
          page_size: PAGE_SIZE,
          user_id_type: 'open_id',
          department_id_type: 'open_department_id',
        },
      });
    return this.consumeProgressIterator(iterator, fallbackOwnerOpenId);
  }

  private async syncKeyResultProgresses(
    keyResultId: string,
    fallbackOwnerOpenId: string,
  ): Promise<number> {
    const iterator = await this.larkService
      .getClient()
      .okr.v2.okrKeyResultProgress.listWithIterator({
        path: { key_result_id: keyResultId },
        params: {
          page_size: PAGE_SIZE,
          user_id_type: 'open_id',
          department_id_type: 'open_department_id',
        },
      });
    // 目标与关键结果进展在 SDK 中使用相同的数据结构。
    return this.consumeProgressIterator(iterator, fallbackOwnerOpenId);
  }

  private async consumeProgressIterator(
    iterator: Awaited<
      ReturnType<OkrV2Client['okrObjectiveProgress']['listWithIterator']>
    >,
    fallbackOwnerOpenId: string,
  ): Promise<number> {
    let synced = 0;
    for await (const page of iterator) {
      for (const progress of page?.items ?? []) {
        await this.upsertProgress(progress, fallbackOwnerOpenId);
        synced += 1;
      }
    }
    return synced;
  }

  private async syncObjectiveAlignments(
    objectiveId: string,
    fallbackOwnerOpenId: string,
  ): Promise<number> {
    const iterator = await this.larkService
      .getClient()
      .okr.v2.okrObjectiveAlignment.listWithIterator({
        path: { objective_id: objectiveId },
        params: {
          page_size: PAGE_SIZE,
          user_id_type: 'open_id',
          department_id_type: 'open_department_id',
        },
      });
    let synced = 0;

    for await (const page of iterator) {
      for (const alignment of page?.items ?? []) {
        await this.upsertAlignment(alignment, fallbackOwnerOpenId);
        synced += 1;
      }
    }
    return synced;
  }

  /**
   * 单条 OKR 已被删除或暂不可访问时，飞书会返回 HTTP 400。
   * 这类数据级错误只跳过当前子资源，不能中断该员工后续 OKR 的同步。
   */
  private async continueOnBadRequest<T>(
    context: string,
    operation: () => Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const details = getLarkBadRequestDetails(error);
      if (!details) throw error;

      this.logger.warn(`跳过${context}：${JSON.stringify(details)}`);
      return fallback();
    }
  }

  private async upsertCategory(item: OkrCategoryItem) {
    const data = {
      create_time: item.create_time,
      update_time: item.update_time,
      category_type: item.category_type,
      enabled: item.enabled,
      color: item.color,
      name: item.name as Prisma.InputJsonValue,
    };
    await this.prisma.larkOkrCategory.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }

  private async upsertCycle(item: OkrCycleItem, fallbackOwnerOpenId: string) {
    const data = {
      create_time: item.create_time,
      update_time: item.update_time,
      tenant_cycle_id: item.tenant_cycle_id,
      owner_type: item.owner.owner_type,
      owner_open_id: item.owner.user_id ?? fallbackOwnerOpenId,
      start_time: item.start_time,
      end_time: item.end_time,
      cycle_status: item.cycle_status ?? null,
      score: item.score ?? null,
    };
    await this.prisma.larkOkrCycle.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }

  private async upsertObjective(
    item: OkrObjectiveItem,
    fallbackOwnerOpenId: string,
  ) {
    const data = {
      create_time: item.create_time,
      update_time: item.update_time,
      owner_type: item.owner.owner_type,
      owner_open_id: item.owner.user_id ?? fallbackOwnerOpenId,
      cycle_id: item.cycle_id,
      position: item.position,
      content: asNullableJson(item.content),
      score: item.score ?? null,
      notes: asNullableJson(item.notes),
      weight: item.weight ?? null,
      deadline: item.deadline ?? null,
      category_id: item.category_id ?? null,
    };
    await this.prisma.larkOkrObjective.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }

  private async upsertKeyResult(
    item: OkrKeyResultItem,
    fallbackOwnerOpenId: string,
  ) {
    const data = {
      create_time: item.create_time,
      update_time: item.update_time,
      owner_type: item.owner.owner_type,
      owner_open_id: item.owner.user_id ?? fallbackOwnerOpenId,
      objective_id: item.objective_id,
      position: item.position,
      content: asNullableJson(item.content),
      score: item.score ?? null,
      weight: item.weight ?? null,
      deadline: item.deadline ?? null,
    };
    await this.prisma.larkOkrKeyResult.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }

  private async upsertIndicator(
    item: OkrIndicatorItem,
    fallbackOwnerOpenId: string,
  ) {
    const data = {
      create_time: item.create_time,
      update_time: item.update_time,
      owner_type: item.owner.owner_type,
      owner_open_id: item.owner.user_id ?? fallbackOwnerOpenId,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      indicator_status: item.indicator_status,
      status_calculate_type: item.status_calculate_type,
      start_value: item.start_value ?? null,
      target_value: item.target_value ?? null,
      current_value: item.current_value ?? null,
      current_value_calculate_type: item.current_value_calculate_type ?? null,
      unit: asNullableJson(item.unit),
    };
    await this.prisma.larkOkrIndicator.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }

  private async upsertProgress(
    item: OkrProgressItem,
    fallbackOwnerOpenId: string,
  ) {
    const data = {
      create_time: item.create_time,
      update_time: item.update_time,
      owner_type: item.owner.owner_type,
      owner_open_id: item.owner.user_id ?? fallbackOwnerOpenId,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      content: asNullableJson(item.content),
      progress_percent: item.progress_rate?.progress_percent ?? null,
      progress_status: item.progress_rate?.progress_status ?? null,
    };
    await this.prisma.larkOkrProgress.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }

  private async upsertAlignment(
    item: OkrAlignmentItem,
    fallbackOwnerOpenId: string,
  ) {
    const data = {
      create_time: item.create_time,
      update_time: item.update_time,
      from_owner_type: item.from_owner.owner_type,
      from_owner_id: item.from_owner.user_id ?? fallbackOwnerOpenId,
      to_owner_type: item.to_owner.owner_type,
      to_owner_id: item.to_owner.user_id ?? null,
      from_entity_type: item.from_entity_type,
      from_entity_id: item.from_entity_id,
      to_entity_type: item.to_entity_type,
      to_entity_id: item.to_entity_id,
    };
    await this.prisma.larkOkrAlignment.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }

  /**
   * 删除本轮未再出现的员工 OKR 行。清理放在完整拉取成功之后，并使用单事务保证
   * 多态子资源与周期层级同时前进；失败员工不会进入该方法。
   */
  private async cleanupStaleUserData(openId: string, syncStartedAt: Date) {
    const stale = { synced_at: { lt: syncStartedAt } };
    await this.prisma.$transaction([
      this.prisma.larkOkrAlignment.deleteMany({
        where: { from_owner_id: openId, ...stale },
      }),
      this.prisma.larkOkrProgress.deleteMany({
        where: { owner_open_id: openId, ...stale },
      }),
      this.prisma.larkOkrIndicator.deleteMany({
        where: { owner_open_id: openId, ...stale },
      }),
      this.prisma.larkOkrKeyResult.deleteMany({
        where: { owner_open_id: openId, ...stale },
      }),
      this.prisma.larkOkrObjective.deleteMany({
        where: { owner_open_id: openId, ...stale },
      }),
      this.prisma.larkOkrCycle.deleteMany({
        where: { owner_open_id: openId, ...stale },
      }),
    ]);
  }
}
