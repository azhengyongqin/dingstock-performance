import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { buildDefaultConfigTemplate } from './default-config-template';
import {
  CalculateConfigTemplatePreviewDto,
  CreateConfigTemplateDto,
  ReplaceConfigTemplateDraftDto,
} from './config-template.dto';

describe('ConfigTemplate DTO', () => {
  it('草稿允许暂时不绑定表单，由发布校验一次报告 D/M 缺失', async () => {
    const draft = buildDefaultConfigTemplate();
    const dto = plainToInstance(ReplaceConfigTemplateDraftDto, {
      ...draft,
      formTemplateVersionIds: [],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('拒绝阶段重复的相对日程和通知规则', async () => {
    const draft = buildDefaultConfigTemplate();
    const dto = plainToInstance(ReplaceConfigTemplateDraftDto, {
      ...draft,
      formTemplateVersionIds: [],
      schedulePreset: {
        ...draft.schedulePreset,
        stages: [
          draft.schedulePreset.stages[0],
          draft.schedulePreset.stages[0],
          draft.schedulePreset.stages[2],
        ],
      },
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'schedulePreset')).toBe(
      true,
    );
  });

  it('计算预览只接受受控阶段、职级前缀和关系类型', async () => {
    const dto = plainToInstance(CalculateConfigTemplatePreviewDto, {
      stage: 'PEER',
      jobLevelPrefix: 'D',
      dimensions: [
        {
          dimensionId: 1,
          relations: [{ type: 'PEER', rawValues: ['A'] }],
        },
      ],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('SELF/AI 直接评级预览无需发送占位维度', async () => {
    const dto = plainToInstance(CalculateConfigTemplatePreviewDto, {
      stage: 'SELF',
      jobLevelPrefix: 'M',
      directRating: 'A',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('在进入 Prisma 前拒绝超过数据库百分比列范围的关系权重', async () => {
    const draft = buildDefaultConfigTemplate();
    const dto = plainToInstance(ReplaceConfigTemplateDraftDto, {
      ...draft,
      formTemplateVersionIds: [],
      reviewerRelationWeights: {
        ...draft.reviewerRelationWeights,
        ORG_OWNER: '101',
      },
    });

    const errors = await validate(dto);
    expect(
      errors.some((error) => error.property === 'reviewerRelationWeights'),
    ).toBe(true);
  });

  it('创建和覆盖草稿都在进入数据库前拒绝纯空白模板名称', async () => {
    const create = plainToInstance(CreateConfigTemplateDto, { name: '   ' });
    const draft = buildDefaultConfigTemplate();
    const replace = plainToInstance(ReplaceConfigTemplateDraftDto, {
      ...draft,
      name: '   ',
      formTemplateVersionIds: [],
    });

    const [createErrors, replaceErrors] = await Promise.all([
      validate(create),
      validate(replace),
    ]);
    expect(createErrors.some((error) => error.property === 'name')).toBe(true);
    expect(replaceErrors.some((error) => error.property === 'name')).toBe(true);
  });
});
