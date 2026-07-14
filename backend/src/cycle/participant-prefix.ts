export type ParticipantPrefix = 'D' | 'M';

export type ParticipantPrefixStatus =
  | 'MATCHED'
  | 'MISSING_JOB_LEVEL'
  | 'UNSUPPORTED_PREFIX'
  | 'NO_FORM'
  | 'AMBIGUOUS_FORM';

type JobLevelResolution = {
  code: string | null;
  prefix: ParticipantPrefix | null;
  status: 'MATCHED' | 'MISSING_JOB_LEVEL' | 'UNSUPPORTED_PREFIX';
};

/**
 * 只认 CoreHR job_level.code 的首字符，不使用岗位名称、序列或人工值兜底。
 * 这样 D/M 表单的匹配口径始终可追溯到同一份主数据。
 */
export function resolveJobLevelPrefix(jobLevel: unknown): JobLevelResolution {
  if (!jobLevel || typeof jobLevel !== 'object') {
    return { code: null, prefix: null, status: 'MISSING_JOB_LEVEL' };
  }
  const rawCode = (jobLevel as { code?: unknown }).code;
  if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
    return { code: null, prefix: null, status: 'MISSING_JOB_LEVEL' };
  }

  const code = rawCode.trim();
  const first = code[0]?.toUpperCase();
  if (first !== 'D' && first !== 'M') {
    return { code, prefix: null, status: 'UNSUPPORTED_PREFIX' };
  }
  return { code, prefix: first, status: 'MATCHED' };
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
      jobLevelCode: resolution.code,
      jobLevelPrefix: null,
      formSnapshotId: null,
      status: resolution.status,
      message:
        resolution.status === 'MISSING_JOB_LEVEL'
          ? 'CoreHR 职级编码缺失，请先同步主数据'
          : `职级编码 ${resolution.code} 不属于受支持的 D/M 前缀`,
    };
  }

  const matches = formSnapshots.filter(
    (snapshot) => snapshot.jobLevelPrefix === resolution.prefix,
  );
  if (matches.length === 0) {
    return {
      participantId: participant.id,
      employeeOpenId: participant.employeeOpenId,
      jobLevelCode: resolution.code,
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
      jobLevelCode: resolution.code,
      jobLevelPrefix: resolution.prefix,
      formSnapshotId: null,
      status: 'AMBIGUOUS_FORM',
      message: `当前周期存在多个 ${resolution.prefix} 前缀表单快照`,
    };
  }

  return {
    participantId: participant.id,
    employeeOpenId: participant.employeeOpenId,
    jobLevelCode: resolution.code,
    jobLevelPrefix: resolution.prefix,
    formSnapshotId: matches[0].id,
    status: 'MATCHED',
    message: `已匹配 ${resolution.prefix} 前缀表单`,
  };
}
