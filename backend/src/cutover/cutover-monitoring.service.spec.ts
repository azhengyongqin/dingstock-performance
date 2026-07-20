import { ServiceUnavailableException } from '@nestjs/common';
import { CutoverMonitoringService } from './cutover-monitoring.service';

// 单元测试只验证分类监控聚合，不加载真实 Prisma 运行时与数据库连接。
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('CutoverMonitoringService', () => {
  const prisma = {
    systemConfig: { findUnique: jest.fn() },
    perfEvaluationTask: { count: jest.fn() },
    perfNotificationEvent: { count: jest.fn() },
    perfNotification: { count: jest.fn() },
  };

  const service = new CutoverMonitoringService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('按迁移、计算、任务和通知四类返回切换健康状态', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({
      value: {
        phase: 'CONTRACTED',
        readPath: 'VERSIONED',
        writePath: 'UNIFIED_SUBMISSION',
        rollbackEnabled: false,
      },
      updatedAt: new Date('2026-07-16T10:00:00.000Z'),
    });
    prisma.perfEvaluationTask.count.mockResolvedValue(2);
    prisma.perfNotificationEvent.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1);
    prisma.perfNotification.count.mockResolvedValue(3);

    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        gate: expect.objectContaining({ phase: 'CONTRACTED' }),
        monitors: {
          task: { staleOpenTasks: 2, activationFailures: 4 },
          notification: { failedEvents: 1, failedDeliveries: 3 },
        },
      }),
    );
  });

  it('运行时未处于最终切换态时拒绝宣称新模型可用', async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({
      value: { phase: 'EXPANDED', rollbackEnabled: true },
      updatedAt: new Date(),
    });

    await expect(service.assertContracted()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
