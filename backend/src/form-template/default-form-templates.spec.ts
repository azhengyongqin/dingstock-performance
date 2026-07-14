import { DEFAULT_FORM_TEMPLATES } from './default-form-templates';
import { validateFormTemplatePublication } from './publication-validator';

const summarizeDimensions = (
  prefix: 'D' | 'M',
  subformType: 'PEER' | 'MANAGER',
) => {
  const template = DEFAULT_FORM_TEMPLATES.find(
    (candidate) => candidate.jobLevelPrefix === prefix,
  )!;
  const subform = template.subforms.find(
    (candidate) => candidate.type === subformType,
  )!;
  return subform.dimensions.map((dimension) => ({
    name: dimension.name,
    weight: dimension.weight,
    isCore: dimension.isCore,
    audience: dimension.audience,
    scoringType: dimension.items.find((item) =>
      ['RATING', 'SCORE'].includes(item.type),
    )?.type,
  }));
};

describe('DEFAULT_FORM_TEMPLATES', () => {
  it('提供可幂等识别且能够直接发布的 D/M v1 完整模板', () => {
    expect(
      DEFAULT_FORM_TEMPLATES.map((template) => ({
        systemKey: template.systemKey,
        version: template.version,
        status: template.status,
        prefix: template.jobLevelPrefix,
        subforms: template.subforms.map((subform) => subform.type),
      })),
    ).toEqual([
      {
        systemKey: 'DEFAULT_D',
        version: 1,
        status: 'PUBLISHED',
        prefix: 'D',
        subforms: ['SELF', 'PEER', 'MANAGER', 'PROMOTION'],
      },
      {
        systemKey: 'DEFAULT_M',
        version: 1,
        status: 'PUBLISHED',
        prefix: 'M',
        subforms: ['SELF', 'PEER', 'MANAGER', 'PROMOTION'],
      },
    ]);
    expect(
      DEFAULT_FORM_TEMPLATES.flatMap(validateFormTemplatePublication),
    ).toEqual([]);
  });

  it('使用锁定的 D/M 360°与上级评估维度、权重和计分类型', () => {
    expect(summarizeDimensions('D', 'PEER')).toEqual([
      {
        name: '工作贡献与责任担当',
        weight: 35,
        isCore: true,
        audience: 'REVIEWER',
        scoringType: 'RATING',
      },
      {
        name: '协作沟通与价值观',
        weight: 45,
        isCore: false,
        audience: 'REVIEWER',
        scoringType: 'RATING',
      },
      {
        name: '学习成长与潜力',
        weight: 20,
        isCore: false,
        audience: 'REVIEWER',
        scoringType: 'RATING',
      },
    ]);
    expect(summarizeDimensions('M', 'PEER')).toEqual([
      {
        name: '结果推动与责任担当',
        weight: 40,
        isCore: true,
        audience: 'REVIEWER',
        scoringType: 'RATING',
      },
      {
        name: '协作沟通与组织影响',
        weight: 35,
        isCore: false,
        audience: 'REVIEWER',
        scoringType: 'RATING',
      },
      {
        name: '领导力与价值观',
        weight: 25,
        isCore: false,
        audience: 'REVIEWER',
        scoringType: 'RATING',
      },
    ]);
    expect(summarizeDimensions('D', 'MANAGER')).toEqual([
      {
        name: '核心业绩',
        weight: 70,
        isCore: true,
        audience: 'LEADER',
        scoringType: 'SCORE',
      },
      {
        name: '价值观',
        weight: 20,
        isCore: false,
        audience: 'LEADER',
        scoringType: 'SCORE',
      },
      {
        name: '职业素养与潜力',
        weight: 10,
        isCore: false,
        audience: 'LEADER',
        scoringType: 'SCORE',
      },
    ]);
    expect(summarizeDimensions('M', 'MANAGER')).toEqual([
      {
        name: '核心业绩',
        weight: 50,
        isCore: true,
        audience: 'LEADER',
        scoringType: 'SCORE',
      },
      {
        name: '管理绩效',
        weight: 50,
        isCore: false,
        audience: 'LEADER',
        scoringType: 'SCORE',
      },
    ]);
  });

  it('晋升内容只提供员工与 Leader 区段并使用附件和 LINK 受控组件', () => {
    for (const template of DEFAULT_FORM_TEMPLATES) {
      const promotion = template.subforms.find(
        (subform) => subform.type === 'PROMOTION',
      )!;
      expect(
        promotion.dimensions.map((dimension) => ({
          kind: dimension.kind,
          audience: dimension.audience,
          itemTypes: dimension.items.map((item) => item.type),
        })),
      ).toEqual([
        {
          kind: 'PROMOTION',
          audience: 'EMPLOYEE',
          itemTypes: ['MARKDOWN', 'MARKDOWN', 'ATTACHMENT', 'LINK'],
        },
        {
          kind: 'PROMOTION',
          audience: 'LEADER',
          itemTypes: ['SINGLE_SELECT', 'LONG_TEXT'],
        },
      ]);
    }
  });
});
