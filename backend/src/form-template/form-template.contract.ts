/**
 * 绩效表单模板纯领域契约。
 * 字符串值与持久化层保持一致，但本模块不依赖 Prisma/NestJS，便于发布校验与种子数据复用。
 */
export const FORM_TEMPLATE_VERSION_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
] as const;
export type FormTemplateVersionStatus =
  (typeof FORM_TEMPLATE_VERSION_STATUSES)[number];

export const FORM_TEMPLATE_JOB_LEVEL_PREFIXES = ['D', 'M'] as const;
export type FormTemplateJobLevelPrefix =
  (typeof FORM_TEMPLATE_JOB_LEVEL_PREFIXES)[number];

/** 晋升已退出绩效模板主链，旧内容由持久化适配层只读保留。 */
export const FORM_SUBFORM_TYPES = ['SELF', 'PEER', 'MANAGER'] as const;
export type FormSubformType = (typeof FORM_SUBFORM_TYPES)[number];

export const FORM_DIMENSION_TYPES = ['SCORING', 'NON_SCORING'] as const;
export type FormDimensionType = (typeof FORM_DIMENSION_TYPES)[number];

export const FORM_SCORING_METHODS = ['RATING', 'SCORE'] as const;
export type FormScoringMethod = (typeof FORM_SCORING_METHODS)[number];

export const FORM_FIELD_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'MARKDOWN',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'ATTACHMENT',
  'LINK',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_FIELD_REQUIRED_RULES = [
  'OPTIONAL',
  'ALWAYS',
  'CONDITIONAL',
] as const;
export type FormFieldRequiredRule = (typeof FORM_FIELD_REQUIRED_RULES)[number];

export const FORM_RATING_LEVELS = ['S', 'A', 'B', 'C'] as const;
export type FormRatingLevel = (typeof FORM_RATING_LEVELS)[number];

export const FORM_AUDIENCES = ['EMPLOYEE', 'REVIEWER', 'LEADER'] as const;
export type FormAudience = (typeof FORM_AUDIENCES)[number];

export type FormFieldOption = {
  value: string;
  label: string;
};

export type FormFieldConfig = {
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
  options?: readonly FormFieldOption[];
  minSelections?: number;
  maxSelections?: number;
  maxFiles?: number;
  maxSizeMb?: number;
  allowedExtensions?: readonly string[];
  allowedProtocols?: readonly string[];
};

/** Expand 期间仅供尚未迁移的周期快照 DTO 使用，禁止在新版模板 API 中暴露。 */
export const LEGACY_FORM_DIMENSION_TYPES = [
  'REGULAR',
  'PROMOTION',
  'TEXT',
] as const;
export type LegacyFormDimensionType =
  (typeof LEGACY_FORM_DIMENSION_TYPES)[number];
export const LEGACY_FORM_ITEM_TYPES = [
  'RATING',
  'SCORE',
  ...FORM_FIELD_TYPES,
] as const;
export type LegacyFormItemType = (typeof LEGACY_FORM_ITEM_TYPES)[number];
export type LegacyFormItemConfig = FormFieldConfig & {
  employeeVisible?: boolean;
};
export const LEGACY_FORM_SUBFORM_TYPES = [
  ...FORM_SUBFORM_TYPES,
  'PROMOTION',
] as const;
export type LegacyFormSubformType = (typeof LEGACY_FORM_SUBFORM_TYPES)[number];

export type FormTemplateFieldContract = {
  /** 同一稳定模板的所有版本沿用此业务标识，名称、类型、排序与所属维度变化均不改 key。 */
  key: string;
  title: string;
  description?: string | null;
  placeholder?: string | null;
  type: FormFieldType;
  requiredRule: FormFieldRequiredRule;
  requiredLevels: readonly FormRatingLevel[];
  sortOrder: number;
  config?: FormFieldConfig | null;
};

export type FormTemplateDimensionContract = {
  /** 同一稳定模板的所有版本沿用此业务标识。 */
  key: string;
  name: string;
  description?: string | null;
  type: FormDimensionType;
  /** 明确填写对象，避免仅靠子表单名称推断权限边界。 */
  audience: FormAudience;
  scoringMethod?: FormScoringMethod | null;
  /** 占比按百分比表达；字符串形态便于无损承接数据库 Decimal。 */
  weight?: number | string | null;
  isCore: boolean;
  sortOrder: number;
  fields: readonly FormTemplateFieldContract[];
};

export type FormTemplateSubformContract = {
  type: FormSubformType;
  title: string;
  description?: string | null;
  sortOrder: number;
  dimensions: FormTemplateDimensionContract[];
};

export type FormTemplateVersionContract = {
  name: string;
  description?: string | null;
  jobLevelPrefix: FormTemplateJobLevelPrefix;
  subforms: FormTemplateSubformContract[];
};

export type DefaultFormTemplateContract = FormTemplateVersionContract & {
  systemKey: string;
  version: 1;
  status: 'PUBLISHED';
};
