import {
  DEFAULT_FORM_TEMPLATES,
  DEFAULT_LEGACY_PROMOTION_SUBFORM,
} from './default-form-templates';
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
    key: dimension.key,
    name: dimension.name,
    weight: dimension.weight,
    isCore: dimension.isCore,
    audience: dimension.audience,
    scoringMethod: dimension.scoringMethod,
    commentRule: dimension.fields[0]?.requiredRule,
    commentLevels: dimension.fields[0]?.requiredLevels,
  }));
};

describe('DEFAULT_FORM_TEMPLATES', () => {
  it('提供可幂等识别且能够直接发布的 D/M v1 三子表单模板', () => {
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
        subforms: ['SELF', 'PEER', 'MANAGER'],
      },
      {
        systemKey: 'DEFAULT_M',
        version: 1,
        status: 'PUBLISHED',
        prefix: 'M',
        subforms: ['SELF', 'PEER', 'MANAGER'],
      },
    ]);
    expect(
      DEFAULT_FORM_TEMPLATES.flatMap(validateFormTemplatePublication),
    ).toEqual([]);
  });

  it('默认员工自评为占比 100% 的评级核心维度', () => {
    for (const template of DEFAULT_FORM_TEMPLATES) {
      const self = template.subforms.find(
        (subform) => subform.type === 'SELF',
      )!;
      expect(self.dimensions[0]).toEqual(
        expect.objectContaining({
          key: 'self:performance',
          type: 'SCORING',
          scoringMethod: 'RATING',
          weight: 100,
          isCore: true,
        }),
      );
    }
  });

  it('锁定 D/M 维度名称、占比、计分方式与 S/C 条件评价字段', () => {
    expect(summarizeDimensions('D', 'PEER')).toEqual([
      expect.objectContaining({
        name: '工作贡献与责任担当',
        weight: 35,
        isCore: true,
        scoringMethod: 'RATING',
        commentRule: 'CONDITIONAL',
        commentLevels: ['S', 'C'],
      }),
      expect.objectContaining({ name: '协作沟通与价值观', weight: 45 }),
      expect.objectContaining({ name: '学习成长与潜力', weight: 20 }),
    ]);
    expect(summarizeDimensions('M', 'PEER')).toEqual([
      expect.objectContaining({ name: '结果推动与责任担当', weight: 40 }),
      expect.objectContaining({ name: '协作沟通与组织影响', weight: 35 }),
      expect.objectContaining({ name: '领导力与价值观', weight: 25 }),
    ]);
    expect(summarizeDimensions('D', 'MANAGER')).toEqual([
      expect.objectContaining({
        name: '核心业绩',
        weight: 70,
        isCore: true,
        scoringMethod: 'SCORE',
      }),
      expect.objectContaining({ name: '价值观', weight: 20 }),
      expect.objectContaining({ name: '职业素养与潜力', weight: 10 }),
    ]);
    expect(summarizeDimensions('M', 'MANAGER')).toEqual([
      expect.objectContaining({ name: '核心业绩', weight: 50 }),
      expect.objectContaining({ name: '管理绩效', weight: 50 }),
    ]);
  });

  it('旧晋升表单独立只读保留且不进入绩效发布契约', () => {
    expect(DEFAULT_LEGACY_PROMOTION_SUBFORM.type).toBe('PROMOTION');
    expect(
      DEFAULT_LEGACY_PROMOTION_SUBFORM.dimensions.map((dimension) => ({
        audience: dimension.audience,
        fieldTypes: dimension.fields.map((field) => String(field.type)),
      })),
    ).toEqual([
      {
        audience: 'EMPLOYEE',
        fieldTypes: ['MARKDOWN', 'MARKDOWN', 'ATTACHMENT', 'LINK'],
      },
      {
        audience: 'LEADER',
        fieldTypes: ['SINGLE_SELECT', 'LONG_TEXT'],
      },
    ]);
  });
});
