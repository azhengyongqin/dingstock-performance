import {
  calculateStageResult,
  type PerformanceLevel,
  type StageResultInput,
} from '../calculation/stage-result-calculator';
import type {
  FormSnapshotContent,
  FormSnapshotDimension,
} from '../evaluation/evaluation.service-types';

type Mapped<T> =
  { value: T } | { issue: string; sourceValue: string; reason?: string };

export type NewCycleStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ARCHIVED';
export type NewParticipantStatus =
  | 'ACTIVE'
  | 'CALIBRATED'
  | 'RESULT_PUBLISHED'
  | 'APPEALING'
  | 'RE_CONFIRMING'
  | 'CONFIRMED'
  | 'NO_RESULT'
  | 'WITHDRAWN';

/** 旧周期状态只按已冻结的 ADR-0049 显式映射；未知值必须进入异常清单。 */
export function mapLegacyCycleStatus(value: string): Mapped<NewCycleStatus> {
  const mapping: Record<string, NewCycleStatus> = {
    DRAFT: 'DRAFT',
    PENDING: 'DRAFT',
    SCHEDULED: 'SCHEDULED',
    SELF_REVIEW: 'ACTIVE',
    REVIEWING: 'ACTIVE',
    AI_ANALYZING: 'ACTIVE',
    CALIBRATING: 'ACTIVE',
    CONFIRMING: 'ACTIVE',
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
  };
  const mapped = mapping[value];
  return mapped
    ? { value: mapped }
    : { issue: 'UNMAPPED_CYCLE_STATUS', sourceValue: value };
}

export type ParticipantMigrationFacts = {
  hasCalibration: boolean;
  hasPublishedResult: boolean;
  resultConfirmed: boolean;
  hasOpenAppeal: boolean;
};

/**
 * 参与者新状态表达结果生命周期，不再编码 SELF/PEER/MANAGER/AI 进度。
 * 结果链事实优先于旧枚举；缺少可证明事实时绝不把 ARCHIVED 静默猜成已确认。
 */
export function mapLegacyParticipantStatus(
  sourceValue: string,
  facts: ParticipantMigrationFacts,
): Mapped<NewParticipantStatus> {
  if (sourceValue === 'WITHDRAWN') return { value: 'WITHDRAWN' };
  if (sourceValue === 'NO_RESULT') return { value: 'NO_RESULT' };
  if (facts.hasOpenAppeal || sourceValue === 'APPEALING') {
    return { value: 'APPEALING' };
  }
  if (sourceValue === 'RE_CONFIRMING') return { value: 'RE_CONFIRMING' };
  if (facts.hasPublishedResult) {
    return { value: facts.resultConfirmed ? 'CONFIRMED' : 'RESULT_PUBLISHED' };
  }
  if (facts.hasCalibration) return { value: 'CALIBRATED' };
  if (sourceValue === 'ARCHIVED') {
    return {
      issue: 'AMBIGUOUS_PARTICIPANT_STATUS',
      sourceValue,
      reason: '参与者旧 ARCHIVED 缺少可证明的关闭事实',
    };
  }
  const activeSourceValues = new Set([
    'ACTIVE',
    'PENDING_SELF_REVIEW',
    'SELF_SUBMITTED',
    'RETURNED',
    'REVIEWED',
    'AI_DONE',
    'CALIBRATED',
    'RESULT_PUSHED',
    'RESULT_PUBLISHED',
  ]);
  return activeSourceValues.has(sourceValue)
    ? { value: 'ACTIVE' }
    : { issue: 'UNMAPPED_PARTICIPANT_STATUS', sourceValue };
}

export type LegacyDimension = {
  id: number;
  name: string;
  type: string;
  scoringMethod: string;
  weight: string | number | null;
  required: boolean;
  sortOrder: number;
  editableRoles: readonly string[];
  formSchema: unknown;
  applicableScope?: unknown;
};

const STAGES = ['SELF', 'PEER', 'MANAGER'] as const;
type HumanStage = (typeof STAGES)[number];

const stageAudience: Record<HumanStage, 'EMPLOYEE' | 'REVIEWER' | 'LEADER'> = {
  SELF: 'EMPLOYEE',
  PEER: 'REVIEWER',
  MANAGER: 'LEADER',
};

