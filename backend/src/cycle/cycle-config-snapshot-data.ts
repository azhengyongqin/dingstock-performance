import type { Prisma } from '../generated/prisma/client';
import type { PerfStageResultMode } from '../generated/prisma/enums';

export type CycleConfigSnapshotValues = {
  selfStageMode: PerfStageResultMode;
  peerStageMode: PerfStageResultMode;
  managerStageMode: PerfStageResultMode;
  aiStageMode: PerfStageResultMode;
  ratings: unknown;
  constraintProfiles: unknown;
  orgOwnerWeight: string | number | { toString(): string };
  projectOwnerWeight: string | number | { toString(): string };
  peerWeight: string | number | { toString(): string };
  crossDeptWeight: string | number | { toString(): string };
  schedulePreset: unknown;
  notificationRules: unknown;
};

/** 基线初始化与 ACTIVE 追加版本共享同一快照字段映射，避免字段或 JSON 语义漂移。 */
export function toCycleConfigSnapshotData(values: CycleConfigSnapshotValues) {
  return {
    selfStageMode: values.selfStageMode,
    peerStageMode: values.peerStageMode,
    managerStageMode: values.managerStageMode,
    aiStageMode: values.aiStageMode,
    ratings: inputJson(values.ratings),
    constraintProfiles: inputJson(values.constraintProfiles),
    orgOwnerWeight: values.orgOwnerWeight.toString(),
    projectOwnerWeight: values.projectOwnerWeight.toString(),
    peerWeight: values.peerWeight.toString(),
    crossDeptWeight: values.crossDeptWeight.toString(),
    schedulePreset: inputJson(values.schedulePreset),
    notificationRules: inputJson(values.notificationRules),
  };
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
