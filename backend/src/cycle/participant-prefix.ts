export type ParticipantPrefix = 'D' | 'M';

export type ParticipantPrefixStatus =
  | 'MATCHED'
  | 'MISSING_JOB_LEVEL'
  | 'UNSUPPORTED_PREFIX'
  | 'NO_FORM'
  | 'AMBIGUOUS_FORM';

type JobLevelResolution = {
  levelValue: string | null;
  prefix: ParticipantPrefix | null;
  status: 'MATCHED' | 'MISSING_JOB_LEVEL' | 'UNSUPPORTED_PREFIX';
};

/**
 * 与“组织架构 > 成员”表格保持同一口径：优先读取 CoreHR job_level.name
 * 的中文名称，其次英文和首个名称；旧同步数据没有 name 时兼容 code。
 */
export function resolveJobLevelPrefix(jobLevel: unknown): JobLevelResolution {
  if (!jobLevel || typeof jobLevel !== 'object') {
    return { levelValue: null, prefix: null, status: 'MISSING_JOB_LEVEL' };
  }

  const value = jobLevel as { code?: unknown; name?: unknown };
  const localizedNames = Array.isArray(value.name) ? value.name : null;
  const preferredName = localizedNames?.length
    ? (localizedNames.find(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof (item as { lang?: unknown }).lang === 'string' &&
          (item as { lang: string }).lang.toLowerCase().startsWith('zh'),
      ) ??
      localizedNames.find(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof (item as { lang?: unknown }).lang === 'string' &&
          (item as { lang: string }).lang.toLowerCase().startsWith('en'),
      ) ??
      localizedNames[0])
    : undefined;
  const rawLevel =
    preferredName !== null && typeof preferredName === 'object'
      ? (preferredName as { value?: unknown }).value
      : // 仅旧同步记录完全没有多语言名称时兼容 code，不接受其他人工格式。
        value.name === undefined
        ? value.code
        : undefined;

  if (typeof rawLevel !== 'string' || rawLevel.trim().length === 0) {
    return { levelValue: null, prefix: null, status: 'MISSING_JOB_LEVEL' };
  }

  const levelValue = rawLevel.trim();
  const first = levelValue[0]?.toUpperCase();
  if (first !== 'D' && first !== 'M') {
    return { levelValue, prefix: null, status: 'UNSUPPORTED_PREFIX' };
  }
  return { levelValue, prefix: first, status: 'MATCHED' };
}

export type ParticipantFormMatch = {
  participantId: number;
  employeeOpenId: string;
  jobLevelCode: string | null;
  jobLevelPrefix: ParticipantPrefix | null;
  formSnapshotId: number | null;
  status: ParticipantPrefixStatus;
  message: string;
};

export function analyzeParticipantFormMatch(
  participant: {
    id: number;
    employeeOpenId: string;
    jobLevelSnapshot: unknown;
  },
  formSnapshots: ReadonlyArray<{
    id: number;
    jobLevelPrefix: ParticipantPrefix;
  }>,
): ParticipantFormMatch {
  const resolution = resolveJobLevelPrefix(participant.jobLevelSnapshot);
  if (resolution.status !== 'MATCHED' || resolution.prefix === null) {
    return {
      participantId: participant.id,
      employeeOpenId: participant.employeeOpenId,
      // API 字段沿用 jobLevelCode 以兼容前端，值代表本次匹配采用的职级展示值。
      jobLevelCode: resolution.levelValue,
      jobLevelPrefix: null,
      formSnapshotId: null,
      status: resolution.status,
      message:
        resolution.status === 'MISSING_JOB_LEVEL'
          ? 'CoreHR 职级缺失，请先同步主数据'
          : `职级 ${resolution.levelValue} 不属于受支持的 D/M 前缀`,
    };
  }

  const matches = formSnapshots.filter(
    (snapshot) => snapshot.jobLevelPrefix === resolution.prefix,
  );
  if (matches.length === 0) {
    return {
      participantId: participant.id,
      employeeOpenId: participant.employeeOpenId,
      jobLevelCode: resolution.levelValue,
      jobLevelPrefix: resolution.prefix,
      formSnapshotId: null,
      status: 'NO_FORM',
      message: `当前周期没有 ${resolution.prefix} 前缀表单快照`,
    };
  }
  if (matches.length > 1) {
    return {
      participantId: participant.id,
      employeeOpenId: participant.employeeOpenId,
      jobLevelCode: resolution.levelValue,
      jobLevelPrefix: resolution.prefix,
      formSnapshotId: null,
      status: 'AMBIGUOUS_FORM',
      message: `当前周期存在多个 ${resolution.prefix} 前缀表单快照`,
    };
  }

  return {
    participantId: participant.id,
    employeeOpenId: participant.employeeOpenId,
    jobLevelCode: resolution.levelValue,
    jobLevelPrefix: resolution.prefix,
    formSnapshotId: matches[0].id,
    status: 'MATCHED',
    message: `已匹配 ${resolution.prefix} 前缀表单`,
  };
}
