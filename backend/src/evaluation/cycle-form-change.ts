import type {
  FormSnapshotContent,
  FormSnapshotDimension,
  FormSnapshotField,
  FormSnapshotSubform,
} from './evaluation.service-types';
import { isFormFieldValueCompatible } from './form-field-value-compatibility';

export type HumanEvaluationStage = 'SELF' | 'PEER' | 'MANAGER';
export type CycleFormChangeCategory =
  'NONE' | 'COPY_ONLY' | 'CALCULATION' | 'STRUCTURAL';

export type CycleFormChangeDetail = {
  kind:
    | 'SUBFORM_ADDED'
    | 'SUBFORM_REMOVED'
    | 'SUBFORM_TYPE_CHANGED'
    | 'DIMENSION_ADDED'
    | 'DIMENSION_REMOVED'
    | 'DIMENSION_MOVED'
    | 'DIMENSION_TYPE_CHANGED'
    | 'DIMENSION_SCORING_METHOD_CHANGED'
    | 'DIMENSION_CALCULATION_CHANGED'
    | 'FIELD_ADDED'
    | 'FIELD_REMOVED'
    | 'FIELD_MOVED'
    | 'FIELD_TYPE_CHANGED'
    | 'FIELD_REQUIRED_RULE_CHANGED'
    | 'FIELD_REQUIRED_LEVELS_CHANGED'
    | 'FIELD_CONFIG_CHANGED'
    | 'COPY_CHANGED';
  stage: HumanEvaluationStage;
  subformKey?: string;
  dimensionKey?: string;
  fieldKey?: string;
  message: string;
};

export type CycleFormChangeClassification = {
  category: CycleFormChangeCategory;
  affectedStages: HumanEvaluationStage[];
  changes: CycleFormChangeDetail[];
  explanation: string;
};

type LocatedDimension = {
  subform: FormSnapshotSubform;
  dimension: FormSnapshotDimension;
  stage: HumanEvaluationStage;
};

type LocatedField = LocatedDimension & { field: FormSnapshotField };

const stageOrder: HumanEvaluationStage[] = ['SELF', 'PEER', 'MANAGER'];

/**
 * 按稳定业务 key 比较完整周期表单快照。身份与兼容性分开：改名、
 * 排序不改身份，计分方式、字段类型和必填规则变更则明确标记结构影响。
 */
