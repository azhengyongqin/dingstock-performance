import type {
  DefaultFormTemplateContract,
  FormAudience,
  FormFieldRequiredRule,
  FormFieldType,
  FormScoringMethod,
  FormTemplateDimensionContract,
  FormTemplateFieldContract,
  FormTemplateSubformContract,
} from './form-template.contract';

const field = (
  key: string,
  title: string,
  type: FormFieldType,
  requiredRule: FormFieldRequiredRule,
  sortOrder: number,
  extras: Partial<FormTemplateFieldContract> = {},
): FormTemplateFieldContract => ({
  key,
  title,
  type,
  requiredRule,
  requiredLevels: [],
  sortOrder,
  ...extras,
});

const scoringDimension = (
  key: string,
  name: string,
  audience: FormAudience,
  weight: number,
  isCore: boolean,
  sortOrder: number,
  scoringMethod: FormScoringMethod,
  description?: string,
): FormTemplateDimensionContract => ({
  key,
  name,
  description,
  type: 'SCORING',
  scoringMethod,
  audience,
  weight,
  isCore,
  sortOrder,
  fields: [
    field(`${key}:comment`, `${name}评价`, 'LONG_TEXT', 'CONDITIONAL', 0, {
      requiredLevels: ['S', 'C'],
    }),
  ],
});

const selfSubform = (): FormTemplateSubformContract => ({
  type: 'SELF',
  title: '员工自评',
  description: '员工完成自评等级、工作总结与后续规划。',
  sortOrder: 0,
  dimensions: [
    {
      key: 'self:performance',
      name: '绩效自评',
      type: 'SCORING',
      scoringMethod: 'RATING',
      audience: 'EMPLOYEE',
      weight: 100,
      isCore: true,
      sortOrder: 0,
      fields: [],
    },
    {
      key: 'self:summary-and-plan',
      name: '总结与规划',
      type: 'NON_SCORING',
      scoringMethod: null,
      audience: 'EMPLOYEE',
      weight: null,
      isCore: false,
      sortOrder: 1,
      fields: [
        field('self:summary', '自评总结', 'MARKDOWN', 'ALWAYS', 0, {
          placeholder: '请结合事实完成自评总结，一般为 200～300 字。',
        }),
        field('self:half-year-summary', '半年度总结', 'MARKDOWN', 'ALWAYS', 1, {
          placeholder:
            '## 工作产出结果\n### 工作产出结果一\n具体阐述...\n分析总结\n\n## 个人成长\n> 近半年个人新成长或习得的技能、提效工具',
        }),
        field('self:next-half-plan', '下个半年规划', 'MARKDOWN', 'ALWAYS', 2, {
          placeholder: '## 工作规划\n\n## 个人成长计划',
        }),
        field(
          'self:support-needed',
          '需要的支持和帮助',
          'LONG_TEXT',
          'OPTIONAL',
          3,
        ),
        field('self:attachments', '补充附件', 'ATTACHMENT', 'OPTIONAL', 4, {
          config: { maxFiles: 10, maxSizeMb: 100 },
        }),
        field('self:links', '补充链接', 'LINK', 'OPTIONAL', 5, {
          config: {
            maxLength: 2_000,
            allowedProtocols: ['http', 'https'],
          },
        }),
      ],
    },
  ],
});

const createTemplate = (
  prefix: 'D' | 'M',
  peerDimensions: FormTemplateDimensionContract[],
  managerDimensions: FormTemplateDimensionContract[],
): DefaultFormTemplateContract => ({
  systemKey: `DEFAULT_${prefix}`,
  version: 1,
  status: 'PUBLISHED',
  name: `${prefix === 'D' ? '普通岗' : '管理岗'}默认评估表单`,
  description: `系统内置 ${prefix} 职级前缀评估表单。`,
  jobLevelPrefix: prefix,
  subforms: [
    selfSubform(),
    {
      type: 'PEER',
      title: '360°评估',
      description: '仅评价同级员工在日常协作中可观察到的行为。',
      sortOrder: 1,
      dimensions: peerDimensions,
    },
    {
      type: 'MANAGER',
      title: '上级评估',
      sortOrder: 2,
      dimensions: managerDimensions,
    },
  ],
});

/** 系统内置版本使用稳定 systemKey，初始化程序可据此安全地重复执行。 */
export const DEFAULT_FORM_TEMPLATES: readonly DefaultFormTemplateContract[] = [
  createTemplate(
    'D',
    [
      scoringDimension(
        'd:peer:contribution',
        '工作贡献与责任担当',
        'REVIEWER',
        35,
        true,
        0,
        'RATING',
        '评价日常工作贡献、承诺兑现和问题闭环，不要求掌握完整业务指标。',
      ),
      scoringDimension(
        'd:peer:collaboration',
        '协作沟通与价值观',
        'REVIEWER',
        45,
        false,
        1,
        'RATING',
      ),
      scoringDimension(
        'd:peer:growth',
        '学习成长与潜力',
        'REVIEWER',
        20,
        false,
        2,
        'RATING',
      ),
    ],
    [
      scoringDimension(
        'd:manager:result',
        '核心业绩',
        'LEADER',
        70,
        true,
        0,
        'SCORE',
      ),
      scoringDimension(
        'd:manager:values',
        '价值观',
        'LEADER',
        20,
        false,
        1,
        'SCORE',
      ),
      scoringDimension(
        'd:manager:potential',
        '职业素养与潜力',
        'LEADER',
        10,
        false,
        2,
        'SCORE',
      ),
    ],
  ),
  createTemplate(
    'M',
    [
      scoringDimension(
        'm:peer:result',
        '结果推动与责任担当',
        'REVIEWER',
        40,
        true,
        0,
        'RATING',
        '仅评价跨团队事项推动、承诺兑现和问题闭环。',
      ),
      scoringDimension(
        'm:peer:influence',
        '协作沟通与组织影响',
        'REVIEWER',
        35,
        false,
        1,
        'RATING',
      ),
      scoringDimension(
        'm:peer:leadership',
        '领导力与价值观',
        'REVIEWER',
        25,
        false,
        2,
        'RATING',
        '仅评价可观察到的担当、判断和以身作则，不评价团队内部人才培养细节。',
      ),
    ],
    [
      scoringDimension(
        'm:manager:result',
        '核心业绩',
        'LEADER',
        50,
        true,
        0,
        'SCORE',
      ),
      scoringDimension(
        'm:manager:management',
        '管理绩效',
        'LEADER',
        50,
        false,
        1,
        'SCORE',
      ),
    ],
  ),
];
