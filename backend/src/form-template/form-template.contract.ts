/**
 * 表单模板纯领域契约。
 * 字符串值与 Prisma 封闭枚举保持一致，但本模块不依赖 Prisma/NestJS，便于发布校验与种子数据复用。
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

export const FORM_SUBFORM_TYPES = [
  'SELF',
  'PEER',
  'MANAGER',
  'PROMOTION',
] as const;
export type FormSubformType = (typeof FORM_SUBFORM_TYPES)[number];

export const FORM_DIMENSION_TYPES = ['REGULAR', 'PROMOTION', 'TEXT'] as const;
export type FormDimensionType = (typeof FORM_DIMENSION_TYPES)[number];

export const FORM_ITEM_TYPES = [
  'RATING',
  'SCORE',
  'SHORT_TEXT',
  'LONG_TEXT',
  'MARKDOWN',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'ATTACHMENT',
  'LINK',
] as const;
export type FormItemType = (typeof FORM_ITEM_TYPES)[number];

export const FORM_AUDIENCES = ['EMPLOYEE', 'REVIEWER', 'LEADER'] as const;
export type FormAudience = (typeof FORM_AUDIENCES)[number];

export type FormItemOption = {
  value: string;
  label: string;
};

export type FormItemConfig = {
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
  options?: readonly FormItemOption[];
  minSelections?: number;
  maxSelections?: number;
  maxFiles?: number;
  maxSizeMb?: number;
  allowedExtensions?: readonly string[];
  allowedProtocols?: readonly string[];
};

export type FormTemplateItemContract = {
  title: string;
  description?: string | null;
  placeholder?: string | null;
  type: FormItemType;
  required: boolean;
  sortOrder: number;
  config?: FormItemConfig | null;
};

export type FormTemplateDimensionContract = {
  name: string;
  description?: string | null;
  kind: FormDimensionType;
  /** 明确填写对象，避免仅靠子表单名称推断权限边界。 */
  audience: FormAudience;
  /** 权重按百分比表达；字符串形态便于无损承接数据库 Decimal。 */
  weight?: number | string | null;
  isCore: boolean;
  sortOrder: number;
  items: readonly FormTemplateItemContract[];
};

export type FormTemplateSubformContract = {
  type: FormSubformType;
  title: string;
  description?: string | null;
  sortOrder: number;
  dimensions: readonly FormTemplateDimensionContract[];
};

export type FormTemplateVersionContract = {
  name: string;
  description?: string | null;
  jobLevelPrefix: FormTemplateJobLevelPrefix;
  subforms: readonly FormTemplateSubformContract[];
};

export type DefaultFormTemplateContract = FormTemplateVersionContract & {
  systemKey: string;
  version: 1;
  status: 'PUBLISHED';
};
