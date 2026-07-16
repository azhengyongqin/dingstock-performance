import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  LarkOkrCategory,
  LarkOkrIndicator,
  LarkOkrProgress,
} from '../generated/prisma/client';
import { PerfAssignmentStatus } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { OkrSyncService } from './okr-sync.service';

/** 评估页面读取 OKR 的业务边界：缓存查询与单人刷新共享同一套对象级鉴权。 */
@Injectable()
export class OkrReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: OkrSyncService,
  ) {}

  async getParticipantOkr(operatorOpenId: string, participantId: number) {
    const participant = await this.requireAccessibleParticipant(
      operatorOpenId,
      participantId,
    );
    const cycles = await this.prisma.larkOkrCycle.findMany({
      where: { owner_open_id: participant.employeeOpenId },
      include: {
        objectives: {
          include: { key_results: { orderBy: { position: 'asc' } } },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: [{ start_time: 'desc' }, { id: 'desc' }],
    });

    const objectives = cycles.flatMap((cycle) => cycle.objectives);
    const keyResults = objectives.flatMap((objective) => objective.key_results);
    const entityIds = [
      ...objectives.map((objective) => objective.id),
      ...keyResults.map((keyResult) => keyResult.id),
    ];
    const categoryIds = [
      ...new Set(
        objectives
          .map((objective) => objective.category_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const [indicators, progresses, categories, sync] = await Promise.all([
      entityIds.length
        ? this.prisma.larkOkrIndicator.findMany({
            where: { entity_id: { in: entityIds } },
          })
        : [],
      entityIds.length
        ? this.prisma.larkOkrProgress.findMany({
            where: { entity_id: { in: entityIds } },
            // SDK 时间为毫秒时间戳字符串；同长度字符串倒序与时间倒序一致。
            orderBy: [{ create_time: 'desc' }, { id: 'desc' }],
          })
        : [],
      categoryIds.length
        ? this.prisma.larkOkrCategory.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true, color: true },
          })
        : [],
      this.syncService.getUserStatus(participant.employeeOpenId),
    ]);

    const indicatorByEntity = new Map<string, LarkOkrIndicator>(
      indicators.map((indicator) => [indicator.entity_id, indicator] as const),
    );
    const latestProgressByEntity = new Map<string, LarkOkrProgress>();
    for (const progress of progresses) {
      // 查询已按新到旧排序，首次出现即是实体当前要展示的最新进展。
      if (!latestProgressByEntity.has(progress.entity_id)) {
        latestProgressByEntity.set(progress.entity_id, progress);
      }
    }
    const categoryById = new Map<
      string,
      Pick<LarkOkrCategory, 'id' | 'name' | 'color'>
    >(categories.map((category) => [category.id, category] as const));

    return {
      participantId: participant.id,
      employeeOpenId: participant.employeeOpenId,
      lastSyncedAt: cycles[0]?.synced_at.toISOString() ?? null,
      sync,
      cycles: cycles.map((cycle) => ({
        id: cycle.id,
        tenantCycleId: cycle.tenant_cycle_id,
        startTime: cycle.start_time,
        endTime: cycle.end_time,
        status: cycle.cycle_status,
        score: cycle.score,
        objectives: cycle.objectives.map((objective) => ({
          id: objective.id,
          position: objective.position,
          content: objective.content,
          notes: objective.notes,
          score: objective.score,
          weight: objective.weight,
          deadline: objective.deadline,
          category: objective.category_id
            ? (categoryById.get(objective.category_id) ?? null)
            : null,
          indicator: this.toIndicator(
            indicatorByEntity.get(objective.id) ?? null,
          ),
          latestProgress: this.toProgress(
            latestProgressByEntity.get(objective.id) ?? null,
          ),
          keyResults: objective.key_results.map((keyResult) => ({
            id: keyResult.id,
            position: keyResult.position,
            content: keyResult.content,
            score: keyResult.score,
            weight: keyResult.weight,
            deadline: keyResult.deadline,
            indicator: this.toIndicator(
              indicatorByEntity.get(keyResult.id) ?? null,
            ),
            latestProgress: this.toProgress(
              latestProgressByEntity.get(keyResult.id) ?? null,
            ),
          })),
        })),
      })),
    };
  }

  async triggerParticipantSync(operatorOpenId: string, participantId: number) {
    const participant = await this.requireAccessibleParticipant(
      operatorOpenId,
      participantId,
    );
    return this.syncService.triggerUserSync(participant.employeeOpenId);
  }

  private async requireAccessibleParticipant(
    operatorOpenId: string,
    participantId: number,
  ) {
    const participant = await this.prisma.perfParticipant.findFirst({
      where: {
        id: participantId,
        cycle: { deletedAt: null },
        OR: [
          { employeeOpenId: operatorOpenId },
          { leaderOpenIdSnapshot: operatorOpenId },
          {
            reviewerAssignments: {
              some: {
                reviewerOpenId: operatorOpenId,
                status: { not: PerfAssignmentStatus.REPLACED },
              },
            },
          },
        ],
      },
      select: { id: true, employeeOpenId: true },
    });
    if (!participant) {
      // 对不存在与无权限统一返回 403，避免通过 ID 枚举参与者。
      throw new ForbiddenException('你无权查看该员工的 OKR');
    }
    return participant;
  }

  private toIndicator(
    indicator: {
      id: string;
      indicator_status: number;
      start_value: number | null;
      target_value: number | null;
      current_value: number | null;
      unit: unknown;
    } | null,
  ) {
    if (!indicator) return null;
    return {
      id: indicator.id,
      status: indicator.indicator_status,
      startValue: indicator.start_value,
      targetValue: indicator.target_value,
      currentValue: indicator.current_value,
      unit: indicator.unit,
    };
  }

  private toProgress(progress: LarkOkrProgress | null) {
    if (!progress) return null;
    return {
      id: progress.id,
      content: progress.content,
      progressPercent: progress.progress_percent,
      status: progress.progress_status,
      createTime: progress.create_time,
      updateTime: progress.update_time,
    };
  }
}
