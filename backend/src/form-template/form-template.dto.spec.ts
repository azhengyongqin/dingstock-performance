import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AnalyzeFormTemplatePrefixCoverageDto,
  ReplaceFormTemplateDraftDto,
} from './form-template.dto';

describe('AnalyzeFormTemplatePrefixCoverageDto', () => {
  it('允许空候选，以便公开 API 返回 D/M 均缺失', async () => {
    const dto = plainToInstance(AnalyzeFormTemplatePrefixCoverageDto, {
      versionIds: [],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});

describe('ReplaceFormTemplateDraftDto', () => {
  it('允许新建维度和字段在草稿保存时暂时没有名称', async () => {
    const dto = plainToInstance(ReplaceFormTemplateDraftDto, {
      name: '草稿模板',
      jobLevelPrefix: 'D',
      subforms: [
        {
          type: 'SELF',
          title: '员工自评',
          sortOrder: 0,
          dimensions: [
            {
              type: 'SCORING',
              scoringMethod: 'RATING',
              audience: 'EMPLOYEE',
              name: '',
              weight: 0,
              isCore: false,
              sortOrder: 0,
              fields: [
                {
                  type: 'MARKDOWN',
                  title: '',
                  requiredRule: 'OPTIONAL',
                  requiredLevels: [],
                  sortOrder: 0,
                  config: {},
                },
              ],
            },
          ],
        },
        { type: 'PEER', title: '360°评估', sortOrder: 1, dimensions: [] },
        { type: 'MANAGER', title: '上级评估', sortOrder: 2, dimensions: [] },
      ],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
