import { buildDefaultConfigTemplate } from './default-config-template';

describe('buildDefaultConfigTemplate', () => {
  it('提供 S/A/B/C 映射和四类默认关系权重，不再公开旧全局规则', () => {
    const value = buildDefaultConfigTemplate();

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
    expect(value).not.toHaveProperty('stageModes');
    expect(value).not.toHaveProperty('constraintProfiles');
    value.ratings.forEach((rating) => {
      expect(rating).not.toHaveProperty('commentRequired');
    });
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