const stageRole: Record<HumanStage, string> = {
  SELF: 'EMPLOYEE',
  PEER: 'REVIEWER',
  MANAGER: 'LEADER',
};

/** 将旧周期维度复制成独立快照；key 只依赖旧主键和阶段，失败重跑保持稳定。 */
export function buildLegacyFormSnapshot(
  prefix: 'D' | 'M',
  dimensions: readonly LegacyDimension[],
): FormSnapshotContent {
  return {
    subforms: STAGES.map((stage, subformIndex) => ({
      key: `legacy-subform:${stage}`,
      type: stage,
      title: legacyStageTitle(stage),
      sortOrder: subformIndex,
      dimensions: [
        ...(stage === 'SELF' ? [legacySelfDimension()] : []),
        ...dimensions
          .filter((dimension) => appliesToPrefix(dimension, prefix))
          .filter((dimension) =>
            dimension.editableRoles.includes(stageRole[stage]),
          )
          .sort(
            (left, right) =>
              left.sortOrder - right.sortOrder || left.id - right.id,
          )
          .map((dimension) => {
            const key = `legacy-dimension:${dimension.id}:${stage}`;
            const scoringType = legacyItemType(dimension.scoringMethod);
            const kind: FormSnapshotDimension['kind'] =
              dimension.type === 'PROMOTION' ? 'PROMOTION' : 'REGULAR';
            return {
              key,
              kind,
              audience: stageAudience[stage],
              name: dimension.name,
              weight: dimension.weight?.toString() ?? null,
              isCore: dimension.sortOrder === 0,
              sortOrder: dimension.sortOrder,
              items: [
                {
                  key: `${key}:score`,
                  type: scoringType,
                  title: dimension.name,
                  required: dimension.required,
                  sortOrder: 0,
                  config: { legacyFormSchema: dimension.formSchema },
                },
                {
                  key: `${key}:comment`,
                  type: 'LONG_TEXT',
                  title: `${dimension.name}评语`,
                  required: false,
                  sortOrder: 1,
                },
              ],
            };
          }),
      ],
    })),
  };
}

function legacySelfDimension() {
  return {
    key: 'legacy-self:fixed',
    kind: 'TEXT' as const,
    audience: 'EMPLOYEE' as const,
    name: '旧员工自评',
    weight: null,
    isCore: false,
    sortOrder: -1,
    items: [
      {
        key: 'legacy-self:rating',
        type: 'RATING',
        title: '自评等级',
        required: true,
        sortOrder: 0,
      },
      {
        key: 'legacy-self:okr',
        type: 'LONG_TEXT',
        title: 'OKR',
        required: false,
        sortOrder: 1,
      },
      {
        key: 'legacy-self:summary',
        type: 'MARKDOWN',
        title: '工作总结',
        required: false,
        sortOrder: 2,
      },
      {
        key: 'legacy-self:promotion',
        type: 'LONG_TEXT',
        title: '晋升自述',
        required: false,
        sortOrder: 3,
      },
      {
        key: 'legacy-self:attachments',
        type: 'ATTACHMENT',
        title: '附件',
        required: false,
        sortOrder: 4,
      },
      {
        key: 'legacy-self:document',
        type: 'LINK',
        title: '关联文档',
        required: false,
        sortOrder: 5,
      },
    ],
  };
}

function legacyStageTitle(stage: HumanStage): string {
  return { SELF: '员工自评', PEER: '360°评估', MANAGER: '上级评估' }[stage];
}

function appliesToPrefix(
  dimension: LegacyDimension,
  prefix: 'D' | 'M',
): boolean {
  if (
    !dimension.applicableScope ||
    typeof dimension.applicableScope !== 'object'
  ) {
    return true;
  }
  const category = (dimension.applicableScope as { jobCategory?: unknown })
    .jobCategory;
  return typeof category !== 'string' || category === prefix;
}

function legacyItemType(scoringMethod: string): string {
  return (
    {
      LEVEL: 'RATING',
      SCORE: 'SCORE',
      CONCLUSION: 'SINGLE_SELECT',
      TEXT: 'LONG_TEXT',
    }[scoringMethod] ?? 'LONG_TEXT'
  );
}

export type RebuiltLegacyItem = {
  subformKey: string;
  dimensionKey: string;
  itemKey: string;
  itemType: string;
  rawLevel?: PerformanceLevel;
  rawScore?: string;
  calculationScore?: string;
  value?: unknown;
};

