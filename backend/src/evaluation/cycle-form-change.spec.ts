import {
  buildCycleFormChangePlan,
  classifyCycleFormChange,
} from './cycle-form-change';

const original: any = {
  schemaVersion: 2,
  name: 'D 表单',
  jobLevelPrefix: 'D',
  subforms: [
    {
      key: 'subform:SELF',
      type: 'SELF',
      title: '员工自评',
      sortOrder: 0,
      dimensions: [
        {
          key: 'dimension:self',
          type: 'SCORING',
          audience: 'EMPLOYEE',
          name: '自评等级',
          scoringMethod: 'RATING',
          weight: '100',
          isCore: true,
          sortOrder: 0,
          fields: [
            {
              key: 'field:self-comment',
              type: 'LONG_TEXT',
              title: '工作总结',
              requiredRule: 'CONDITIONAL',
              requiredLevels: ['S', 'C'],
              sortOrder: 0,
              config: { minLength: 2, maxLength: 500 },
            },
          ],
        },
      ],
    },
    {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '上级评估',
      sortOrder: 1,
      dimensions: [
        {
          key: 'dimension:delivery',
          type: 'SCORING',
          audience: 'LEADER',
          name: '核心业绩',
          scoringMethod: 'SCORE',
          weight: '100',
          isCore: true,
          sortOrder: 0,
          fields: [],
        },
      ],
    },
  ],
};

describe('周期表单变更分类与预填公开 seam', () => {
  it('准确解释维度计分配置、字段和条件必填变化', () => {
    const calculation = structuredClone(original);
    calculation.subforms[1].dimensions[0].weight = '80';
    expect(classifyCycleFormChange(original, calculation)).toMatchObject({
      category: 'CALCULATION',
      affectedStages: ['MANAGER'],
      changes: [
        expect.objectContaining({
          kind: 'DIMENSION_CALCULATION_CHANGED',
          dimensionKey: 'dimension:delivery',
          message: expect.stringContaining('占比'),
        }),
      ],
    });

    const structural = structuredClone(original);
    structural.subforms[0].dimensions[0].scoringMethod = 'SCORE';
    structural.subforms[0].dimensions[0].fields[0].requiredLevels = ['A'];
    expect(classifyCycleFormChange(original, structural)).toMatchObject({
      category: 'STRUCTURAL',
      affectedStages: ['SELF'],
      changes: expect.arrayContaining([
        expect.objectContaining({
          kind: 'DIMENSION_SCORING_METHOD_CHANGED',
          dimensionKey: 'dimension:self',
        }),
        expect.objectContaining({
          kind: 'FIELD_REQUIRED_LEVELS_CHANGED',
          fieldKey: 'field:self-comment',
          message: expect.stringContaining('条件必填'),
        }),
      ]),
    });
  });

  it('改名、排序、跨维度移动和类型变更始终沿用原业务 key', () => {
    const next = structuredClone(original);
    const self = next.subforms[0];
    const field = self.dimensions[0].fields.shift();
    self.dimensions[0].name = '本期自评';
    self.dimensions[0].sortOrder = 1;
    self.dimensions.push({
      key: 'dimension:summary',
      type: 'NON_SCORING',
      audience: 'EMPLOYEE',
      name: '补充总结',
      scoringMethod: null,
      weight: null,
      isCore: false,
      sortOrder: 0,
      fields: [{ ...field, title: '本期总结', sortOrder: 3 }],
    });
    const classification = classifyCycleFormChange(original, next);

    expect(classification.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'FIELD_MOVED',
          fieldKey: 'field:self-comment',
        }),
      ]),
    );
    expect(classification.changes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'FIELD_REMOVED',
          fieldKey: 'field:self-comment',
        }),
        expect.objectContaining({
          kind: 'FIELD_ADDED',
          fieldKey: 'field:self-comment',
        }),
      ]),
    );

    next.subforms[0].dimensions[1].fields[0].type = 'MARKDOWN';
    expect(classifyCycleFormChange(original, next).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'FIELD_TYPE_CHANGED',
          fieldKey: 'field:self-comment',
        }),
      ]),
    );
  });

  it('按稳定 key 跨维度预填兼容字段，计分方式和字段类型不兼容时明确失效', () => {
    const next = structuredClone(original);
    const self = next.subforms[0];
    const field = self.dimensions[0].fields.shift();
    self.dimensions[0].scoringMethod = 'SCORE';
    self.dimensions.push({
      key: 'dimension:summary',
      type: 'NON_SCORING',
      audience: 'EMPLOYEE',
      name: '补充总结',
      scoringMethod: null,
      weight: null,
      isCore: false,
      sortOrder: 1,
      fields: [field],
    });

    const plan = buildCycleFormChangePlan(next, 'SELF', [
      {
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:self',
        scoringMethod: 'RATING',
        rawLevel: 'A',
        rawScore: null,
        fields: [
          {
            fieldKey: 'field:self-comment',
            fieldType: 'LONG_TEXT',
            value: '已填写总结',
          },
        ],
      },
    ]);

    expect(plan.compatibleDimensionAnswers).toEqual([]);
    expect(plan.compatibleFieldAnswers).toEqual([
      expect.objectContaining({
        fieldKey: 'field:self-comment',
        dimensionKey: 'dimension:summary',
        value: '已填写总结',
      }),
    ]);
    expect(plan.incompatibleAnswerKeys).toEqual([
      'dimension:dimension:self:scoring',
    ]);

    next.subforms[0].dimensions[1].fields[0].type = 'MARKDOWN';
    const incompatible = buildCycleFormChangePlan(next, 'SELF', [
      {
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:self',
        scoringMethod: null,
        rawLevel: null,
        rawScore: null,
        fields: [
          {
            fieldKey: 'field:self-comment',
            fieldType: 'LONG_TEXT',
            value: '旧文本',
          },
        ],
      },
    ]);
    expect(incompatible.compatibleFieldAnswers).toEqual([]);
    expect(incompatible.incompatibleAnswerKeys).toEqual([
      'field:field:self-comment',
    ]);
  });

  it('受控选项收窄时不会把旧值误配到新字段', () => {
    const next = structuredClone(original);
    next.subforms[0].dimensions[0].fields[0] = {
      ...next.subforms[0].dimensions[0].fields[0],
      type: 'SINGLE_SELECT',
      requiredRule: 'OPTIONAL',
      requiredLevels: [],
      config: { options: [{ value: 'KEEP', label: '保留' }] },
    };
    const plan = buildCycleFormChangePlan(next, 'SELF', [
      {
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:self',
        scoringMethod: null,
        rawLevel: null,
        rawScore: null,
        fields: [
          {
            fieldKey: 'field:self-comment',
            fieldType: 'SINGLE_SELECT',
            value: 'REMOVED',
          },
        ],
      },
    ]);

    expect(plan.compatibleFieldAnswers).toEqual([]);
    expect(plan.incompatibleAnswerKeys).toEqual(['field:field:self-comment']);
  });
});
