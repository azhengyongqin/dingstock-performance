import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CutoverMonitoringService } from './cutover-monitoring.service';
import { SKIP_PERFORMANCE_CUTOVER_GATE } from './performance-cutover.decorator';

/**
 * Ticket 21 全局运行时门禁：所有业务 HTTP 路由在首次访问时确认实例已进入
 * CONTRACTED 最终态。成功结果按进程缓存；失败不缓存，修复配置后可立即重试。
 */
@Injectable()
export class PerformanceCutoverGuard implements CanActivate {
  private contracted: Promise<void> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly monitoring: CutoverMonitoringService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const skipped = this.reflector.getAllAndOverride<boolean>(
      SKIP_PERFORMANCE_CUTOVER_GATE,
      [context.getHandler(), context.getClass()],
    );
    if (skipped) return true;

    if (!this.contracted) {
      this.contracted = this.monitoring.assertContracted().catch((error) => {
        // 配置可能由 migration/运维修复；失败必须允许后续请求重新探测。
        this.contracted = null;
        throw error;
      });
    }
    await this.contracted;
    return true;
  }
}
