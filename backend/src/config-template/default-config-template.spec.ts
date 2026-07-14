import { buildDefaultConfigTemplate } from './default-config-template';

describe('buildDefaultConfigTemplate', () => {
  it('提供固定阶段模式、S/A/B/C 映射、受控约束和四类默认关系权重', () => {
    const value = buildDefaultConfigTemplate();

    expect(value.stageModes).toEqual({
      SELF: 'DIRECT_RATING',
      PEER: 'WEIGHTED_RATING',
      MANAGER: 'WEIGHTED_SCORE',
      AI: 'DIRECT_RATING',
    });
    expect(
      value.ratings.map(({ symbol, mappingScore }) => [symbol, mappingScore]),
    ).toEqual([
      ['S', '95'],
      ['A', '85'],
      ['B', '70'],
      ['C', '50'],
    ]);
    expect(value.reviewerRelationWeights).toEqual({
      ORG_OWNER: '30',
      PROJECT_OWNER: '30',
      PEER: '25',
      CROSS_DEPT: '15',
    });
    expect(
      value.constraintProfiles.WEIGHTED_RATING.map((rule) => rule.type),
    ).toEqual(['CORE_RATING_FORCE', 'CORE_RATING_CAP', 'ANY_RATING_CAP']);
    expect(
      value.constraintProfiles.WEIGHTED_SCORE.map((rule) => rule.type),
    ).toEqual(['CORE_SCORE_FORCE', 'CORE_SCORE_CAP', 'ANY_SCORE_CAP']);
  });

  it('默认日程使用 0/0 明确保持草稿不可发布', () => {
    expect(buildDefaultConfigTemplate().schedulePreset.stages).toEqual([
      {
        stage: 'SELF',
        startOffsetMinutes: 0,
        reminderDeadlineOffsetMinutes: 0,
      },
      {
        stage: 'PEER',
        startOffsetMinutes: 0,
        reminderDeadlineOffsetMinutes: 0,
      },
      {
        stage: 'MANAGER',
        startOffsetMinutes: 0,
        reminderDeadlineOffsetMinutes: 0,
      },
    ]);
  });
});
