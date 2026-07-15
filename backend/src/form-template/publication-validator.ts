import {
  FORM_ITEM_TYPES,
  FORM_SUBFORM_TYPES,
  type FormItemConfig,
  type FormItemType,
  type FormTemplateVersionContract,
} from './form-template.contract';

export type FormTemplatePublicationIssue = {
  code: string;
  path: string;
  message: string;
};

const SCORING_ITEM_TYPES = new Set(['RATING', 'SCORE']);
const CONTROLLED_ITEM_TYPES = new Set<string>(FORM_ITEM_TYPES);

function percentageToHundredths(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const hundredths =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(hundredths) ? hundredths : null;
}

function hasDuplicate(values: readonly number[]) {
  return new Set(values).size !== values.length;
}

function hasOnlyKeys(config: FormItemConfig, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(config).every((key) => allowed.has(key));
}

function isNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function hasValidTextConfig(config: FormItemConfig) {
  if (!hasOnlyKeys(config, ['minLength', 'maxLength', 'defaultValue'])) {
    return false;
  }
  if (
    config.minLength !== undefined &&
    !isNonNegativeInteger(config.minLength)
  ) {
    return false;
  }
  if (
    config.maxLength !== undefined &&
    !isNonNegativeInteger(config.maxLength)
  ) {
    return false;
  }
  if (
    config.minLength !== undefined &&
    config.maxLength !== undefined &&
    config.minLength > config.maxLength
  ) {
    return false;
  }
  return (
    config.defaultValue === undefined || typeof config.defaultValue === 'string'
  );
}

function hasValidOptions(config: FormItemConfig) {
  if (!config.options || config.options.length === 0) return false;
  const values = config.options.map((option) => option.value.trim());
  return (
    config.options.every(
      (option) => option.value.trim() !== '' && option.label.trim() !== '',
    ) && new Set(values).size === values.length
  );
}

