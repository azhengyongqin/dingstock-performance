import {
  FORM_FIELD_REQUIRED_RULES,
  FORM_FIELD_TYPES,
  FORM_RATING_LEVELS,
  FORM_SCORING_METHODS,
  FORM_SUBFORM_TYPES,
  type FormFieldConfig,
  type FormFieldType,
  type FormTemplateVersionContract,
} from './form-template.contract';

export type FormTemplatePublicationIssue = {
  code: string;
  path: string;
  message: string;
};

const SUBFORM_LABEL = {
  SELF: '员工自评',
  PEER: '360°评估',
  MANAGER: '上级评估',
} as const;

const FIELD_TYPE_LABEL: Record<FormFieldType, string> = {
  SHORT_TEXT: '单行文本',
  LONG_TEXT: '多行文本',
  MARKDOWN: 'Markdown',
  SINGLE_SELECT: '单选',
  MULTI_SELECT: '多选',
  ATTACHMENT: '文件附件',
  LINK: '链接',
};

function percentageToHundredths(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) return null;
  const result =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
}

function hasDuplicate<T>(values: readonly T[]) {
  return new Set(values).size !== values.length;
}

function hasOnlyKeys(config: FormFieldConfig, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(config).every((key) => allowed.has(key));
}

function isNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function hasValidTextConfig(config: FormFieldConfig) {
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

function hasValidOptions(config: FormFieldConfig) {
  if (!config.options || config.options.length === 0) return false;
  const values = config.options.map((option) => option.value.trim());
  return (
    config.options.every(
      (option) => option.value.trim() !== '' && option.label.trim() !== '',
    ) && new Set(values).size === values.length
  );
}

function isValidFieldConfig(
  type: FormFieldType,
  config?: FormFieldConfig | null,
) {
  const value = config ?? {};
  if (type === 'SHORT_TEXT' || type === 'LONG_TEXT' || type === 'MARKDOWN') {
    return hasValidTextConfig(value);
  }
  if (type === 'SINGLE_SELECT') {
    return hasOnlyKeys(value, ['options']) && hasValidOptions(value);
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
      if (
        value.allowedProtocols.length === 0 ||
        value.allowedProtocols.some(
          (protocol) => !['http', 'https'].includes(protocol),
        ) ||
        new Set(value.allowedProtocols).size !== value.allowedProtocols.length
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/** 发布校验公开入口；草稿可不完整，只有发布动作调用本函数。 */
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
    if (count === 0) {
      issues.push({
        code: 'SUBFORM_REQUIRED',
        path: `subforms.${type}`,
        message: `缺少${SUBFORM_LABEL[type]}子表单`,
      });
    } else if (count > 1) {
      issues.push({
        code: 'SUBFORM_DUPLICATE',
        path: `subforms.${type}`,
        message: `${SUBFORM_LABEL[type]}子表单只能存在一个`,
      });
    }
  }
  if (
    template.subforms.some(
      (subform) => !FORM_SUBFORM_TYPES.includes(subform.type),
    )
  ) {
    issues.push({
      code: 'SUBFORM_TYPE_INVALID',
      path: 'subforms',
      message: '绩效表单只允许员工自评、360°评估和上级评估',
    });
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

  const dimensionKeys: string[] = [];
  const fieldKeys: string[] = [];
  const expectedAudience = {
    SELF: 'EMPLOYEE',
    PEER: 'REVIEWER',
    MANAGER: 'LEADER',
  } as const;

  for (const subform of template.subforms) {
    const label = SUBFORM_LABEL[subform.type];
    const scoringDimensions = subform.dimensions.filter(
      (dimension) => dimension.type === 'SCORING',
    );

    if (scoringDimensions.length === 0) {
      issues.push({
        code: 'SCORING_DIMENSION_REQUIRED',
        path: `subforms.${subform.type}.dimensions`,
        message: `${label}至少需要一个计分维度`,
      });
    }

    let totalWeight = 0;
    scoringDimensions.forEach((dimension) => {
      const dimensionIndex = subform.dimensions.indexOf(dimension);
      const weight = percentageToHundredths(dimension.weight);
      if (weight === null || weight <= 0 || weight > 10_000) {
        issues.push({
          code: 'DIMENSION_WEIGHT_INVALID',
          path: `subforms.${subform.type}.dimensions[${dimensionIndex}].weight`,
          message: `${label}计分维度占比必须大于 0%、不超过 100% 且最多两位小数`,
        });
      } else {
        totalWeight += weight;
      }
      if (!FORM_SCORING_METHODS.includes(dimension.scoringMethod as never)) {
        issues.push({
          code: 'DIMENSION_SCORING_METHOD_INVALID',
          path: `subforms.${subform.type}.dimensions[${dimensionIndex}].scoringMethod`,
          message: '计分维度必须选择评级或 0～100 分',
        });
      }
    });
    if (totalWeight !== 10_000) {
      issues.push({
        code: 'DIMENSION_WEIGHT_TOTAL_INVALID',
        path: `subforms.${subform.type}.dimensions`,
        message: `${label}计分维度占比合计必须为 100%`,
      });
    }
    if (
      scoringDimensions.filter((dimension) => dimension.isCore).length !== 1
    ) {
      issues.push({
        code: 'CORE_DIMENSION_COUNT_INVALID',
        path: `subforms.${subform.type}.dimensions`,
        message: `${label}必须且只能有一个核心计分维度`,
      });
    }

    const audienceOrders: number[] = [];
    subform.dimensions.forEach((dimension, dimensionIndex) => {
      const dimensionPath = `subforms.${subform.type}.dimensions[${dimensionIndex}]`;
      dimensionKeys.push(dimension.key);
      audienceOrders.push(dimension.sortOrder);

      if (!dimension.key?.trim()) {
        issues.push({
          code: 'DIMENSION_KEY_REQUIRED',
          path: `${dimensionPath}.key`,
          message: '评估维度缺少稳定业务标识',
        });
      }
      if (dimension.audience !== expectedAudience[subform.type]) {
        issues.push({
          code: 'DIMENSION_AUDIENCE_INVALID',
          path: `${dimensionPath}.audience`,
          message: `${label}维度的填写对象不合法`,
        });
      }
      if (!Number.isInteger(dimension.sortOrder) || dimension.sortOrder < 0) {
        issues.push({
          code: 'DIMENSION_SORT_ORDER_INVALID',
          path: `${dimensionPath}.sortOrder`,
          message: '维度排序必须是非负整数',
        });
      }
      if (
        dimension.type === 'NON_SCORING' &&
        (dimension.scoringMethod != null ||
          dimension.weight != null ||
          dimension.isCore)
      ) {
        issues.push({
          code: 'NON_SCORING_DIMENSION_CONFIG_INVALID',
          path: dimensionPath,
          message: '非计分维度不能设置计分方式、占比或核心维度',
        });
      }

      dimension.fields.forEach((field, fieldIndex) => {
        const fieldPath = `${dimensionPath}.fields[${fieldIndex}]`;
        fieldKeys.push(field.key);
        if (!field.key?.trim()) {
          issues.push({
            code: 'FIELD_KEY_REQUIRED',
            path: `${fieldPath}.key`,
            message: '表单字段缺少稳定业务标识',
          });
        }
        if (!FORM_FIELD_TYPES.includes(field.type)) {
          issues.push({
            code: 'FIELD_TYPE_INVALID',
            path: `${fieldPath}.type`,
            message: '表单字段必须使用受控的非计分组件类型',
          });
          return;
        }
        if (!Number.isInteger(field.sortOrder) || field.sortOrder < 0) {
          issues.push({
            code: 'FIELD_SORT_ORDER_INVALID',
            path: `${fieldPath}.sortOrder`,
            message: '表单字段排序必须是非负整数',
          });
        }
        if (!isValidFieldConfig(field.type, field.config)) {
          issues.push({
            code: 'FIELD_CONFIG_INVALID',
            path: `${fieldPath}.config`,
            message: `${FIELD_TYPE_LABEL[field.type]}的组件配置不合法`,
          });
        }
        if (!FORM_FIELD_REQUIRED_RULES.includes(field.requiredRule)) {
          issues.push({
            code: 'FIELD_REQUIRED_RULE_INVALID',
            path: `${fieldPath}.requiredRule`,
            message: '表单字段必填规则不合法',
          });
        }

        const requiredLevels = field.requiredLevels ?? [];
        const conditionalAllowed =
          dimension.type === 'SCORING' &&
          (field.type === 'LONG_TEXT' || field.type === 'MARKDOWN');
        if (field.requiredRule === 'CONDITIONAL') {
          if (
            !conditionalAllowed ||
            requiredLevels.length === 0 ||
            hasDuplicate(requiredLevels) ||
            requiredLevels.some((level) => !FORM_RATING_LEVELS.includes(level))
          ) {
            issues.push({
              code: 'FIELD_CONDITIONAL_RULE_INVALID',
              path: `${fieldPath}.requiredLevels`,
              message:
                '只有计分维度中的多行文本或 Markdown 可按有效维度等级条件必填',
            });
          }
        } else if (requiredLevels.length > 0) {
          issues.push({
            code: 'FIELD_REQUIRED_LEVELS_UNUSED',
            path: `${fieldPath}.requiredLevels`,
            message: '非条件必填字段不能设置触发等级',
          });
        }
      });

      if (hasDuplicate(dimension.fields.map((field) => field.sortOrder))) {
        issues.push({
          code: 'FIELD_SORT_ORDER_DUPLICATE',
          path: `${dimensionPath}.fields.sortOrder`,
          message: '同一维度内的表单字段排序不能重复',
        });
      }
    });

    if (hasDuplicate(audienceOrders)) {
      issues.push({
        code: 'DIMENSION_SORT_ORDER_DUPLICATE',
        path: `subforms.${subform.type}.dimensions.sortOrder`,
        message: '同一子表单内的维度排序不能重复',
      });
    }
  }

  if (hasDuplicate(dimensionKeys.filter(Boolean))) {
    issues.push({
      code: 'DIMENSION_KEY_DUPLICATE',
      path: 'subforms.dimensions.key',
      message: '同一表单版本内的评估维度业务标识不能重复',
    });
  }
  if (hasDuplicate(fieldKeys.filter(Boolean))) {
    issues.push({
      code: 'FIELD_KEY_DUPLICATE',
      path: 'subforms.dimensions.fields.key',
      message: '同一表单版本内的表单字段业务标识不能重复',
    });
  }

  return issues;
}
