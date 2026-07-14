import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnalyzeFormTemplatePrefixCoverageDto } from './form-template.dto';

describe('AnalyzeFormTemplatePrefixCoverageDto', () => {
  it('允许空候选，以便公开 API 返回 D/M 均缺失', async () => {
    const dto = plainToInstance(AnalyzeFormTemplatePrefixCoverageDto, {
      versionIds: [],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
