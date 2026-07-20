import type { ConfigRatingDefinition } from './config-template.contract';

const PERSISTED_CONFIG_FIELDS_REPLACED_BY_PUBLIC_PROJECTION = [
  'selfStageMode',
  'peerStageMode',
  'managerStageMode',
  'aiStageMode',
  'constraintProfiles',
  'ratings',
] as const;

/** 统一裁剪持久化内部字段；调用方随后写入净化后的评级公开投影。 */
export function omitPersistedConfigInternals<T extends object>(value: T) {
  const publicValue = { ...value } as Record<string, unknown>;
  for (const key of PERSISTED_CONFIG_FIELDS_REPLACED_BY_PUBLIC_PROJECTION) {
    delete publicValue[key];
  }
  return publicValue;
}

/** 评级公开契约只保留区间与映射分；历史 JSON 中的全局评语规则不会继续传播。 */
export function toPublicRatings(value: unknown): ConfigRatingDefinition[] {
  return ((value as ConfigRatingDefinition[] | null) ?? []).map((rating) => ({
    symbol: rating.symbol,
    name: rating.name,
    description: rating.description,
    minScore: rating.minScore,
    maxScore: rating.maxScore,
    mappingScore: rating.mappingScore,
  }));
}
