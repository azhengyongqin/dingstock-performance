import { NotificationService } from './notification.service';
import type { PrismaService } from '../shared/database/prisma.service';
import type { LarkService } from '../shared/lark/lark.service';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

// 生成的 Prisma client 是 ESM 产物，单测中统一 mock，避免依赖真实数据库。
jest.mock(
  '../generated/prisma/client',
  () => ({
    PrismaClient: class {
      $connect = jest.fn();
      $disconnect = jest.fn();
    },
  }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfNotificationChannel: {
      BOT_DM: 'BOT_DM',
    },
    PerfNotificationStatus: {
      PENDING: 'PENDING',
      RETRYING: 'RETRYING',
      SUCCESS: 'SUCCESS',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((options: unknown) => options),
}));

describe('NotificationService', () => {
  const larkMessageCreate = jest.fn();
  const prismaMock = {
    perfNotification: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const redisMock = {
    set: jest.fn(),
    del: jest.fn(),
  };
  const larkServiceMock = {
    getClient: () => ({
      im: { v1: { message: { create: larkMessageCreate } } },
    }),
  };

  const buildService = (sendEnabled: boolean) => {
    const configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'lark.notification.enabled') return sendEnabled;
        return undefined;
      }),
    };
    return new NotificationService(
      prismaMock as unknown as PrismaService,
      larkServiceMock as unknown as LarkService,
      redisMock as unknown as Redis,
      configServiceMock as unknown as ConfigService,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redisMock.set.mockResolvedValue('OK');
    redisMock.del.mockResolvedValue(1);
    prismaMock.perfNotification.createMany.mockResolvedValue({ count: 1 });
    prismaMock.perfNotification.findMany.mockResolvedValue([]);
    prismaMock.perfNotification.update.mockResolvedValue({});
  });

  describe('发送开关关闭（lark.notification.enabled=false）', () => {
    it('sendPendingBatch 直接跳过，不抢锁也不外发', async () => {
      const service = buildService(false);

      await service.sendPendingBatch();

      expect(redisMock.set).not.toHaveBeenCalled();
      expect(prismaMock.perfNotification.findMany).not.toHaveBeenCalled();
      expect(larkMessageCreate).not.toHaveBeenCalled();
    });

    it('remind 仍正常落库，只是不触发外发', async () => {
      const service = buildService(false);

      const result = await service.remind(['ou_receiver'], 'cycle_start', {
        cycleName: '2026 H1',
      });

      expect(result).toEqual({ created: 1 });
      expect(prismaMock.perfNotification.createMany).toHaveBeenCalledTimes(1);
      expect(larkMessageCreate).not.toHaveBeenCalled();
    });
  });

  describe('发送开关开启（lark.notification.enabled=true）', () => {
    it('sendPendingBatch 扫描待发送记录并调用飞书发送', async () => {
      prismaMock.perfNotification.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.perfNotification.findUnique.mockResolvedValue({
        id: 1,
        status: 'PENDING',
        receiverOpenId: 'ou_receiver',
        template: 'cycle_start',
        payload: { cycleName: '2026 H1' },
        retryCount: 0,
      });
      larkMessageCreate.mockResolvedValue({});
      const service = buildService(true);

      await service.sendPendingBatch();

      expect(larkMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ receive_id: 'ou_receiver' }),
        }),
      );
      expect(prismaMock.perfNotification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status: 'SUCCESS' }),
        }),
      );
      // 发送循环结束后释放 Redis 锁
      expect(redisMock.del).toHaveBeenCalled();
    });
  });
});