export function classifyCycleFormChange(
  before: FormSnapshotContent,
  after: FormSnapshotContent,
): CycleFormChangeClassification {
  const changes: CycleFormChangeDetail[] = [];
  const beforeSubforms = mapByKey(before.subforms);
  const afterSubforms = mapByKey(after.subforms);
  const beforeDimensions = flattenDimensions(before);
  const afterDimensions = flattenDimensions(after);
  const beforeFields = flattenFields(before);
  const afterFields = flattenFields(after);

  if (copyFingerprint(before) !== copyFingerprint(after)) {
    changes.push(detail('COPY_CHANGED', 'SELF', '表单名称或说明发生变化', {}));
  }

  for (const [key, subform] of beforeSubforms) {
    const next = afterSubforms.get(key);
    if (!next) {
      changes.push(
        detail('SUBFORM_REMOVED', stageOf(subform), `删除子表单 ${key}`, {
          subformKey: key,
        }),
      );
    } else if (subform.type !== next.type) {
      changes.push(
        detail(
          'SUBFORM_TYPE_CHANGED',
          stageOf(subform),
          `子表单 ${key} 的评估阶段发生变化`,
          { subformKey: key },
        ),
      );
      if (stageOf(subform) !== stageOf(next)) {
        changes.push(
          detail(
            'SUBFORM_TYPE_CHANGED',
            stageOf(next),
            `子表单 ${key} 移入该评估阶段`,
            { subformKey: key },
          ),
        );
      }
    }
  }
  for (const [key, subform] of afterSubforms) {
    if (!beforeSubforms.has(key)) {
      changes.push(
        detail('SUBFORM_ADDED', stageOf(subform), `新增子表单 ${key}`, {
          subformKey: key,
        }),
      );
    }
  }

  for (const [key, located] of beforeDimensions) {
    const next = afterDimensions.get(key);
    if (!next) {
      changes.push(
        detail('DIMENSION_REMOVED', located.stage, `删除评估维度 ${key}`, {
          subformKey: located.subform.key,
          dimensionKey: key,
        }),
      );
      continue;
    }
    if (
      located.subform.key !== next.subform.key ||
      located.stage !== next.stage
    ) {
      changes.push(
        detail(
          'DIMENSION_MOVED',
          located.stage,
          `评估维度 ${key} 的子表单或填写角色发生变化`,
          { subformKey: located.subform.key, dimensionKey: key },
        ),
      );
      if (next.stage !== located.stage) {
        changes.push(
          detail(
            'DIMENSION_MOVED',
            next.stage,
            `评估维度 ${key} 移入该评估阶段`,
            {
              subformKey: next.subform.key,
              dimensionKey: key,
            },
          ),
        );
      }
    }
    if (located.dimension.type !== next.dimension.type) {
      changes.push(
        detail(
          'DIMENSION_TYPE_CHANGED',
          next.stage,
          `评估维度 ${key} 的计分/非计分类型发生变化`,
          { subformKey: next.subform.key, dimensionKey: key },
        ),
      );
    }
    if (
      normalized(located.dimension.scoringMethod) !==
      normalized(next.dimension.scoringMethod)
    ) {
      changes.push(
        detail(
          'DIMENSION_SCORING_METHOD_CHANGED',
          next.stage,
          `评估维度 ${key} 的计分方式发生变化，旧计分值将失效`,
          { subformKey: next.subform.key, dimensionKey: key },
        ),
      );
    }
    if (
      normalized(located.dimension.weight) !==
        normalized(next.dimension.weight) ||
      Boolean(located.dimension.isCore) !== Boolean(next.dimension.isCore)
    ) {
      changes.push(
        detail(
          'DIMENSION_CALCULATION_CHANGED',
          next.stage,
          `评估维度 ${key} 的占比或核心标记发生变化`,
          { subformKey: next.subform.key, dimensionKey: key },
        ),
      );
    }
    if (
      copyFingerprint(located.dimension) !== copyFingerprint(next.dimension)
    ) {
      changes.push(
        detail(
          'COPY_CHANGED',
          next.stage,
          `评估维度 ${key} 的文案或展示顺序发生变化`,
          {
            subformKey: next.subform.key,
            dimensionKey: key,
          },
        ),
      );
    }
  }
  for (const [key, located] of afterDimensions) {
    if (!beforeDimensions.has(key)) {
      changes.push(
        detail('DIMENSION_ADDED', located.stage, `新增评估维度 ${key}`, {
          subformKey: located.subform.key,
          dimensionKey: key,
        }),
      );
    }
  }

  for (const [key, located] of beforeFields) {
    const next = afterFields.get(key);
    if (!next) {
      changes.push(
        detail(
          'FIELD_REMOVED',
          located.stage,
          `删除表单字段 ${key}`,
          fieldLocation(located),
        ),
      );
      continue;
    }
    if (
      located.subform.key !== next.subform.key ||
      located.dimension.key !== next.dimension.key ||
      located.stage !== next.stage
    ) {
      changes.push(
        detail(
          'FIELD_MOVED',
          located.stage,
          `表单字段 ${key} 移至其他评估维度或填写角色`,
          fieldLocation(located),
        ),
      );
      if (next.stage !== located.stage) {
        changes.push(
          detail(
            'FIELD_MOVED',
            next.stage,
            `表单字段 ${key} 移入该评估阶段`,
            fieldLocation(next),
          ),
        );
      }
    }
    if (located.field.type !== next.field.type) {
      changes.push(
        detail(
          'FIELD_TYPE_CHANGED',
          next.stage,
          `表单字段 ${key} 的输入类型发生变化，旧值将失效`,
          fieldLocation(next),
        ),
      );
    }
    if (located.field.requiredRule !== next.field.requiredRule) {
      changes.push(
        detail(
          'FIELD_REQUIRED_RULE_CHANGED',
          next.stage,
          `表单字段 ${key} 的必填规则发生变化`,
          fieldLocation(next),
        ),
      );
    }
    if (
      canonicalJson(located.field.requiredLevels ?? []) !==
      canonicalJson(next.field.requiredLevels ?? [])
    ) {
      changes.push(
        detail(
          'FIELD_REQUIRED_LEVELS_CHANGED',
          next.stage,
          `表单字段 ${key} 的条件必填等级发生变化`,
          fieldLocation(next),
        ),
      );
    }
    if (
      canonicalJson(located.field.config ?? null) !==
      canonicalJson(next.field.config ?? null)
    ) {
      changes.push(
        detail(
          'FIELD_CONFIG_CHANGED',
          next.stage,
          `表单字段 ${key} 的受控输入配置发生变化`,
          fieldLocation(next),
        ),
      );
    }
    if (copyFingerprint(located.field) !== copyFingerprint(next.field)) {
      changes.push(
        detail(
          'COPY_CHANGED',
          next.stage,
          `表单字段 ${key} 的文案或展示顺序发生变化`,
          fieldLocation(next),
        ),
      );
    }
  }
  for (const [key, located] of afterFields) {
    if (!beforeFields.has(key)) {
      changes.push(
        detail(
          'FIELD_ADDED',
          located.stage,
          `新增表单字段 ${key}`,
          fieldLocation(located),
        ),
      );
    }
  }

  for (const [key, subform] of beforeSubforms) {
    const next = afterSubforms.get(key);
    if (next && copyFingerprint(subform) !== copyFingerprint(next)) {
      changes.push(
        detail(
          'COPY_CHANGED',
          stageOf(next),
          `子表单 ${key} 的文案或展示顺序发生变化`,
          { subformKey: key },
        ),
      );
    }
  }

  const structuralKinds = new Set<CycleFormChangeDetail['kind']>([
    'SUBFORM_ADDED',
    'SUBFORM_REMOVED',
    'SUBFORM_TYPE_CHANGED',
    'DIMENSION_ADDED',
    'DIMENSION_REMOVED',
    'DIMENSION_MOVED',
    'DIMENSION_TYPE_CHANGED',
    'DIMENSION_SCORING_METHOD_CHANGED',
    'FIELD_ADDED',
    'FIELD_REMOVED',
    'FIELD_MOVED',
    'FIELD_TYPE_CHANGED',
    'FIELD_REQUIRED_RULE_CHANGED',
    'FIELD_REQUIRED_LEVELS_CHANGED',
    'FIELD_CONFIG_CHANGED',
  ]);
  const structural = changes.some((change) => structuralKinds.has(change.kind));
  const calculation = changes.some(
    (change) => change.kind === 'DIMENSION_CALCULATION_CHANGED',
  );
  const copy = changes.some((change) => change.kind === 'COPY_CHANGED');
  const category: CycleFormChangeCategory = structural
    ? 'STRUCTURAL'
    : calculation
      ? 'CALCULATION'
      : copy
        ? 'COPY_ONLY'
        : 'NONE';
  const affectedStages = stageOrder.filter((stage) =>
    changes.some(
      (change) =>
        change.stage === stage &&
        (category === 'STRUCTURAL'
          ? structuralKinds.has(change.kind)
          : category === 'CALCULATION'
            ? change.kind === 'DIMENSION_CALCULATION_CHANGED'
            : false),
    ),
  );
  return {
    category,
    affectedStages,
    changes,
    explanation: explanationOf(category),
  };
}

