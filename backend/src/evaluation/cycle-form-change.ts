import type {
  FormSnapshotContent,
  FormSnapshotDimension,
  FormSnapshotItem,
  FormSnapshotSubform,
} from './evaluation.service-types';

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
    | 'DIMENSION_KIND_CHANGED'
    | 'ITEM_ADDED'
    | 'ITEM_REMOVED'
    | 'ITEM_MOVED'
    | 'ITEM_TYPE_CHANGED'
    | 'ITEM_REQUIRED_CHANGED'
    | 'ITEM_CONFIG_CHANGED'
    | 'DIMENSION_CALCULATION_CHANGED'
    | 'COPY_CHANGED';
  stage: HumanEvaluationStage;
  subformKey?: string;
  dimensionKey?: string;
  itemKey?: string;
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

type LocatedItem = LocatedDimension & { item: FormSnapshotItem };

const stageOrder: HumanEvaluationStage[] = ['SELF', 'PEER', 'MANAGER'];

/**
 * 比较完整周期表单快照并输出管理端可解释分类。
 * 优先级为 STRUCTURAL > CALCULATION > COPY_ONLY，混合修改不会被较轻分类掩盖。
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
  const beforeItems = flattenItems(before);
  const afterItems = flattenItems(after);

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
          `子表单 ${key} 的类型发生变化`,
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
        detail('DIMENSION_REMOVED', located.stage, `删除维度 ${key}`, {
          subformKey: located.subform.key,
          dimensionKey: key,
        }),
      );
      continue;
    }
    if (
      located.subform.key !== next.subform.key ||
      located.dimension.audience !== next.dimension.audience ||
      located.stage !== next.stage
    ) {
      changes.push(
        detail(
          'DIMENSION_MOVED',
          located.stage,
          `维度 ${key} 的子表单或填写角色发生变化`,
          {
            subformKey: located.subform.key,
            dimensionKey: key,
          },
        ),
      );
      if (next.stage !== located.stage) {
        changes.push(
          detail('DIMENSION_MOVED', next.stage, `维度 ${key} 移入该评估阶段`, {
            subformKey: next.subform.key,
            dimensionKey: key,
          }),
        );
      }
    }
    if (located.dimension.kind !== next.dimension.kind) {
      changes.push(
        detail(
          'DIMENSION_KIND_CHANGED',
          next.stage,
          `维度 ${key} 的业务类型发生变化`,
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
          `维度 ${key} 的权重或核心标记发生变化`,
          {
            subformKey: next.subform.key,
            dimensionKey: key,
          },
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
          `维度 ${key} 的文案或展示顺序发生变化`,
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
        detail('DIMENSION_ADDED', located.stage, `新增维度 ${key}`, {
          subformKey: located.subform.key,
          dimensionKey: key,
        }),
      );
    }
  }

  for (const [key, located] of beforeItems) {
    const next = afterItems.get(key);
    if (!next) {
      changes.push(
        detail(
          'ITEM_REMOVED',
          located.stage,
          `删除评估项 ${key}`,
          location(located),
        ),
      );
      continue;
    }
    if (
      located.subform.key !== next.subform.key ||
      located.dimension.key !== next.dimension.key ||
      located.dimension.audience !== next.dimension.audience ||
      located.stage !== next.stage
    ) {
      changes.push(
        detail(
          'ITEM_MOVED',
          located.stage,
          `评估项 ${key} 的维度或填写角色发生变化`,
          location(located),
        ),
      );
      if (next.stage !== located.stage) {
        changes.push(
          detail(
            'ITEM_MOVED',
            next.stage,
            `评估项 ${key} 移入该评估阶段`,
            location(next),
          ),
        );
      }
    }
    if (located.item.type !== next.item.type) {
      changes.push(
        detail(
          'ITEM_TYPE_CHANGED',
          next.stage,
          `评估项 ${key} 的输入类型发生变化`,
          location(next),
        ),
      );
    }
    if (Boolean(located.item.required) !== Boolean(next.item.required)) {
      changes.push(
        detail(
          'ITEM_REQUIRED_CHANGED',
          next.stage,
          `评估项 ${key} 的必填规则发生变化`,
          location(next),
        ),
      );
    }
    if (
      canonicalJson(located.item.config ?? null) !==
      canonicalJson(next.item.config ?? null)
    ) {
      changes.push(
        detail(
          'ITEM_CONFIG_CHANGED',
          next.stage,
          `评估项 ${key} 的受控输入配置发生变化`,
          location(next),
        ),
      );
    }
    if (copyFingerprint(located.item) !== copyFingerprint(next.item)) {
      changes.push(
        detail(
          'COPY_CHANGED',
          next.stage,
          `评估项 ${key} 的文案或展示顺序发生变化`,
          location(next),
        ),
      );
    }
  }
  for (const [key, located] of afterItems) {
    if (!beforeItems.has(key)) {
      changes.push(
        detail(
          'ITEM_ADDED',
          located.stage,
          `新增评估项 ${key}`,
          location(located),
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
          {
            subformKey: key,
          },
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
    'DIMENSION_KIND_CHANGED',
    'ITEM_ADDED',
    'ITEM_REMOVED',
    'ITEM_MOVED',
    'ITEM_TYPE_CHANGED',
    'ITEM_REQUIRED_CHANGED',
    'ITEM_CONFIG_CHANGED',
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

export type ExistingAnswerIdentity = {
  itemKey: string;
  itemType: string;
  subformKey: string;
  dimensionKey: string;
};

/** 为单份答卷输出稳定 key 迁移计划；只保留新结构中同类型的项目。 */
export function buildCycleFormChangePlan(
  after: FormSnapshotContent,
  stage: HumanEvaluationStage,
  items: readonly ExistingAnswerIdentity[],
) {
  const nextItems = flattenItems(after);
  const compatibleItems: Array<ExistingAnswerIdentity> = [];
  const incompatibleItemKeys: string[] = [];
  for (const item of items) {
    const next = nextItems.get(item.itemKey);
    if (!next || next.stage !== stage || next.item.type !== item.itemType) {
      incompatibleItemKeys.push(item.itemKey);
      continue;
    }
    compatibleItems.push({
      ...item,
      itemType: next.item.type,
      subformKey: next.subform.key,
      dimensionKey: next.dimension.key,
    });
  }
  return { compatibleItems, incompatibleItemKeys };
}

