import {
  buildCycleFormChangePlan,
  classifyCycleFormChange,
} from './cycle-form-change';

const original: any = {
  schemaVersion: 1,
  name: 'D 表单',
  jobLevelPrefix: 'D',
  subforms: [
    {
      key: 'subform:SELF',
      type: 'SELF',
      title: '员工自评',
      dimensions: [
        {
          key: 'dimension:self',
          audience: 'EMPLOYEE',
          name: '自评',
          weight: null,
          isCore: false,
          items: [
            {
              key: 'item:self-level',
              type: 'RATING',
              title: '自评等级',
              required: true,
              placeholder: '请选择',
            },
            {
              key: 'item:self-comment',
              type: 'TEXTAREA',
              title: '工作总结',
              required: true,
            },
          ],
        },
      ],
    },
    {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '上级评估',
      dimensions: [
        {
          key: 'dimension:delivery',
          audience: 'LEADER',
          name: '核心业绩',
          weight: '100',
          isCore: true,
          items: [
            {
              key: 'item:manager-score',
              type: 'SCORE',
              title: '业绩评分',
              required: true,
            },
          ],
        },
      ],
    },
  ],
};

describe('周期表单变更分类公开 seam', () => {
  it('分别识别纯文案、计算配置和结构性变更，并解释影响', () => {
    const copy = structuredClone(original);
    copy.subforms[0].dimensions[0].items[0].title = '本周期自评等级';
    copy.subforms[0].dimensions[0].items[0].placeholder = '请选择等级';
    expect(classifyCycleFormChange(original, copy)).toMatchObject({
      category: 'COPY_ONLY',
      affectedStages: [],
      explanation: expect.stringContaining('无需重新提交'),
    });

    const calculation = structuredClone(original);
    calculation.subforms[1].dimensions[0].weight = '80';
    expect(classifyCycleFormChange(original, calculation)).toMatchObject({
      category: 'CALCULATION',
      affectedStages: ['MANAGER'],
      explanation: expect.stringContaining('配置版本与重算流程'),
    });

    const structural = structuredClone(original);
    structural.subforms[0].dimensions[0].items[1].required = false;
    expect(classifyCycleFormChange(original, structural)).toMatchObject({
      category: 'STRUCTURAL',
      affectedStages: ['SELF'],
      explanation: expect.stringContaining('重新提交'),
      changes: expect.arrayContaining([
        expect.objectContaining({
          kind: 'ITEM_REQUIRED_CHANGED',
          itemKey: 'item:self-comment',
        }),
      ]),
    });
  });

  it('按稳定评估项 key 和兼容类型生成预填计划，移动维度时改用新归属', () => {
    const next = structuredClone(original);
    const moved = next.subforms[0].dimensions[0].items.shift()!;
    next.subforms[0].dimensions.push({
      key: 'dimension:self-new',
      audience: 'EMPLOYEE',
      name: '新自评维度',
      weight: null,
      isCore: false,
      items: [moved],
    });
    next.subforms[0].dimensions[0].items[0].type = 'TEXT';

    const plan = buildCycleFormChangePlan(next, 'SELF', [
      {
        itemKey: 'item:self-level',
        itemType: 'RATING',
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:self',
      },
      {
        itemKey: 'item:self-comment',
        itemType: 'TEXTAREA',
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:self',
      },
    ]);

    expect(plan.compatibleItems).toEqual([
      expect.objectContaining({
        itemKey: 'item:self-level',
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:self-new',
      }),
    ]);
    expect(plan.incompatibleItemKeys).toEqual(['item:self-comment']);
  });

  it('只影响发生结构变化的阶段，其他阶段保持有效', () => {
    const next = structuredClone(original);
    next.subforms[0].dimensions[0].items.push({
      key: 'item:new-required',
      type: 'TEXTAREA',
      title: '新增必填',
      required: true,
    });

    expect(classifyCycleFormChange(original, next)).toMatchObject({
      category: 'STRUCTURAL',
      affectedStages: ['SELF'],
    });
  });

  it('表单级名称说明属于纯文案，子表单类型切换属于结构变化', () => {
    const renamed = structuredClone(original);
    renamed.name = 'D 岗位本周期表单';
    expect(classifyCycleFormChange(original, renamed)).toMatchObject({
      category: 'COPY_ONLY',
      affectedStages: [],
    });

    const moved = structuredClone(original);
    moved.subforms[0].type = 'MANAGER';
    moved.subforms[0].dimensions[0].audience = 'LEADER';
    expect(classifyCycleFormChange(original, moved)).toMatchObject({
      category: 'STRUCTURAL',
      affectedStages: ['SELF', 'MANAGER'],
    });
  });
});
