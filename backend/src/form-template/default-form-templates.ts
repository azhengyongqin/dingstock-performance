import type {
  DefaultFormTemplateContract,
  FormAudience,
  FormItemType,
  FormTemplateDimensionContract,
  FormTemplateItemContract,
  FormTemplateSubformContract,
} from './form-template.contract';

const item = (
  title: string,
  type: FormItemType,
  required: boolean,
  sortOrder: number,
  extras: Partial<FormTemplateItemContract> = {},
): FormTemplateItemContract => ({
  title,
  type,
  required,
  sortOrder,
  ...extras,
});

const regularDimension = (
  name: string,
  audience: FormAudience,
  weight: number,
  isCore: boolean,
  sortOrder: number,
  scoringType: 'RATING' | 'SCORE',
  description?: string,
): FormTemplateDimensionContract => ({
  name,
  description,
  kind: 'REGULAR',
  audience,
  weight,
  isCore,
  sortOrder,
  items: [
    item(
      `${name}${scoringType === 'RATING' ? '评级' : '分数'}`,
      scoringType,
      true,
      0,
    ),
    item(`${name}评价`, 'LONG_TEXT', false, 1),
  ],
});

const SELF_SUBFORM: FormTemplateSubformContract = {
  type: 'SELF',
  title: '员工自评',
  description: '员工完成自评等级、工作总结与后续规划。',
  sortOrder: 0,
  dimensions: [
    {
      name: '绩效自评',
      kind: 'REGULAR',
      audience: 'EMPLOYEE',
      weight: null,
      isCore: false,
      sortOrder: 0,
      items: [item('自评等级', 'RATING', true, 0)],
    },
    {
      name: '总结与规划',
      kind: 'TEXT',
      audience: 'EMPLOYEE',
      weight: null,
      isCore: false,
      sortOrder: 1,
      items: [
        item('自评总结', 'MARKDOWN', true, 0, {
          placeholder: '请结合事实完成自评总结，一般为 200～300 字。',
        }),
        item('半年度总结', 'MARKDOWN', true, 1, {
          placeholder:
            '## 工作产出结果\n### 工作产出结果一\n具体阐述...\n分析总结\n\n## 个人成长\n> 近半年个人新成长或习得的技能、提效工具',
        }),
        item('下个半年规划', 'MARKDOWN', true, 2, {
          placeholder: '## 工作规划\n\n## 个人成长计划',
        }),
        item('需要的支持和帮助', 'LONG_TEXT', false, 3),
        item('补充附件', 'ATTACHMENT', false, 4, {
          config: { maxFiles: 10, maxSizeMb: 100 },
        }),
        item('补充链接', 'LINK', false, 5, {
          config: {
            maxLength: 2_000,
            allowedProtocols: ['http', 'https'],
          },
        }),
      ],
    },
  ],
};

const promotionSubform = (): FormTemplateSubformContract => ({
  type: 'PROMOTION',
  title: '晋升评估',
  description: '晋升内容仅由员工和考核 Leader 填写，不向 360°评审员开放。',
  sortOrder: 3,
  dimensions: [
    {
      name: '员工晋升材料',
      kind: 'PROMOTION',
      audience: 'EMPLOYEE',
      weight: null,
      isCore: false,
      sortOrder: 0,
      items: [
        item('突出工作产出结果', 'MARKDOWN', true, 0, {
          placeholder: '## 产出结果 1\n\n## 产出结果 2',
        }),
        item('文化价值观表现', 'MARKDOWN', true, 1),
        item('晋升 PPT 附件', 'ATTACHMENT', false, 2, {
          config: { maxFiles: 1, maxSizeMb: 100 },
        }),
        item('晋升 PPT 链接', 'LINK', false, 3, {
          config: {
            maxLength: 2_000,
            allowedProtocols: ['http', 'https'],
          },
        }),
      ],
    },
    {
      name: 'Leader 晋升评估',
      kind: 'PROMOTION',
      audience: 'LEADER',
      weight: null,
      isCore: false,
      sortOrder: 0,
      items: [
        item('晋升结论', 'SINGLE_SELECT', true, 0, {
          config: {
            options: [
              { value: 'PROMOTE', label: '建议晋升' },
              { value: 'DEFER', label: '暂缓晋升' },
              { value: 'DO_NOT_PROMOTE', label: '不建议晋升' },
              { value: 'NOT_APPLICABLE', label: '不适用' },
            ],
          },
        }),
        item('晋升评价', 'LONG_TEXT', false, 1),
      ],
    },
  ],
});

const createTemplate = (
  prefix: 'D' | 'M',
  peerDimensions: readonly FormTemplateDimensionContract[],
  managerDimensions: readonly FormTemplateDimensionContract[],
): DefaultFormTemplateContract => ({
  systemKey: `DEFAULT_${prefix}`,
  version: 1,
  status: 'PUBLISHED',
  name: `${prefix === 'D' ? '普通岗' : '管理岗'}默认评估表单`,
  description: `系统内置 ${prefix} 职级前缀评估表单。`,
  jobLevelPrefix: prefix,
  subforms: [
    SELF_SUBFORM,
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
    promotionSubform(),
  ],
});

/** 系统内置版本使用稳定 systemKey，初始化程序可据此安全地重复执行。 */
export const DEFAULT_FORM_TEMPLATES: readonly DefaultFormTemplateContract[] = [
  createTemplate(
    'D',
    [
      regularDimension(
        '工作贡献与责任担当',
        'REVIEWER',
        35,
        true,
        0,
        'RATING',
        '评价日常工作贡献、承诺兑现和问题闭环，不要求掌握完整业务指标。',
      ),
      regularDimension('协作沟通与价值观', 'REVIEWER', 45, false, 1, 'RATING'),
      regularDimension('学习成长与潜力', 'REVIEWER', 20, false, 2, 'RATING'),
    ],
    [
      regularDimension('核心业绩', 'LEADER', 70, true, 0, 'SCORE'),
      regularDimension('价值观', 'LEADER', 20, false, 1, 'SCORE'),
      regularDimension('职业素养与潜力', 'LEADER', 10, false, 2, 'SCORE'),
    ],
  ),
  createTemplate(
    'M',
    [
      regularDimension(
        '结果推动与责任担当',
        'REVIEWER',
        40,
        true,
        0,
        'RATING',
        '仅评价跨团队事项推动、承诺兑现和问题闭环。',
      ),
      regularDimension(
        '协作沟通与组织影响',
        'REVIEWER',
        35,
        false,
        1,
        'RATING',
      ),
      regularDimension(
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
      regularDimension('核心业绩', 'LEADER', 50, true, 0, 'SCORE'),
      regularDimension('管理绩效', 'LEADER', 50, false, 1, 'SCORE'),
    ],
  ),
];