export type ExistingDimensionAnswer = {
  subformKey: string;
  dimensionKey: string;
  scoringMethod: string | null;
  rawLevel: 'S' | 'A' | 'B' | 'C' | null;
  rawScore: { toString(): string } | number | string | null;
  fields: readonly ExistingFieldAnswer[];
};

export type ExistingFieldAnswer = {
  fieldKey: string;
  fieldType: string;
  value: unknown;
};

/**
 * 稳定 key 只负责匹配身份，值是否可预填由新结构再判断。字段移维度时
 * 按 fieldKey 改挂新父维度；类型或受控选项不兼容时明确列入失效集。
 */
export function buildCycleFormChangePlan(
  after: FormSnapshotContent,
  stage: HumanEvaluationStage,
  dimensions: readonly ExistingDimensionAnswer[],
) {
  const nextDimensions = flattenDimensions(after);
  const nextFields = flattenFields(after);
  const compatibleDimensionAnswers: Array<{
    subformKey: string;
    dimensionKey: string;
    scoringMethod: 'RATING' | 'SCORE';
    rawLevel: ExistingDimensionAnswer['rawLevel'];
    rawScore: ExistingDimensionAnswer['rawScore'];
  }> = [];
  const compatibleFieldAnswers: Array<{
    subformKey: string;
    dimensionKey: string;
    fieldKey: string;
    fieldType: FormSnapshotField['type'];
    value: unknown;
  }> = [];
  const incompatibleAnswerKeys: string[] = [];

  for (const answer of dimensions) {
    const next = nextDimensions.get(answer.dimensionKey);
    const scoringCompatible =
      next?.stage === stage &&
      next.dimension.type === 'SCORING' &&
      (next.dimension.scoringMethod === 'RATING' ||
        next.dimension.scoringMethod === 'SCORE') &&
      next.dimension.scoringMethod === answer.scoringMethod;
    const hasScoringValue = answer.rawLevel != null || answer.rawScore != null;
    if (scoringCompatible && hasScoringValue) {
      compatibleDimensionAnswers.push({
        subformKey: next.subform.key,
        dimensionKey: next.dimension.key,
        scoringMethod: next.dimension.scoringMethod!,
        rawLevel: answer.rawLevel,
        rawScore: answer.rawScore,
      });
    } else if (hasScoringValue) {
      incompatibleAnswerKeys.push(`dimension:${answer.dimensionKey}:scoring`);
    }

    for (const fieldAnswer of answer.fields) {
      const nextField = nextFields.get(fieldAnswer.fieldKey);
      if (
        !nextField ||
        nextField.stage !== stage ||
        nextField.field.type !== fieldAnswer.fieldType ||
        !isFormFieldValueCompatible(nextField.field, fieldAnswer.value)
      ) {
        incompatibleAnswerKeys.push(`field:${fieldAnswer.fieldKey}`);
        continue;
      }
      compatibleFieldAnswers.push({
        subformKey: nextField.subform.key,
        dimensionKey: nextField.dimension.key,
        fieldKey: nextField.field.key,
        fieldType: nextField.field.type,
        value: fieldAnswer.value,
      });
    }
  }
  return {
    compatibleDimensionAnswers,
    compatibleFieldAnswers,
    incompatibleAnswerKeys,
  };
}

