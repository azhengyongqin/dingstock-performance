import type { ExecutionContext } from '@nestjs/common';
import { PerformanceCutoverGuard } from './performance-cutover.guard';

describe('PerformanceCutoverGuard', () => {
  const context = {
    getHandler: jest.fn(() => function handler() {}),
    getClass: jest.fn(() => class Controller {}),
  } as unknown as ExecutionContext;
  const reflector = { getAllAndOverride: jest.fn() };
  const monitoring = { assertContracted: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('健康、认证和切换监控等显式豁免路由不执行门禁', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const guard = new PerformanceCutoverGuard(
      reflector as never,
      monitoring as never,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(monitoring.assertContracted).not.toHaveBeenCalled();
  });

  it('业务路由执行门禁并在成功后复用进程级结果', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    monitoring.assertContracted.mockResolvedValue(undefined);
    const guard = new PerformanceCutoverGuard(
      reflector as never,
      monitoring as never,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(monitoring.assertContracted).toHaveBeenCalledTimes(1);
  });

  it('门禁失败不缓存，配置修复后的下一次请求会重新探测', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    monitoring.assertContracted
      .mockRejectedValueOnce(new Error('not contracted'))
      .mockResolvedValueOnce(undefined);
    const guard = new PerformanceCutoverGuard(
      reflector as never,
      monitoring as never,
    );

    await expect(guard.canActivate(context)).rejects.toThrow('not contracted');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(monitoring.assertContracted).toHaveBeenCalledTimes(2);
  });
});
