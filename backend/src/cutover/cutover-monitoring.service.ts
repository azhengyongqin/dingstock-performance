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

@Injectable()
export class CutoverMonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Contract migration 完成后只以系统配置确认实例读写路径与回退开关。
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
        message: '绩效系统尚未完成新模型切换，请先检查数据库迁移与回退开关。',
      });
    }
  }

  async getStatus() {
    const staleBefore = new Date(
      Date.now() - STALE_TASK_HOURS * 60 * 60 * 1000,
    );
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: CUTOVER_CONFIG_KEY },
      select: { value: true, updatedAt: true },
    });
    const [staleOpenTasks, activationFailures, failedEvents, failedDeliveries] =
      await Promise.all([
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
        this.prisma.perfNotificationEvent.count({
          where: { status: 'FAILED' },
        }),
        this.prisma.perfNotification.count({ where: { status: 'FAILED' } }),
      ]);

    const gate = asRecord(config?.value) as CutoverGate;
    const contracted =
      gate.phase === 'CONTRACTED' &&
      gate.readPath === 'VERSIONED' &&
      gate.writePath === 'UNIFIED_SUBMISSION' &&
      gate.rollbackEnabled === false;
    return {
      ready: contracted,
      gate: { ...gate, updatedAt: config?.updatedAt ?? null },
      monitors: {
        task: { staleOpenTasks, activationFailures },
        notification: { failedEvents, failedDeliveries },
      },
    };
  }
}