function flattenDimensions(content: FormSnapshotContent) {
  const result = new Map<string, LocatedDimension>();
  for (const subform of content.subforms) {
    for (const dimension of subform.dimensions) {
      result.set(dimension.key, {
        subform,
        dimension,
        stage: stageOf(subform),
      });
    }
  }
  return result;
}

function flattenFields(content: FormSnapshotContent) {
  const result = new Map<string, LocatedField>();
  for (const located of flattenDimensions(content).values()) {
    for (const field of located.dimension.fields ?? []) {
      result.set(field.key, { ...located, field });
    }
  }
  return result;
}

function mapByKey<T extends { key: string }>(items: readonly T[]) {
  return new Map(items.map((item) => [item.key, item]));
}

function stageOf(subform: FormSnapshotSubform): HumanEvaluationStage {
  return subform.type === 'PEER'
    ? 'PEER'
    : subform.type === 'MANAGER'
      ? 'MANAGER'
      : 'SELF';
}

function detail(
  kind: CycleFormChangeDetail['kind'],
  stage: HumanEvaluationStage,
  message: string,
  rest: Pick<CycleFormChangeDetail, 'subformKey' | 'dimensionKey' | 'fieldKey'>,
): CycleFormChangeDetail {
  return { kind, stage, message, ...rest };
}

function fieldLocation(located: LocatedField) {
  return {
    subformKey: located.subform.key,
    dimensionKey: located.dimension.key,
    fieldKey: located.field.key,
  };
}

function normalized(value: string | number | null | undefined) {
  return value === undefined || value === null ? null : String(value);
}

function copyFingerprint(value: unknown) {
  if (!value || typeof value !== 'object') return canonicalJson(value);
  const source = value as Record<string, unknown>;
  return canonicalJson({
    title: source.title ?? null,
    name: source.name ?? null,
    description: source.description ?? null,
    placeholder: source.placeholder ?? null,
    sortOrder: source.sortOrder ?? null,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function explanationOf(category: CycleFormChangeCategory) {
  if (category === 'STRUCTURAL') {
    return '结构性变更会改变答卷完整性或计算语义；已有正式提交时必须先整体退回 DRAFT，受影响答卷需要重新提交。';
  }
  if (category === 'CALCULATION') {
    return '维度占比或核心标记变更应使用活动周期配置版本与统一重算流程。';
  }
  if (category === 'COPY_ONLY') {
    return '纯文案或展示顺序变更不会改变答卷状态，已有评估无需重新提交。';
  }
  return '未检测到表单变更。';
}
