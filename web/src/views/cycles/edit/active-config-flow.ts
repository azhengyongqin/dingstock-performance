import { ApiError } from '@/lib/api'

/** 预览输入发生并发变化时，编辑页必须丢弃旧确认并回到重新预览。 */
export const requiresActiveConfigRepreview = (error: unknown) => {
  if (!(error instanceof ApiError) || error.status !== 409) return false

  const code = (error.body as { code?: string } | undefined)?.code

  return code === 'ACTIVE_CONFIG_IMPACT_STALE' || code === 'CYCLE_CONFIG_VERSION_STALE'
}
