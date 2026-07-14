import { DEFAULT_FORM_TEMPLATES } from '../form-template/default-form-templates';
import type { ConfigTemplateVersionContract } from './config-template.contract';
import { previewConfigCalculation } from './calculation-preview';
import { buildDefaultConfigTemplate } from './default-config-template';

function validConfig(): ConfigTemplateVersionContract {
  const value = buildDefaultConfigTemplate(
    DEFAULT_FORM_TEMPLATES.map((template, index) => ({
      formTemplateVersionId: index + 11,
      status: 'PUBLISHED' as const,
      jobLevelPrefix: template.jobLevelPrefix,
      subforms: template.subforms,
    })),
  );
  return {
    ...value,
    schedulePreset: {
      allowStageOverlap: true,
      stages: [
        {
          stage: 'SELF',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 1440,
        },
        {
          stage: 'PEER',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 1440,
        },
        {
          stage: 'MANAGER',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 1440,
        },
      ],
    },
  };
}

describe('previewConfigCalculation', () => {
  it.each(['SELF', 'AI'] as const)('%s 直接评级不虚构综合分', (stage) => {
    const result = previewConfigCalculation({
      config: validConfig(),
      stage,
      jobLevelPrefix: 'D',
      directLevel: 'A',
    });

    expect(result).toMatchObject({
      status: 'READY',
      stage,
      mode: 'DIRECT_RATING',
      result: { type: 'DIRECT_RATING', level: 'A' },
    });
  });

  it('PEER 注入配置关系权重并由统一引擎归一化有效关系', () => {
    const result = previewConfigCalculation({
      config: validConfig(),
      stage: 'PEER',
      jobLevelPrefix: 'D',
      dimensions: [
        {
          id: 'delivery',
          name: '工作贡献与责任担当',
          weight: '100',
          isCore: true,
          relations: [
            { relation: 'ORG_OWNER', rawValues: ['S'] },
            { relation: 'PEER', rawValues: ['C'] },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'READY',
      mode: 'WEIGHTED_RATING',
      result: {
        compositeScore: '74.55',
        initialLevel: 'B',
        dimensions: [
          {
            relations: [
              { type: 'ORG_OWNER', baseWeight: '30' },
              { type: 'PEER', baseWeight: '25' },
            ],
          },
        ],
      },
    });
  });

  it('MANAGER 固定使用 LEADER=100 并复用评分约束', () => {
    const result = previewConfigCalculation({
      config: validConfig(),
      stage: 'MANAGER',
      jobLevelPrefix: 'D',
      dimensions: [
        {
          id: 'delivery',
          name: '核心业绩',
          weight: '100',
          isCore: true,
          relations: [{ relation: 'LEADER', rawValues: ['59.99'] }],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'READY',
      mode: 'WEIGHTED_SCORE',
      result: {
        compositeScore: '59.99',
        initialLevel: 'C',
        finalLevel: 'C',
        dimensions: [{ relations: [{ type: 'LEADER', baseWeight: '100' }] }],
      },
    });
  });

  it('配置不可发布时返回完整发布问题而不调用数学预览', () => {
    const result = previewConfigCalculation({
      config: buildDefaultConfigTemplate(),
      stage: 'SELF',
      jobLevelPrefix: 'D',
      directLevel: 'A',
    });

    expect(result.status).toBe('UNAVAILABLE');
    if (result.status === 'UNAVAILABLE') {
      expect(result.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining([
          'FORM_BINDING_REQUIRED',
          'SCHEDULE_REMINDER_NOT_AFTER_START',
        ]),
      );
    }
  });

  it('拒绝把 LEADER 关系用于 PEER 预览', () => {
    const result = previewConfigCalculation({
      config: validConfig(),
      stage: 'PEER',
      jobLevelPrefix: 'M',
      dimensions: [
        {
          id: 'impact',
          name: '组织影响',
          weight: '100',
          isCore: true,
          relations: [{ relation: 'LEADER', rawValues: ['A'] }],
        },
      ],
    });

    expect(result).toEqual({
      status: 'UNAVAILABLE',
      issues: [expect.objectContaining({ code: 'PREVIEW_RELATION_INVALID' })],
    });
  });

  it('评分精度错误由统一计算引擎返回为不可预览原因', () => {
    const result = previewConfigCalculation({
      config: validConfig(),
      stage: 'MANAGER',
      jobLevelPrefix: 'M',
      dimensions: [
        {
          id: 'delivery',
          name: '核心业绩',
          weight: '100',
          isCore: true,
          relations: [{ relation: 'LEADER', rawValues: ['80.001'] }],
        },
      ],
    });

    expect(result).toEqual({
      status: 'UNAVAILABLE',
      issues: [
        expect.objectContaining({ code: 'PREVIEW_INVALID_SCORE_PRECISION' }),
      ],
    });
  });
});