export type LegacyJsonIssue = { code: string; path: string; message: string };

/**
 * 旧 dimension_scores 是非受控 JSON。只有维度、类型和值全部验证成功才返回整份答案，
 * 避免部分回填制造一份看似 SUBMITTED、实则缺项的新答卷。
 */
export function rebuildLegacyDimensionItems(input: {
  stage: HumanStage;
  dimensionScores: unknown;
  snapshot: FormSnapshotContent;
}): { items: RebuiltLegacyItem[]; issues: LegacyJsonIssue[] } {
  if (!Array.isArray(input.dimensionScores)) {
    return {
      items: [],
      issues: [
        {
          code: 'INVALID_DIMENSION_JSON',
          path: '$',
          message: 'dimensionScores 必须是数组',
        },
      ],
    };
  }
  const subform = input.snapshot.subforms.find(
    (item) => item.type === input.stage,
  );
  const dimensionMap = new Map(
    (subform?.dimensions ?? []).map((dimension) => {
      const match = /^legacy-dimension:(\d+):/.exec(dimension.key);
      return [match?.[1] ?? '', dimension] as const;
    }),
  );
  const seen = new Set<string>();
  const issues: LegacyJsonIssue[] = [];
  const items: RebuiltLegacyItem[] = [];
  input.dimensionScores.forEach((entry, index) => {
    const path = `[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({
        code: 'INVALID_ENTRY',
        path,
        message: '维度结果必须是对象',
      });
      return;
    }
    const source = entry as Record<string, unknown>;
    const dimensionId =
      typeof source.dimensionId === 'string' ||
      typeof source.dimensionId === 'number'
        ? String(source.dimensionId)
        : '';
    if (!dimensionId) {
      issues.push({
        code: 'MISSING_DIMENSION_ID',
        path: `${path}.dimensionId`,
        message: '缺少旧维度业务键',
      });
      return;
    }
    if (seen.has(dimensionId)) {
      issues.push({
        code: 'DUPLICATE_DIMENSION',
        path: `${path}.dimensionId`,
        message: `旧维度 ${dimensionId} 重复`,
      });
      return;
    }
    seen.add(dimensionId);
    const dimension = dimensionMap.get(dimensionId);
    if (!dimension) {
      issues.push({
        code: 'UNKNOWN_DIMENSION',
        path: `${path}.dimensionId`,
        message: `旧维度 ${dimensionId} 不在目标快照中`,
      });
      return;
    }
    const scoreItem = dimension.items.find((item) =>
      item.key.endsWith(':score'),
    );
    if (!scoreItem) {
      issues.push({
        code: 'MISSING_TARGET_ITEM',
        path,
        message: '目标快照缺少计分项',
      });
      return;
    }
    const base = {
      subformKey: subform?.key ?? `legacy-subform:${input.stage}`,
      dimensionKey: dimension.key,
      itemKey: scoreItem.key,
      itemType: scoreItem.type,
    };
    if (scoreItem.type === 'SCORE') {
      const score = parseScore(source.score);
      if (score === null) {
        issues.push({
          code: 'INVALID_SCORE',
          path: `${path}.score`,
          message: '分数必须在 0～100 且最多两位小数',
        });
        return;
      }
      items.push({ ...base, rawScore: score, calculationScore: score });
    } else if (scoreItem.type === 'RATING') {
      if (!isLevel(source.level)) {
        issues.push({
          code: 'INVALID_LEVEL',
          path: `${path}.level`,
          message: '评级必须为 S/A/B/C',
        });
        return;
      }
      items.push({ ...base, rawLevel: source.level });
    } else {
      const value = source.conclusion ?? source.value;
      if (value === undefined || value === null) {
        issues.push({
          code: 'MISSING_VALUE',
          path,
          message: '非计分维度缺少 conclusion/value',
        });
        return;
      }
      items.push({ ...base, value });
    }
    if (typeof source.comment === 'string' && source.comment.trim()) {
      items.push({
        subformKey: base.subformKey,
        dimensionKey: dimension.key,
        itemKey: `${dimension.key}:comment`,
        itemType: 'LONG_TEXT',
        value: source.comment,
      });
    }
  });
  return issues.length > 0 ? { items: [], issues } : { items, issues };
}

function parseScore(value: unknown): string | null {
  const text =
    typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  if (!/^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/.test(text)) return null;
  return text;
}

function isLevel(value: unknown): value is PerformanceLevel {
  return value === 'S' || value === 'A' || value === 'B' || value === 'C';
}

export type ShadowComparison = {
  businessKey: string;
  legacyLevel: string | null;
  computedLevel: PerformanceLevel;
  different: boolean;
  reason: string;
  compositeScore: string;
};

/** 影子路径直接调用正式精确十进制计算引擎，确保报告不是另一套近似算法。 */
export function compareLegacyManagerLevel(input: {
  participantBusinessKey: string;
  legacyLevel: string | null;
  calculationInput: StageResultInput;
}): ShadowComparison {
  const result = calculateStageResult(input.calculationInput);
  const different = input.legacyLevel !== result.finalLevel;
  return {
    businessKey: input.participantBusinessKey,
    legacyLevel: input.legacyLevel,
    computedLevel: result.finalLevel,
    different,
    compositeScore: result.compositeScore,
    reason: different
      ? result.matchedConstraints.length > 0
        ? `命中约束：${result.matchedConstraints.map((item) => item.type).join(', ')}`
        : `综合分 ${result.compositeScore} 按新评级区间映射`
      : '新旧等级一致',
  };
}

export type ReadinessInput = {
  sourceCounts: Record<string, number>;
  targetCounts: Record<string, number>;
  missingBusinessKeys: string[];
  invalidDimensionResults: number;
  unclosedStatuses: number;
  migrationFailures: number;
  shadowComparisons: Array<{
    different: boolean;
    disposition: 'UNRESOLVED' | 'ACCEPTED';
    businessKey: string;
  }>;
};

export type ReadinessReport = {
  ready: boolean;
  blockers: Array<{ code: string; count: number; examples?: string[] }>;
  metrics: Record<string, number>;
  thresholds: Record<string, number>;
};

/** Ticket 21 的唯一切读门槛：所有强校验为零容忍，影子差异允许人工明确处置。 */
export function evaluateMigrationReadiness(
  input: ReadinessInput,
): ReadinessReport {
  const blockers: ReadinessReport['blockers'] = [];
  const countMismatches = Object.entries(input.sourceCounts).filter(
    ([key, count]) => input.targetCounts[key] !== count,
  );
  if (countMismatches.length > 0) {
    blockers.push({
      code: 'COUNT_MISMATCH',
      count: countMismatches.length,
      examples: countMismatches.map(
        ([key, count]) => `${key}:${count}->${input.targetCounts[key] ?? 0}`,
      ),
    });
  }
  addBlocker(
    blockers,
    'MISSING_BUSINESS_KEY',
    input.missingBusinessKeys.length,
    input.missingBusinessKeys,
  );
  addBlocker(
    blockers,
    'INVALID_DIMENSION_RESULT',
    input.invalidDimensionResults,
  );
  addBlocker(blockers, 'UNCLOSED_STATUS', input.unclosedStatuses);
  addBlocker(blockers, 'MIGRATION_FAILURE', input.migrationFailures);
  const unresolved = input.shadowComparisons.filter(
    (item) => item.different && item.disposition === 'UNRESOLVED',
  );
  addBlocker(
    blockers,
    'UNRESOLVED_SHADOW_DIFFERENCE',
    unresolved.length,
    unresolved.map((item) => item.businessKey),
  );
  return {
    ready: blockers.length === 0,
    blockers,
    metrics: {
      missingBusinessKeys: input.missingBusinessKeys.length,
      invalidDimensionResults: input.invalidDimensionResults,
      unclosedStatuses: input.unclosedStatuses,
      migrationFailures: input.migrationFailures,
      shadowDifferences: input.shadowComparisons.filter(
        (item) => item.different,
      ).length,
      unresolvedShadowDifferences: unresolved.length,
    },
    thresholds: {
      countMismatches: 0,
      missingBusinessKeys: 0,
      invalidDimensionResults: 0,
      unclosedStatuses: 0,
      migrationFailures: 0,
      unresolvedShadowDifferences: 0,
    },
  };
}

function addBlocker(
  blockers: ReadinessReport['blockers'],
  code: string,
  count: number,
  examples?: string[],
) {
  if (count > 0)
    blockers.push({
      code,
      count,
      ...(examples?.length ? { examples: examples.slice(0, 20) } : {}),
    });
}
