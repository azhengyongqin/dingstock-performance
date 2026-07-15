import {
  buildLegacyFormSnapshot,
  compareLegacyManagerLevel,
  evaluateMigrationReadiness,
  mapLegacyCycleStatus,
  mapLegacyParticipantStatus,
  rebuildLegacyDimensionItems,
} from './legacy-migration-domain';

describe('legacy migration public boundaries', () => {
  it('旧周期细粒度状态映射为四态，未知状态必须进入异常而不是猜测', () => {
    expect(mapLegacyCycleStatus('SELF_REVIEW')).toEqual({ value: 'ACTIVE' });
    expect(mapLegacyCycleStatus('PENDING')).toEqual({ value: 'DRAFT' });
    expect(mapLegacyCycleStatus('MYSTERY')).toEqual({
      issue: 'UNMAPPED_CYCLE_STATUS',
      sourceValue: 'MYSTERY',
    });
  });

  it('参与者按结果链事实映射，旧流程进度统一收敛为 ACTIVE', () => {
    expect(
      mapLegacyParticipantStatus('AI_DONE', {
        hasCalibration: false,
        hasPublishedResult: false,
        resultConfirmed: false,
        hasOpenAppeal: false,
      }),
    ).toEqual({ value: 'ACTIVE' });
    expect(
      mapLegacyParticipantStatus('SELF_SUBMITTED', {
        hasCalibration: true,
        hasPublishedResult: true,
        resultConfirmed: true,
        hasOpenAppeal: false,
      }),
    ).toEqual({ value: 'CONFIRMED' });
    expect(
      mapLegacyParticipantStatus('ARCHIVED', {
        hasCalibration: false,
        hasPublishedResult: false,
        resultConfirmed: false,
        hasOpenAppeal: false,
      }),
    ).toEqual({
      issue: 'AMBIGUOUS_PARTICIPANT_STATUS',
      sourceValue: 'ARCHIVED',
      reason: '参与者旧 ARCHIVED 缺少可证明的关闭事实',
    });
  });

  it('从旧维度构造稳定快照 key，并只重建可验证的关系化答案', () => {
    const snapshot = buildLegacyFormSnapshot('D', [
      {
        id: 42,
        name: '核心业绩',
        type: 'REGULAR',
        scoringMethod: 'SCORE',
        weight: '70',
        required: true,
        sortOrder: 0,
        editableRoles: ['LEADER'],
        formSchema: null,
      },
    ]);
    const rebuilt = rebuildLegacyDimensionItems({
      stage: 'MANAGER',
      dimensionScores: [
        { dimensionId: 42, score: '88.50', comment: '达成目标' },
      ],
      snapshot,
    });
    expect(rebuilt.issues).toEqual([]);
    expect(rebuilt.items).toEqual([
      expect.objectContaining({
        dimensionKey: 'legacy-dimension:42:MANAGER',
        itemKey: 'legacy-dimension:42:MANAGER:score',
        itemType: 'SCORE',
        rawScore: '88.50',
      }),
      expect.objectContaining({
        itemKey: 'legacy-dimension:42:MANAGER:comment',
        itemType: 'LONG_TEXT',
        value: '达成目标',
      }),
    ]);
  });

  it('旧维度 JSON 出现重复、未知维度或越界分数时给出字段路径', () => {
    const snapshot = buildLegacyFormSnapshot('D', [
      {
        id: 7,
        name: '价值观',
        type: 'REGULAR',
        scoringMethod: 'SCORE',
        weight: '100',
        required: true,
        sortOrder: 0,
        editableRoles: ['LEADER'],
        formSchema: null,
      },
    ]);
    const rebuilt = rebuildLegacyDimensionItems({
      stage: 'MANAGER',
      dimensionScores: [
        { dimensionId: 7, score: 101 },
        { dimensionId: 7, score: 80 },
        { dimensionId: 999, score: 80 },
      ],
      snapshot,
    });
    expect(rebuilt.items).toEqual([]);
    expect(rebuilt.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_SCORE', path: '[0].score' }),
        expect.objectContaining({
          code: 'DUPLICATE_DIMENSION',
          path: '[1].dimensionId',
        }),
        expect.objectContaining({
          code: 'UNKNOWN_DIMENSION',
          path: '[2].dimensionId',
        }),
      ]),
    );
  });

  it('影子比较复用正式计算引擎并解释约束导致的差异', () => {
    const comparison = compareLegacyManagerLevel({
      participantBusinessKey: 'cycle:3/employee:ou_1',
      legacyLevel: 'A',
      calculationInput: {
        mode: 'WEIGHTED_SCORE',
        ratings: [
          { symbol: 'S', minScore: 90, maxScore: 100, mappingScore: 95 },
          { symbol: 'A', minScore: 80, maxScore: 90, mappingScore: 85 },
          { symbol: 'B', minScore: 60, maxScore: 80, mappingScore: 70 },
          { symbol: 'C', minScore: 0, maxScore: 60, mappingScore: 50 },
        ],
        dimensions: [
          {
            id: 'core',
            name: '核心业绩',
            weight: 100,
            isCore: true,
            relations: [
              {
                type: 'DIRECT',
                weight: 100,
                items: [{ itemId: 'score', submissionId: '1', rawValue: 75 }],
              },
            ],
          },
        ],
        constraints: [
          {
            id: 'core-cap-b',
            type: 'CORE_SCORE_CAP',
            threshold: 80,
            targetLevel: 'B',
          },
        ],
        confirmedRedLine: null,
      },
    });
    expect(comparison).toEqual(
      expect.objectContaining({
        businessKey: 'cycle:3/employee:ou_1',
        legacyLevel: 'A',
        computedLevel: 'B',
        different: true,
        reason: expect.stringContaining('CORE_SCORE_CAP'),
      }),
    );
  });

  it('readiness gate 要求计数/业务键/有效提交闭合、零迁移异常和影子差异已处置', () => {
    expect(
      evaluateMigrationReadiness({
        sourceCounts: { cycles: 2, submittedReviews: 3, results: 1 },
        targetCounts: { cycles: 2, submittedReviews: 3, results: 1 },
        missingBusinessKeys: [],
        invalidDimensionResults: 0,
        unclosedStatuses: 0,
        migrationFailures: 0,
        shadowComparisons: [
          { different: true, disposition: 'UNRESOLVED', businessKey: 'p:1' },
        ],
      }).ready,
    ).toBe(false);

    expect(
      evaluateMigrationReadiness({
        sourceCounts: { cycles: 2, submittedReviews: 3, results: 1 },
        targetCounts: { cycles: 2, submittedReviews: 3, results: 1 },
        missingBusinessKeys: [],
        invalidDimensionResults: 0,
        unclosedStatuses: 0,
        migrationFailures: 0,
        shadowComparisons: [
          { different: true, disposition: 'ACCEPTED', businessKey: 'p:1' },
        ],
      }),
    ).toEqual(expect.objectContaining({ ready: true, blockers: [] }));
  });
});
