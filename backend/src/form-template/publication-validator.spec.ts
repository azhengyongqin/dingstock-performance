import type {
  FormTemplateDimensionContract,
  FormTemplateSubformContract,
  FormTemplateVersionContract,
} from './form-template.contract';
import { validateFormTemplatePublication } from './publication-validator';

const ratingDimension = (
  name: string,
  weight: number,
  sortOrder: number,
  isCore = false,
): FormTemplateDimensionContract => ({
  name,
  kind: 'REGULAR',
  audience: 'REVIEWER',
  weight,
  isCore,
  sortOrder,
  items: [
    {
      title: `${name}评级`,
      type: 'RATING',
      required: true,
      sortOrder: 0,
    },
  ],
});

const scoreDimension = (
  name: string,
  weight: number,
  sortOrder: number,
  isCore = false,
): FormTemplateDimensionContract => ({
  name,
  kind: 'REGULAR',
  audience: 'LEADER',
  weight,
  isCore,
  sortOrder,
  items: [
    {
      title: `${name}分数`,
      type: 'SCORE',
      required: true,
      sortOrder: 0,
    },
  ],
});

const validSubforms = (): FormTemplateSubformContract[] => [
  {
    type: 'SELF',
    title: '员工自评',
    sortOrder: 0,
    dimensions: [
      {
        ...ratingDimension('绩效自评', 0, 0),
        audience: 'EMPLOYEE',
      },
    ],
  },
  {
    type: 'PEER',
    title: '360°评估',
    sortOrder: 1,
    dimensions: [
      ratingDimension('责任担当', 40, 0, true),
      ratingDimension('协作沟通', 60, 1),
    ],
  },
  {
    type: 'MANAGER',
    title: '上级评估',
    sortOrder: 2,
    dimensions: [
      scoreDimension('核心业绩', 70, 0, true),
      scoreDimension('价值观', 30, 1),
    ],
  },
  {
    type: 'PROMOTION',
    title: '晋升评估',
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
          {
            title: '突出工作产出结果',
            type: 'MARKDOWN',
            required: true,
            sortOrder: 0,
          },
        ],
      },
      {
        name: 'Leader 晋升评估',
        kind: 'PROMOTION',
        audience: 'LEADER',
        weight: null,
        isCore: false,
        sortOrder: 1,
        items: [
          {
            title: '晋升结论',
            type: 'SINGLE_SELECT',
            required: true,
            sortOrder: 0,
            config: {
              options: [
                { value: 'PROMOTE', label: '建议晋升' },
                { value: 'DEFER', label: '暂缓晋升' },
              ],
            },
          },
        ],
      },
    ],
  },
];

const validTemplate = (): FormTemplateVersionContract => ({
  name: '普通岗评估表单',
  jobLevelPrefix: 'D',
  subforms: validSubforms(),
});

