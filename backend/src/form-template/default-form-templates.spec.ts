import { createHash } from 'node:crypto';
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
  it('提供可幂等识别且能够直接发布的 D/M v2 三子表单模板', () => {
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
        version: 2,
        status: 'PUBLISHED',
        prefix: 'D',
        subforms: ['SELF', 'PEER', 'MANAGER'],
      },
      {
        systemKey: 'DEFAULT_M',
        version: 2,
        status: 'PUBLISHED',
        prefix: 'M',
        subforms: ['SELF', 'PEER', 'MANAGER'],
      },
    ]);
    expect(
      DEFAULT_FORM_TEMPLATES.flatMap(validateFormTemplatePublication),
    ).toEqual([]);
  });

  it('默认员工自评采用数据库 V2 的单一预置 Markdown 年中总结', () => {
    for (const template of DEFAULT_FORM_TEMPLATES) {
      const self = template.subforms.find(
        (subform) => subform.type === 'SELF',
      )!;
      const summaryDimension = self.dimensions[1];
      const summaryField = summaryDimension.fields[0];
      const defaultValue = summaryField.config?.defaultValue;

      expect(self.dimensions[0].name).toBe('绩效等级');
      expect({
        ...summaryDimension,
        fields: [
          {
            ...summaryField,
            config: {
              defaultValueSha256:
                typeof defaultValue === 'string'
                  ? createHash('sha256').update(defaultValue).digest('hex')
                  : null,
            },
          },
        ],
      }).toEqual({
        key: 'self:summary-and-plan',
        name: template.jobLevelPrefix === 'D' ? '年中总结' : '总结与规划',
        type: 'NON_SCORING',
        scoringMethod: null,
        audience: 'EMPLOYEE',
        weight: null,
        isCore: false,
        sortOrder: 1,
        fields: [
          {
            key: 'self:summary',
            title: '年中总结',
            type: 'MARKDOWN',
            requiredRule: 'ALWAYS',
            requiredLevels: [],
            sortOrder: 0,
            placeholder: '',
            config: {
              // 摘要来自当前数据库 D/M V2 的完整 Markdown，包含空行和转义字符。
              defaultValueSha256:
                '4082e0570ee904f8b4ccd874bf5f142cfeac6b559059b7ad468bad3e2f3b70b0',
            },
          },
        ],
      });
    }
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

  it('新版基线不创建晋升子表单', () => {
    expect(
      DEFAULT_FORM_TEMPLATES.flatMap((template) => template.subforms).some(
        (subform) => String(subform.type) === 'PROMOTION',
      ),
    ).toBe(false);
  });
});
