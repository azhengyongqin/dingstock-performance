import {
  analyzeParticipantFormMatch,
  resolveJobLevelPrefix,
} from './participant-prefix';

describe('participant-prefix', () => {
  describe('resolveJobLevelPrefix', () => {
    it.each([
      [{ code: 'D3' }, 'D'],
      [{ code: ' m2 ' }, 'M'],
      [{ code: 'M-1' }, 'M'],
    ])('兼容从 CoreHR job_level.code 解析受控前缀', (jobLevel, expected) => {
      expect(resolveJobLevelPrefix(jobLevel)).toEqual({
        levelValue: jobLevel.code.trim(),
        prefix: expected,
        status: 'MATCHED',
      });
    });

    it.each([
      [
        {
          name: [
            { lang: 'en-US', value: 'M2-1' },
            { lang: 'zh-CN', value: 'D3-1' },
          ],
        },
        'D3-1',
        'D',
      ],
    ])(
      '优先按组织架构成员表格的职级名称解析前缀',
      (jobLevel, levelValue, prefix) => {
        expect(resolveJobLevelPrefix(jobLevel)).toEqual({
          levelValue,
          prefix,
          status: 'MATCHED',
        });
      },
    );

    it.each([
      [null, 'MISSING_JOB_LEVEL'],
      [{}, 'MISSING_JOB_LEVEL'],
      [{ code: 'P5' }, 'UNSUPPORTED_PREFIX'],
      [{ code: 3 }, 'MISSING_JOB_LEVEL'],
      [{ name: 'D3-1', code: 'D3' }, 'MISSING_JOB_LEVEL'],
      [{ name: [], code: 'D3' }, 'MISSING_JOB_LEVEL'],
      [{ name: null, code: 'D3' }, 'MISSING_JOB_LEVEL'],
      [
        {
          name: [
            { lang: 'zh-CN', value: '' },
            { lang: 'en-US', value: 'M2-1' },
          ],
        },
        'MISSING_JOB_LEVEL',
      ],
    ])('不使用职级之外的岗位或人工值兜底：%p', (jobLevel, status) => {
      expect(resolveJobLevelPrefix(jobLevel).status).toBe(status);
    });
  });

  it('每名参与人必须且只能匹配一个当前表单快照', () => {
    const matched = analyzeParticipantFormMatch(
      { id: 1, employeeOpenId: 'ou_1', jobLevelSnapshot: { code: 'd4' } },
      [{ id: 10, jobLevelPrefix: 'D' }],
    );
    const missing = analyzeParticipantFormMatch(
      { id: 2, employeeOpenId: 'ou_2', jobLevelSnapshot: { code: 'M1' } },
      [{ id: 10, jobLevelPrefix: 'D' }],
    );
    const ambiguous = analyzeParticipantFormMatch(
      { id: 3, employeeOpenId: 'ou_3', jobLevelSnapshot: { code: 'D2' } },
      [
        { id: 10, jobLevelPrefix: 'D' },
        { id: 11, jobLevelPrefix: 'D' },
      ],
    );

    expect(matched).toMatchObject({
      status: 'MATCHED',
      jobLevelPrefix: 'D',
      formSnapshotId: 10,
    });
    expect(missing.status).toBe('NO_FORM');
    expect(ambiguous.status).toBe('AMBIGUOUS_FORM');
  });
});