describe('validateFormTemplatePublication', () => {
  it('完整且自洽的四子表单可以发布', () => {
    expect(validateFormTemplatePublication(validTemplate())).toEqual([]);
  });

  it('一次返回缺失和重复的全部子表单问题', () => {
    const template = validTemplate();
    template.subforms = [template.subforms[0], template.subforms[0]];

    const issues = validateFormTemplatePublication(template);

    const hierarchyIssues = issues.filter((issue) =>
      ['SUBFORM_DUPLICATE', 'SUBFORM_REQUIRED'].includes(issue.code),
    );
    expect(hierarchyIssues.map((issue) => issue.code)).toEqual([
      'SUBFORM_DUPLICATE',
      'SUBFORM_REQUIRED',
      'SUBFORM_REQUIRED',
      'SUBFORM_REQUIRED',
    ]);
    expect(hierarchyIssues.map((issue) => issue.path)).toEqual([
      'subforms.SELF',
      'subforms.PEER',
      'subforms.MANAGER',
      'subforms.PROMOTION',
    ]);
  });

  it('加权子表单必须满足权重合计 100% 且只有一个核心维度', () => {
    const template = validTemplate();
    const peer = template.subforms.find((subform) => subform.type === 'PEER')!;
    peer.dimensions = [
      ratingDimension('责任担当', 40, 0),
      ratingDimension('协作沟通', 50, 1),
    ];

    expect(
      validateFormTemplatePublication(template).map((issue) => ({
        code: issue.code,
        path: issue.path,
      })),
    ).toEqual([
      {
        code: 'DIMENSION_WEIGHT_TOTAL_INVALID',
        path: 'subforms.PEER.dimensions',
      },
      {
        code: 'CORE_DIMENSION_COUNT_INVALID',
        path: 'subforms.PEER.dimensions',
      },
    ]);
  });

  it('加权子表单逐个拒绝缺失权重，不能用其他维度的 100% 掩盖', () => {
    const template = validTemplate();
    const peer = template.subforms.find((subform) => subform.type === 'PEER')!;
    peer.dimensions = [
      ratingDimension('责任担当', 100, 0, true),
      ratingDimension('协作沟通', 0, 1),
    ];
    peer.dimensions[1].weight = null;

    expect(
      validateFormTemplatePublication(template).filter(
        (issue) => issue.code === 'DIMENSION_WEIGHT_INVALID',
      ),
    ).toEqual([
      {
        code: 'DIMENSION_WEIGHT_INVALID',
        path: 'subforms.PEER.dimensions[1].weight',
        message: 'PEER 的每个常规维度都必须设置合法权重',
      },
    ]);
  });

  it('每个常规维度恰有一个计分项且同一加权子表单计分类型统一', () => {
    const template = validTemplate();
    const peer = template.subforms.find((subform) => subform.type === 'PEER')!;
    peer.dimensions = [
      ratingDimension('责任担当', 40, 0, true),
      { ...scoreDimension('协作沟通', 30, 1), audience: 'REVIEWER' },
      {
        name: '学习成长',
        kind: 'REGULAR',
        audience: 'REVIEWER',
        weight: 30,
        isCore: false,
        sortOrder: 2,
        items: [
          {
            title: '成长评价',
            type: 'LONG_TEXT',
            required: false,
            sortOrder: 0,
          },
        ],
      },
    ];

    expect(
      validateFormTemplatePublication(template).map((issue) => ({
        code: issue.code,
        path: issue.path,
      })),
    ).toEqual([
      {
        code: 'SCORING_ITEM_COUNT_INVALID',
        path: 'subforms.PEER.dimensions[2].items',
      },
      {
        code: 'SCORING_TYPE_MIXED',
        path: 'subforms.PEER.dimensions',
      },
    ]);
  });

  it('SELF 必须且只能包含一个必填 RATING 自评等级项', () => {
    const template = validTemplate();
    const self = template.subforms.find((subform) => subform.type === 'SELF')!;
    self.dimensions[0].items[0].required = false;

    expect(
      validateFormTemplatePublication(template).filter(
        (issue) => issue.code === 'SELF_RATING_INVALID',
      ),
    ).toEqual([
      {
        code: 'SELF_RATING_INVALID',
        path: 'subforms.SELF',
        message: 'SELF 必须且只能包含一个必填 RATING 自评等级项',
      },
    ]);
  });

  it('PROMOTION 只能包含员工与 Leader 区段且两侧都必须有内容', () => {
    const template = validTemplate();
    const promotion = template.subforms.find(
      (subform) => subform.type === 'PROMOTION',
    )!;
    promotion.dimensions[0].audience = 'REVIEWER';
    promotion.dimensions[1].items = [];

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) => issue.code.startsWith('PROMOTION_'))
        .map((issue) => ({ code: issue.code, path: issue.path })),
    ).toEqual([
      {
        code: 'PROMOTION_ROLE_INVALID',
        path: 'subforms.PROMOTION.dimensions[0].audience',
      },
      {
        code: 'PROMOTION_ROLE_CONTENT_MISSING',
        path: 'subforms.PROMOTION.EMPLOYEE',
      },
      {
        code: 'PROMOTION_ROLE_CONTENT_MISSING',
        path: 'subforms.PROMOTION.LEADER',
      },
    ]);
  });

  it('TEXT 与 PROMOTION 维度不能包含评级或评分项', () => {
    const template = validTemplate();
    const self = template.subforms.find((subform) => subform.type === 'SELF')!;
    self.dimensions = [
      ...self.dimensions,
      {
        name: '文字反馈',
        kind: 'TEXT',
        audience: 'EMPLOYEE',
        weight: null,
        isCore: false,
        sortOrder: 1,
        items: [
          {
            title: '错误分数项',
            type: 'SCORE',
            required: true,
            sortOrder: 0,
          },
        ],
      },
    ];
    const promotion = template.subforms.find(
      (subform) => subform.type === 'PROMOTION',
    )!;
    promotion.dimensions[0].items = [
      ...promotion.dimensions[0].items,
      {
        title: '错误评级项',
        type: 'RATING',
        required: true,
        sortOrder: 1,
      },
    ];

    expect(
      validateFormTemplatePublication(template)
        .filter(
          (issue) => issue.code === 'NON_SCORING_DIMENSION_HAS_SCORING_ITEM',
        )
        .map((issue) => issue.path),
    ).toEqual([
      'subforms.SELF.dimensions[1].items',
      'subforms.PROMOTION.dimensions[0].items',
    ]);
  });

  it('维度和评估项排序必须非负且在同一父级内唯一', () => {
    const template = validTemplate();
    const peer = template.subforms.find((subform) => subform.type === 'PEER')!;
    peer.dimensions[0].sortOrder = -1;
    peer.dimensions[1].sortOrder = -1;
    peer.dimensions[0].items = [
      { ...peer.dimensions[0].items[0], sortOrder: -2 },
      {
        title: '补充评价',
        type: 'LONG_TEXT',
        required: false,
        sortOrder: -2,
      },
    ];

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) => issue.code.includes('SORT_ORDER'))
        .map((issue) => issue.code),
    ).toEqual([
      'DIMENSION_SORT_ORDER_INVALID',
      'DIMENSION_SORT_ORDER_INVALID',
      'DIMENSION_SORT_ORDER_DUPLICATE',
      'ITEM_SORT_ORDER_INVALID',
      'ITEM_SORT_ORDER_INVALID',
      'ITEM_SORT_ORDER_DUPLICATE',
    ]);
  });

  it('四个子表单的排序也必须非负且在版本内唯一', () => {
    const template = validTemplate();
    template.subforms[0].sortOrder = -1;
    template.subforms[1].sortOrder = -1;

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) => issue.code.startsWith('SUBFORM_SORT_ORDER'))
        .map((issue) => issue.code),
    ).toEqual([
      'SUBFORM_SORT_ORDER_INVALID',
      'SUBFORM_SORT_ORDER_INVALID',
      'SUBFORM_SORT_ORDER_DUPLICATE',
    ]);
  });

  it('各子表单严格限制维度填写对象且 PROMOTION 只能使用晋升维度', () => {
    const template = validTemplate();
    template.subforms.find(
      (subform) => subform.type === 'SELF',
    )!.dimensions[0].audience = 'REVIEWER';
    template.subforms.find(
      (subform) => subform.type === 'PEER',
    )!.dimensions[0].audience = 'EMPLOYEE';
    const promotion = template.subforms.find(
      (subform) => subform.type === 'PROMOTION',
    )!;
    promotion.dimensions[0].kind = 'TEXT';

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) =>
          [
            'DIMENSION_AUDIENCE_INVALID',
            'PROMOTION_DIMENSION_KIND_INVALID',
          ].includes(issue.code),
        )
        .map((issue) => issue.code),
    ).toEqual([
      'DIMENSION_AUDIENCE_INVALID',
      'DIMENSION_AUDIENCE_INVALID',
      'PROMOTION_DIMENSION_KIND_INVALID',
    ]);
  });

  it('受控组件拒绝未知类型和不符合类型契约的配置', () => {
    const template = validTemplate();
    const self = template.subforms.find((subform) => subform.type === 'SELF')!;
    self.dimensions = [
      ...self.dimensions,
      {
        name: '补充信息',
        kind: 'TEXT',
        audience: 'EMPLOYEE',
        weight: null,
        isCore: false,
        sortOrder: 1,
        items: [
          {
            title: '字数范围错误',
            type: 'SHORT_TEXT',
            required: false,
            sortOrder: 0,
            config: { minLength: 20, maxLength: 10 },
          },
          {
            title: '选项重复',
            type: 'SINGLE_SELECT',
            required: false,
            sortOrder: 1,
            config: {
              options: [
                { value: 'SAME', label: '选项一' },
                { value: 'SAME', label: '选项二' },
              ],
            },
          },
          {
            title: '附件数量错误',
            type: 'ATTACHMENT',
            required: false,
            sortOrder: 2,
            config: { maxFiles: 0 },
          },
          {
            title: '链接协议错误',
            type: 'LINK',
            required: false,
            sortOrder: 3,
            config: { allowedProtocols: ['ftp'] },
          },
          {
            title: '评级不接受自定义配置',
            type: 'RATING',
            required: false,
            sortOrder: 4,
            config: { maxLength: 10 },
          },
          {
            title: '未知组件',
            type: 'HTML' as never,
            required: false,
            sortOrder: 5,
          },
        ],
      },
    ];

    expect(
      validateFormTemplatePublication(template)
        .filter((issue) =>
          ['ITEM_CONFIG_INVALID', 'ITEM_TYPE_INVALID'].includes(issue.code),
        )
        .map((issue) => issue.path),
    ).toEqual([
      'subforms.SELF.dimensions[1].items[0].config',
      'subforms.SELF.dimensions[1].items[1].config',
      'subforms.SELF.dimensions[1].items[2].config',
      'subforms.SELF.dimensions[1].items[3].config',
      'subforms.SELF.dimensions[1].items[4].config',
      'subforms.SELF.dimensions[1].items[5].type',
    ]);
  });

  it('Markdown 与文本组件共用受控字数和默认值配置', () => {
    const template = validTemplate();
    const promotion = template.subforms.find(
      (subform) => subform.type === 'PROMOTION',
    )!;
    promotion.dimensions[0].items[0].config = {
      minLength: 10,
      maxLength: 2_000,
      defaultValue: '## 请填写晋升材料',
    };

    expect(validateFormTemplatePublication(template)).toEqual([]);
  });
});
