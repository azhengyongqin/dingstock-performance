import { SetMetadata } from '@nestjs/common';

export const SKIP_PERFORMANCE_CUTOVER_GATE = 'skip-performance-cutover-gate';

/** 健康检查、登录和切换监控必须在门禁失败时仍可访问，便于恢复。 */
export const SkipPerformanceCutoverGate = () =>
  SetMetadata(SKIP_PERFORMANCE_CUTOVER_GATE, true);
