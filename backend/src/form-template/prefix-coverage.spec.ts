import { analyzeFormTemplatePrefixCoverage } from './prefix-coverage';

describe('analyzeFormTemplatePrefixCoverage', () => {
  it('D/M 各匹配一个版本时覆盖完整', () => {
    expect(
      analyzeFormTemplatePrefixCoverage([
        { id: 11, jobLevelPrefix: 'D' },
        { id: 12, jobLevelPrefix: 'M' },
      ]),
    ).toEqual({
      complete: true,
      matches: { D: [11], M: [12] },
      issues: [],
    });
  });

  it('一次报告重复 D 和缺失 M，避免参与人多重匹配或无表可用', () => {
    expect(
      analyzeFormTemplatePrefixCoverage([
        { id: 21, jobLevelPrefix: 'D' },
        { id: 22, jobLevelPrefix: 'D' },
      ]),
    ).toEqual({
      complete: false,
      matches: { D: [21, 22], M: [] },
      issues: [
        {
          code: 'PREFIX_DUPLICATE',
          prefix: 'D',
          versionIds: [21, 22],
          message: '职级前缀 D 同时匹配多个表单版本',
        },
        {
          code: 'PREFIX_MISSING',
          prefix: 'M',
          versionIds: [],
          message: '职级前缀 M 缺少表单版本覆盖',
        },
      ],
    });
  });
});