function isValidItemConfig(type: FormItemType, config?: FormItemConfig | null) {
  const value = config ?? {};
  if (type === 'RATING' || type === 'SCORE') {
    return Object.keys(value).length === 0;
  }
  if (type === 'SHORT_TEXT' || type === 'LONG_TEXT' || type === 'MARKDOWN') {
    return hasValidTextConfig(value);
  }
  if (type === 'SINGLE_SELECT') {
    return (
      hasOnlyKeys(value, ['options', 'employeeVisible']) &&
      hasValidOptions(value) &&
      (value.employeeVisible === undefined ||
        typeof value.employeeVisible === 'boolean')
    );
  }
  if (type === 'MULTI_SELECT') {
    if (
      !hasOnlyKeys(value, ['options', 'minSelections', 'maxSelections']) ||
      !hasValidOptions(value)
    ) {
      return false;
    }
    const min = value.minSelections ?? 0;
    const max = value.maxSelections ?? value.options!.length;
    return (
      isNonNegativeInteger(min) &&
      isNonNegativeInteger(max) &&
      min <= max &&
      max <= value.options!.length
    );
  }
  if (type === 'ATTACHMENT') {
    if (!hasOnlyKeys(value, ['maxFiles', 'maxSizeMb', 'allowedExtensions'])) {
      return false;
    }
    if (
      value.maxFiles !== undefined &&
      (!Number.isInteger(value.maxFiles) || value.maxFiles <= 0)
    ) {
      return false;
    }
    if (
      value.maxSizeMb !== undefined &&
      (!Number.isFinite(value.maxSizeMb) || value.maxSizeMb <= 0)
    ) {
      return false;
    }
    if (value.allowedExtensions) {
      const extensions = value.allowedExtensions.map((item) => item.trim());
      if (
        extensions.length === 0 ||
        extensions.some((item) => item === '') ||
        new Set(extensions).size !== extensions.length
      ) {
        return false;
      }
    }
    return true;
  }
  if (type === 'LINK') {
    if (!hasOnlyKeys(value, ['maxLength', 'allowedProtocols'])) return false;
    if (
      value.maxLength !== undefined &&
      (!Number.isInteger(value.maxLength) || value.maxLength <= 0)
    ) {
      return false;
    }
    if (value.allowedProtocols) {
      const protocols = value.allowedProtocols;
      if (
        protocols.length === 0 ||
        protocols.some((protocol) => !['http', 'https'].includes(protocol)) ||
        new Set(protocols).size !== protocols.length
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/** 发布校验公开入口；返回空数组表示版本内容满足发布条件。 */
export function validateFormTemplatePublication(
  template: FormTemplateVersionContract,
): FormTemplatePublicationIssue[] {
  const issues: FormTemplatePublicationIssue[] = [];
  const counts = new Map<string, number>();

  for (const subform of template.subforms) {
    counts.set(subform.type, (counts.get(subform.type) ?? 0) + 1);
  }

  for (const type of FORM_SUBFORM_TYPES) {
    const count = counts.get(type) ?? 0;
    if (count > 1) {
      issues.push({
        code: 'SUBFORM_DUPLICATE',
        path: `subforms.${type}`,
        message: `${type} 子表单只能存在一个`,
      });
    }
  }
  for (const type of FORM_SUBFORM_TYPES) {
    if (!counts.has(type)) {
      issues.push({
        code: 'SUBFORM_REQUIRED',
        path: `subforms.${type}`,
        message: `缺少 ${type} 子表单`,
      });
    }
  }

  template.subforms.forEach((subform, subformIndex) => {
    if (!Number.isInteger(subform.sortOrder) || subform.sortOrder < 0) {
      issues.push({
        code: 'SUBFORM_SORT_ORDER_INVALID',
        path: `subforms[${subformIndex}].sortOrder`,
        message: '子表单排序必须是非负整数',
      });
    }
  });
  if (hasDuplicate(template.subforms.map((subform) => subform.sortOrder))) {
    issues.push({
      code: 'SUBFORM_SORT_ORDER_DUPLICATE',
      path: 'subforms.sortOrder',
      message: '同一版本内的子表单排序不能重复',
    });
  }

  const expectedAudience = {
    SELF: 'EMPLOYEE',
    PEER: 'REVIEWER',
    MANAGER: 'LEADER',
  } as const;
  for (const subform of template.subforms) {
    subform.dimensions.forEach((dimension, dimensionIndex) => {
      if (
        subform.type !== 'PROMOTION' &&
        dimension.audience !== expectedAudience[subform.type]
      ) {
        issues.push({
          code: 'DIMENSION_AUDIENCE_INVALID',
          path: `subforms.${subform.type}.dimensions[${dimensionIndex}].audience`,
          message: `${subform.type} 维度填写对象不合法`,
        });
      }
      if (subform.type === 'PROMOTION' && dimension.kind !== 'PROMOTION') {
        issues.push({
          code: 'PROMOTION_DIMENSION_KIND_INVALID',
          path: `subforms.PROMOTION.dimensions[${dimensionIndex}].kind`,
          message: 'PROMOTION 子表单只能包含 PROMOTION 维度',
        });
      }
      if (subform.type !== 'PROMOTION' && dimension.kind === 'PROMOTION') {
        issues.push({
          code: 'DIMENSION_KIND_INVALID',
          path: `subforms.${subform.type}.dimensions[${dimensionIndex}].kind`,
          message: '晋升维度只能归属 PROMOTION 子表单',
        });
      }
    });
  }

  for (const subform of template.subforms) {
    subform.dimensions.forEach((dimension, dimensionIndex) => {
      if (!Number.isInteger(dimension.sortOrder) || dimension.sortOrder < 0) {
        issues.push({
          code: 'DIMENSION_SORT_ORDER_INVALID',
          path: `subforms.${subform.type}.dimensions[${dimensionIndex}].sortOrder`,
          message: '维度排序必须是非负整数',
        });
      }
    });
    for (const audience of ['EMPLOYEE', 'REVIEWER', 'LEADER'] as const) {
      const audienceOrders = subform.dimensions
        .filter((dimension) => dimension.audience === audience)
        .map((dimension) => dimension.sortOrder);
      if (hasDuplicate(audienceOrders)) {
        issues.push({
          code: 'DIMENSION_SORT_ORDER_DUPLICATE',
          path: `subforms.${subform.type}.dimensions.sortOrder`,
          message: '同一子表单、同一填写对象内的维度排序不能重复',
        });
      }
    }

    subform.dimensions.forEach((dimension, dimensionIndex) => {
      dimension.items.forEach((item, itemIndex) => {
        if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0) {
          issues.push({
            code: 'ITEM_SORT_ORDER_INVALID',
            path: `subforms.${subform.type}.dimensions[${dimensionIndex}].items[${itemIndex}].sortOrder`,
            message: '评估项排序必须是非负整数',
          });
        }
      });
      if (hasDuplicate(dimension.items.map((item) => item.sortOrder))) {
        issues.push({
          code: 'ITEM_SORT_ORDER_DUPLICATE',
          path: `subforms.${subform.type}.dimensions[${dimensionIndex}].items.sortOrder`,
          message: '同一维度内的评估项排序不能重复',
        });
      }
    });
  }

  for (const subform of template.subforms) {
    subform.dimensions.forEach((dimension, dimensionIndex) => {
      dimension.items.forEach((item, itemIndex) => {
        const itemPath = `subforms.${subform.type}.dimensions[${dimensionIndex}].items[${itemIndex}]`;
        if (!CONTROLLED_ITEM_TYPES.has(item.type)) {
          issues.push({
            code: 'ITEM_TYPE_INVALID',
            path: `${itemPath}.type`,
            message: '评估项必须使用受控组件类型',
          });
          return;
        }
        if (!isValidItemConfig(item.type, item.config)) {
          issues.push({
            code: 'ITEM_CONFIG_INVALID',
            path: `${itemPath}.config`,
            message: `${item.type} 的组件配置不合法`,
          });
        }
      });
    });
  }

  for (const subform of template.subforms) {
    if (subform.type !== 'PEER' && subform.type !== 'MANAGER') continue;

    const regularDimensions = subform.dimensions.filter(
      (dimension) => dimension.kind === 'REGULAR',
    );
    regularDimensions.forEach((dimension, dimensionIndex) => {
      if (percentageToHundredths(dimension.weight) === null) {
        const originalIndex = subform.dimensions.indexOf(dimension);
        issues.push({
          code: 'DIMENSION_WEIGHT_INVALID',
          path: `subforms.${subform.type}.dimensions[${originalIndex >= 0 ? originalIndex : dimensionIndex}].weight`,
          message: `${subform.type} 的每个常规维度都必须设置合法权重`,
        });
      }
    });
    const total = regularDimensions.reduce(
      (sum, dimension) => sum + (percentageToHundredths(dimension.weight) ?? 0),
      0,
    );
    if (total !== 10_000) {
      issues.push({
        code: 'DIMENSION_WEIGHT_TOTAL_INVALID',
        path: `subforms.${subform.type}.dimensions`,
        message: `${subform.type} 常规维度权重合计必须为 100%`,
      });
    }

    const coreCount = regularDimensions.filter(
      (dimension) => dimension.isCore,
    ).length;
    if (coreCount !== 1) {
      issues.push({
        code: 'CORE_DIMENSION_COUNT_INVALID',
        path: `subforms.${subform.type}.dimensions`,
        message: `${subform.type} 必须且只能有一个核心维度`,
      });
    }
  }

  for (const subform of template.subforms) {
    const scoringTypes = new Set<string>();
    subform.dimensions.forEach((dimension, dimensionIndex) => {
      const scoringItems = dimension.items.filter((item) =>
        SCORING_ITEM_TYPES.has(item.type),
      );
      if (dimension.kind === 'REGULAR' && scoringItems.length !== 1) {
        issues.push({
          code: 'SCORING_ITEM_COUNT_INVALID',
          path: `subforms.${subform.type}.dimensions[${dimensionIndex}].items`,
          message: '每个常规维度必须且只能有一个计分项',
        });
      }
      if (dimension.kind !== 'REGULAR' && scoringItems.length > 0) {
        issues.push({
          code: 'NON_SCORING_DIMENSION_HAS_SCORING_ITEM',
          path: `subforms.${subform.type}.dimensions[${dimensionIndex}].items`,
          message: 'TEXT 与 PROMOTION 维度不能包含评级或评分项',
        });
      }
      if (dimension.kind === 'REGULAR') {
        scoringItems.forEach((item) => scoringTypes.add(item.type));
      }
    });

    if (
      (subform.type === 'PEER' || subform.type === 'MANAGER') &&
      scoringTypes.size > 1
    ) {
      issues.push({
        code: 'SCORING_TYPE_MIXED',
        path: `subforms.${subform.type}.dimensions`,
        message: `${subform.type} 的常规维度不能混用评级和评分项`,
      });
    }
  }

  const self = template.subforms.find((subform) => subform.type === 'SELF');
  if (self) {
    const scoringItems = self.dimensions.flatMap((dimension) =>
      dimension.items.filter((item) => SCORING_ITEM_TYPES.has(item.type)),
    );
    if (
      scoringItems.length !== 1 ||
      scoringItems[0]?.type !== 'RATING' ||
      !scoringItems[0].required
    ) {
      issues.push({
        code: 'SELF_RATING_INVALID',
        path: 'subforms.SELF',
        message: 'SELF 必须且只能包含一个必填 RATING 自评等级项',
      });
    }
  }

  const promotion = template.subforms.find(
    (subform) => subform.type === 'PROMOTION',
  );
  if (promotion) {
    promotion.dimensions.forEach((dimension, dimensionIndex) => {
      if (!['EMPLOYEE', 'LEADER'].includes(dimension.audience)) {
        issues.push({
          code: 'PROMOTION_ROLE_INVALID',
          path: `subforms.PROMOTION.dimensions[${dimensionIndex}].audience`,
          message: 'PROMOTION 维度只能属于 EMPLOYEE 或 LEADER 区段',
        });
      }
    });

    for (const role of ['EMPLOYEE', 'LEADER'] as const) {
      const hasContent = promotion.dimensions.some(
        (dimension) =>
          dimension.audience === role && dimension.items.length > 0,
      );
      if (!hasContent) {
        issues.push({
          code: 'PROMOTION_ROLE_CONTENT_MISSING',
          path: `subforms.PROMOTION.${role}`,
          message: `PROMOTION ${role} 区段至少需要一个评估项`,
        });
      }
    }
  }

  return issues;
}
