import type { FormTemplateSubformContract } from './form-template.contract';
import {
  toPerformanceSubformContracts,
  toPerformanceSubformCreateData,
} from './form-template.persistence';

describe('form-template persistence adapter', () => {
  it('计分方式未完成的草稿往返后保持字段排序不漂移', () => {
    const source: FormTemplateSubformContract[] = [
      {
        type: 'SELF',
        title: '员工自评',
        sortOrder: 0,
        dimensions: [
          {
            key: 'draft-dimension',
            type: 'SCORING',
            scoringMethod: null,
            audience: 'EMPLOYEE',
            name: '',
            weight: null,
            isCore: false,
            sortOrder: 0,
            fields: [
              {
                key: 'draft-field',
                type: 'MARKDOWN',
                title: '',
                requiredRule: 'OPTIONAL',
                requiredLevels: [],
                sortOrder: 0,
              },
            ],
          },
        ],
      },
    ];

    const createData = toPerformanceSubformCreateData(source);
    const persisted = createData.map((subform) => ({
      ...subform,
      dimensions: subform.dimensions.create.map((dimension) => ({
        ...dimension,
        fields: dimension.fields.create,
      })),
    }));

    expect(
      toPerformanceSubformContracts(persisted)[0].dimensions[0].fields[0]
        .sortOrder,
    ).toBe(0);
  });

  it('数据库物理结构归一化后保留计算预览所需的维度 ID', () => {
    const result = toPerformanceSubformContracts([
      {
        type: 'PEER',
        title: '360°评估',
        sortOrder: 1,
        dimensions: [
          {
            id: 501,
            businessKey: 'peer-result',
            type: 'SCORING',
            scoringMethod: 'RATING',
            audience: 'REVIEWER',
            name: '协作表现',
            weight: 100,
            isCore: true,
            sortOrder: 0,
            fields: [
              {
                id: 601,
                businessKey: 'peer-comment',
                type: 'LONG_TEXT',
                title: '评价说明',
                requiredRule: 'OPTIONAL',
                requiredLevels: [],
                sortOrder: 0,
              },
            ],
          },
        ],
      },
    ]);

    expect(result[0].dimensions[0]).toEqual(
      expect.objectContaining({ id: 501, type: 'SCORING' }),
    );
  });
});
