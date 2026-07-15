import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../shared/database/prisma.service';

const CUTOVER_CONFIG_KEY = 'performance.model.cutover';
const STALE_TASK_HOURS = 24;

type CutoverGate = {
  phase?: string;
  readPath?: string;
  writePath?: string;
  rollbackEnabled?: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

@Injectable()
export class CutoverMonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 最终切换的运行时门禁。数据库 migration 负责阻止未通过 readiness 的结构收缩，
   * 此处负责让业务探针确认部署实例读写路径与回退开关也已进入最终态。
   */
  async assertContracted() {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: CUTOVER_CONFIG_KEY },
      select: { value: true },
    });
    const gate = asRecord(config?.value) as CutoverGate;
    const contracted =
      gate.phase === 'CONTRACTED' &&
      gate.readPath === 'VERSIONED' &&
      gate.writePath === 'UNIFIED_SUBMISSION' &&
      gate.rollbackEnabled === false;

    if (!contracted) {
      throw new ServiceUnavailableException({
        code: 'PERFORMANCE_MODEL_NOT_CONTRACTED',
        message:
          '绩效系统尚未完成新模型切换，请先检查迁移 readiness 与回退开关。',
      });
    }
  }

  async getStatus() {
    const staleBefore = new Date(
      Date.now() - STALE_TASK_HOURS * 60 * 60 * 1000,
    );
    const [config, latestRun] = await Promise.all([
      this.prisma.systemConfig.findUnique({
        where: { key: CUTOVER_CONFIG_KEY },
        select: { value: true, updatedAt: true },
      }),
      this.prisma.perfLegacyMigrationRun.findFirst({
        // 只认最新一次正式全量批次；失败的新批次不能被更早的成功批次遮蔽。
        where: { cycleId: null, dryRun: false },
        // id 是严格递增的批次顺序；不能按 completedAt 排序，否则较早创建、
        // 较晚结束的批次会错误遮蔽真正的最新一次尝试。
        orderBy: { id: 'desc' },
        select: {
          id: true,
          runKey: true,
          status: true,
          readinessReport: true,
          shadowReport: true,
          completedAt: true,
        },
      }),
    ]);
    const [
      failedItems,
      staleOpenTasks,
      activationFailures,
      failedEvents,
      failedDeliveries,
    ] = await Promise.all([
      this.prisma.perfLegacyMigrationItem.count({
        where: { runId: latestRun?.id ?? -1, status: 'FAILED' },
      }),
      this.prisma.perfEvaluationTask.count({
        where: {
          openedAt: { not: null, lt: staleBefore },
          completedAt: null,
          cycle: { status: 'ACTIVE', deletedAt: null },
        },
      }),
      this.prisma.perfNotificationEvent.count({
        where: { type: 'CYCLE_START_FAILED' },
      }),
      this.prisma.perfNotificationEvent.count({ where: { status: 'FAILED' } }),
      this.prisma.perfNotification.count({ where: { status: 'FAILED' } }),
    ]);

    const gate = asRecord(config?.value) as CutoverGate;
    const readiness = asRecord(latestRun?.readinessReport);
    const shadow = asRecord(latestRun?.shadowReport);
    const contracted =
      gate.phase === 'CONTRACTED' &&
      gate.readPath === 'VERSIONED' &&
      gate.writePath === 'UNIFIED_SUBMISSION' &&
      gate.rollbackEnabled === false;
    const migrationReady =
      latestRun?.status === 'COMPLETED' &&
      readiness.ready === true &&
      failedItems === 0;

    return {
      ready: contracted && migrationReady,
      gate: { ...gate, updatedAt: config?.updatedAt ?? null },
      monitors: {
        migration: {
          ready: migrationReady,
          runId: latestRun?.id ?? null,
          runKey: latestRun?.runKey ?? null,
          completedAt: latestRun?.completedAt ?? null,
          failedItems,
          blockers: Array.isArray(readiness.blockers) ? readiness.blockers : [],
        },
        calculation: {
          differenceCount: asNumber(
            shadow.differenceCount ??
              shadow.differencesCount ??
              shadow.differences,
          ),
        },
        task: { staleOpenTasks, activationFailures },
        notification: { failedEvents, failedDeliveries },
      },
    };
  }
}