function flattenDimensions(content: FormSnapshotContent) {
  const result = new Map<string, LocatedDimension>();
  for (const subform of content.subforms) {
    for (const dimension of subform.dimensions) {
      result.set(dimension.key, {
        subform,
        dimension,
        stage: stageOf(subform, dimension),
      });
    }
  }
  return result;
}

function flattenItems(content: FormSnapshotContent) {
  const result = new Map<string, LocatedItem>();
  for (const located of flattenDimensions(content).values()) {
    for (const item of located.dimension.items) {
      result.set(item.key, { ...located, item });
    }
  }
  return result;
}

function mapByKey<T extends { key: string }>(items: readonly T[]) {
  return new Map(items.map((item) => [item.key, item]));
}

function stageOf(
  subform: FormSnapshotSubform,
  dimension?: FormSnapshotDimension,
): HumanEvaluationStage {
  if (subform.type === 'PEER') return 'PEER';
  if (subform.type === 'MANAGER') return 'MANAGER';
  if (subform.type === 'PROMOTION') {
    return dimension?.audience === 'LEADER' ? 'MANAGER' : 'SELF';
  }
  return 'SELF';
}

function detail(
  kind: CycleFormChangeDetail['kind'],
  stage: HumanEvaluationStage,
  message: string,
  rest: Pick<CycleFormChangeDetail, 'subformKey' | 'dimensionKey' | 'itemKey'>,
): CycleFormChangeDetail {
  return { kind, stage, message, ...rest };
}

function location(located: LocatedItem) {
  return {
    subformKey: located.subform.key,
    dimensionKey: located.dimension.key,
    itemKey: located.item.key,
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
    return '非结构性计算规则变更应继续使用活动周期配置版本与重算流程，不在表单结构变更中直接应用。';
  }
  if (category === 'COPY_ONLY') {
    return '纯文案或展示顺序变更不会改变答卷状态，已有评估无需重新提交。';
  }
  return '未检测到表单变更。';
}
