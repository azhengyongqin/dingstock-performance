import type {
  FormTemplateDimensionContract,
  FormTemplateSubformContract,
  FormTemplateVersionContract,
} from './form-template.contract';
import { validateFormTemplatePublication } from './publication-validator';

const scoringDimension = (
  key: string,
  audience: 'EMPLOYEE' | 'REVIEWER' | 'LEADER',
  scoringMethod: 'RATING' | 'SCORE',
  weight: number | string,
  sortOrder: number,
  isCore = false,
): FormTemplateDimensionContract => ({
  key,
  name: key,
  type: 'SCORING',
  scoringMethod,
  audience,
  weight,
  isCore,
  sortOrder,
  fields: [],
});

const validSubforms = (): FormTemplateSubformContract[] => [
  {
    type: 'SELF',
    title: '员工自评',
    sortOrder: 0,
    dimensions: [
      scoringDimension('self-performance', 'EMPLOYEE', 'RATING', 100, 0, true),
    ],
  },
  {
    type: 'PEER',
    title: '360°评估',
    sortOrder: 1,
    dimensions: [
      scoringDimension('peer-result', 'REVIEWER', 'RATING', 60, 0, true),
      scoringDimension('peer-growth', 'REVIEWER', 'SCORE', 40, 1),
    ],
  },
  {
    type: 'MANAGER',
    title: '上级评估',
    sortOrder: 2,
    dimensions: [
      scoringDimension('manager-result', 'LEADER', 'SCORE', 100, 0, true),
    ],
  },
];

const validTemplate = (): FormTemplateVersionContract => ({
  name: '普通岗评估表单',
  jobLevelPrefix: 'D',
  subforms: validSubforms(),
});

describe('validateFormTemplatePublication', () => {
  it('允许三个绩效子表单使用维度直接计分并在同一子表单混用评级和分数', () => {
    expect(validateFormTemplatePublication(validTemplate())).toEqual([]);
  });

  it('每个子表单都要求计分占比严格合计 100% 且恰好一个核心维度', () => {
    const template = validTemplate();
    const self = template.subforms.find((subform) => subform.type === 'SELF')!;
    self.dimensions = [
      scoringDimension('self-one', 'EMPLOYEE', 'RATING', 50, 0),
      scoringDimension('self-two', 'EMPLOYEE', 'SCORE', 40, 1),
    ];

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) => issue.path === 'subforms.SELF.dimensions')
        .map((issue) => issue.code),
    ).toEqual([
      'DIMENSION_WEIGHT_TOTAL_INVALID',
      'CORE_DIMENSION_COUNT_INVALID',
    ]);
  });

  it('拒绝为零、超过 100 或超过两位小数的计分占比', () => {
    const template = validTemplate();
    const peer = template.subforms.find((subform) => subform.type === 'PEER')!;
    peer.dimensions = [
      scoringDimension('zero', 'REVIEWER', 'RATING', 0, 0, true),
      scoringDimension('precision', 'REVIEWER', 'SCORE', '100.001', 1),
    ];

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) => issue.code === 'DIMENSION_WEIGHT_INVALID')
        .map((issue) => issue.path),
    ).toEqual([
      'subforms.PEER.dimensions[0].weight',
      'subforms.PEER.dimensions[1].weight',
    ]);
  });

  it('非计分维度可以没有字段但不能保存计分配置', () => {
    const template = validTemplate();
    const manager = template.subforms.find(
      (subform) => subform.type === 'MANAGER',
    )!;
    manager.dimensions = [
      ...manager.dimensions,
      {
        key: 'manager-guide',
        name: '填写说明',
        type: 'NON_SCORING',
        audience: 'LEADER',
        scoringMethod: 'RATING',
        weight: 10,
        isCore: true,
        sortOrder: 1,
        fields: [],
      },
    ];

    expect(
      validateFormTemplatePublication(template).filter(
        (issue) => issue.code === 'NON_SCORING_DIMENSION_CONFIG_INVALID',
      ),
    ).toHaveLength(1);
  });

  it('字段目录不包含评级和分数', () => {
    const template = validTemplate();
    const self = template.subforms.find((subform) => subform.type === 'SELF')!;
    self.dimensions[0].fields = [
      {
        key: 'bad-score-field',
        title: '错误分数字段',
        type: 'SCORE',
        requiredRule: 'OPTIONAL',
        requiredLevels: [],
        sortOrder: 0,
      },
    ] as never;

    expect(
      validateFormTemplatePublication(template).filter(
        (issue) => issue.code === 'FIELD_TYPE_INVALID',
      ),
    ).toEqual([
      expect.objectContaining({
        path: 'subforms.SELF.dimensions[0].fields[0].type',
      }),
    ]);
  });

  it('仅允许计分维度中的多行文本或 Markdown 按等级条件必填', () => {
    const template = validTemplate();
    const self = template.subforms.find((subform) => subform.type === 'SELF')!;
    self.dimensions[0].fields = [
      {
        key: 'self-comment',
        title: '特殊等级说明',
        type: 'LONG_TEXT',
        requiredRule: 'CONDITIONAL',
        requiredLevels: ['S', 'C'],
        sortOrder: 0,
      },
    ];
    const peer = template.subforms.find((subform) => subform.type === 'PEER')!;
    peer.dimensions.push({
      key: 'peer-guide',
      name: '补充说明',
      type: 'NON_SCORING',
      audience: 'REVIEWER',
      scoringMethod: null,
      weight: null,
      isCore: false,
      sortOrder: 2,
      fields: [
        {
          key: 'peer-guide-field',
          title: '说明',
          type: 'MARKDOWN',
          requiredRule: 'CONDITIONAL',
          requiredLevels: ['C'],
          sortOrder: 0,
        },
      ],
    });

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) => issue.code === 'FIELD_CONDITIONAL_RULE_INVALID')
        .map((issue) => issue.path),
    ).toEqual(['subforms.PEER.dimensions[2].fields[0].requiredLevels']);
  });

  it('发布版本要求维度和字段业务 key 非空且在版本内唯一', () => {
    const template = validTemplate();
    const self = template.subforms.find((subform) => subform.type === 'SELF')!;
    self.dimensions[0].fields = [
      {
        key: 'shared-field',
        title: '字段一',
        type: 'LONG_TEXT',
        requiredRule: 'OPTIONAL',
        requiredLevels: [],
        sortOrder: 0,
      },
      {
        key: 'shared-field',
        title: '字段二',
        type: 'MARKDOWN',
        requiredRule: 'ALWAYS',
        requiredLevels: [],
        sortOrder: 1,
      },
    ];
    template.subforms[1].dimensions[0].key = 'self-performance';

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) => issue.code.endsWith('KEY_DUPLICATE'))
        .map((issue) => issue.code),
    ).toEqual(['DIMENSION_KEY_DUPLICATE', 'FIELD_KEY_DUPLICATE']);
  });
});
