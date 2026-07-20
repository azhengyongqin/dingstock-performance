import { execFileSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { loadAppConfig } from '../src/config/configuration';
import { ActiveCycleConfigChangeService } from '../src/evaluation/active-cycle-config-change.service';
import { EvaluationSubmissionService } from '../src/evaluation/evaluation-submission.service';
import { ManagerStageResultService } from '../src/evaluation/manager-stage-result.service';
import { PeerStageResultService } from '../src/evaluation/peer-stage-result.service';
import { PrismaService } from '../src/shared/database/prisma.service';

const ratings = [
  {
    symbol: 'S',
    name: '卓越',
    minScore: '90',
    maxScore: '100',
    mappingScore: '95',
  },
  {
    symbol: 'A',
    name: '优秀',
    minScore: '80',
    maxScore: '90',
    mappingScore: '85',
  },
  {
    symbol: 'B',
    name: '良好',
    minScore: '60',
    maxScore: '80',
    mappingScore: '70',
  },
  {
    symbol: 'C',
    name: '待改进',
    minScore: '0',
    maxScore: '60',
    mappingScore: '50',
  },
] as const;
const formContent = {
  schemaVersion: 2,
  name: 'Ticket 16 D form',
  subforms: [
    {
      key: 'subform:SELF',
      type: 'SELF',
      title: '自评',
      dimensions: [
        {
          key: 'dimension:self',
          type: 'SCORING',
          scoringMethod: 'RATING',
          audience: 'EMPLOYEE',
          name: '自评',
          weight: '100',
          isCore: true,
          fields: [],
        },
      ],
    },
    {
      key: 'subform:PEER',
      type: 'PEER',
      title: '360',
      dimensions: [
        {
          key: 'dimension:peer',
          type: 'SCORING',
          scoringMethod: 'RATING',
          audience: 'REVIEWER',
          name: '协作',
          weight: '100',
          isCore: true,
          fields: [],
        },
      ],
    },
    {
      key: 'subform:MANAGER',
      type: 'MANAGER',
      title: '上级',
      dimensions: [
        {
          key: 'dimension:manager',
          type: 'SCORING',
          scoringMethod: 'SCORE',
          audience: 'LEADER',
          name: '业绩',
          weight: '50',
          isCore: true,
          fields: [],
        },
        {
          key: 'dimension:manager-growth',
          type: 'SCORING',
          scoringMethod: 'SCORE',
          audience: 'LEADER',
          name: '成长',
          weight: '50',
          isCore: false,
          fields: [],
        },
      ],
    },
  ],
};

const dedicatedDatabaseUrl = process.env.TICKET16_TEST_DATABASE_URL;
const managedDatabase = !dedicatedDatabaseUrl;
const baseUrl = loadAppConfig().database.url;
const managedDatabaseName = `active_config_${process.pid}_${Date.now()}`;
const managedUrl = new URL(baseUrl);
managedUrl.pathname = `/${managedDatabaseName}`;
managedUrl.searchParams.delete('schema');
const testDatabaseUrl = dedicatedDatabaseUrl ?? managedUrl.toString();
const adminPool = managedDatabase
  ? new Pool({ connectionString: baseUrl })
  : null;

/**
 * 真实 Prisma/PG 服务集成。默认自动创建隔离数据库，也支持显式传入专用测试库；
 * 始终禁止对日常开发库临时禁用触发器。
 */
describe('Ticket 16 ActiveCycleConfigChangeService PostgreSQL 集成', () => {
  jest.setTimeout(30_000);
  const suffix = `${process.pid}_${Date.now()}`;
  const operator = `ticket16_admin_${suffix}`;
  let prisma: PrismaService;
  let cycleId: number;
  let participantId: number;
  let dimensionAnswerId: number;
  let calibrationId: number;
  let resultVersionId: number;
  let configRootId: number;
  let formRootId: number;
  const rbac = { isAdmin: jest.fn(), getOrgScope: jest.fn() };

  beforeAll(async () => {
    if (managedDatabase) {
      await adminPool!.query(`CREATE DATABASE "${managedDatabaseName}"`);
      execFileSync('pnpm', ['exec', 'prisma', 'db', 'push'], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        stdio: 'pipe',
      });
    }
    prisma = new PrismaService({
      getOrThrow: () => testDatabaseUrl,
    } as unknown as ConfigService);
    await prisma.$connect();

    const formRoot = await prisma.perfFormTemplate.create({
      data: { createdByOpenId: operator },
    });
    formRootId = formRoot.id;
    const formVersion = await prisma.perfFormTemplateVersion.create({
      data: {
        templateId: formRoot.id,
        version: 1,
        status: 'DRAFT',
        name: `Ticket16 form ${suffix}`,
        jobLevelPrefix: 'D',
        createdByOpenId: operator,
        updatedByOpenId: operator,
      },
    });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "performance"."perf_form_template_versions" DISABLE TRIGGER USER',
    );
    try {
      await prisma.perfFormTemplateVersion.update({
        where: { id: formVersion.id },
        data: {
          status: 'PUBLISHED',
          publishedByOpenId: operator,
          publishedAt: new Date(),
        },
      });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "performance"."perf_form_template_versions" ENABLE TRIGGER USER',
      );
    }
    const configRoot = await prisma.perfConfigTemplate.create({
      data: { createdByOpenId: operator },
    });
    configRootId = configRoot.id;
    const source = await prisma.perfConfigTemplateVersion.create({
      data: {
        templateId: configRoot.id,
        version: 1,
        status: 'DRAFT',
        name: `Ticket16 config ${suffix}`,
        ratings,
        schedulePreset: { allowStageOverlap: true, stages: [] },
        notificationRules: { stages: [] },
        createdByOpenId: operator,
        updatedByOpenId: operator,
      },
    });
    await prisma.perfConfigFormBinding.create({
      data: {
        configVersionId: source.id,
        formTemplateVersionId: formVersion.id,
        jobLevelPrefix: 'D',
      },
    });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "performance"."perf_config_template_versions" DISABLE TRIGGER USER',
    );
    try {
      await prisma.perfConfigTemplateVersion.update({
        where: { id: source.id },
        data: {
          status: 'PUBLISHED',
          publishedByOpenId: operator,
          publishedAt: new Date(),
        },
      });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "performance"."perf_config_template_versions" ENABLE TRIGGER USER',
      );
    }

    const cycle = await prisma.perfCycle.create({
      data: {
        name: `Ticket16 integration ${suffix}`,
        ownerOpenId: operator,
        status: 'DRAFT',
      },
    });
    cycleId = cycle.id;
    const config = await prisma.perfCycleConfigVersion.create({
      data: {
        cycleId,
        version: 1,
        sourceConfigTemplateVersionId: source.id,
        ratings,
        orgOwnerWeight: '30',
        projectOwnerWeight: '30',
        peerWeight: '25',
        crossDeptWeight: '15',
        schedulePreset: { allowStageOverlap: true, stages: [] },
        notificationRules: { stages: [] },
        createdByOpenId: operator,
      },
    });
    const snapshot = await prisma.perfCycleFormSnapshot.create({
      data: {
        cycleConfigVersionId: config.id,
        cycleId,
        jobLevelPrefix: 'D',
        sourceFormTemplateVersionId: formVersion.id,
        content: formContent,
      },
    });
    await prisma.perfCycle.update({
      where: { id: cycleId },
      data: { currentConfigVersionId: config.id, status: 'ACTIVE' },
    });
    const participant = await prisma.perfParticipant.create({
      data: {
        cycleId,
        employeeOpenId: `ou_employee_${suffix}`,
        departmentIdSnapshot: 'od_allowed',
        jobLevelPrefixSnapshot: 'D',
        formSnapshotId: snapshot.id,
      },
    });
    participantId = participant.id;
    const submission = await prisma.perfEvaluationSubmission.create({
      data: {
        cycleId,
        participantId,
        stage: 'SELF',
        reviewerOpenId: participant.employeeOpenId,
        formSnapshotId: snapshot.id,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    const dimensionAnswer = await prisma.perfEvaluationDimensionAnswer.create({
      data: {
        submissionId: submission.id,
        formSnapshotId: snapshot.id,
        subformKey: 'subform:SELF',
        dimensionKey: 'dimension:self',
        scoringMethod: 'RATING',
        rawLevel: 'A',
        calculationScore: '85',
        derivedLevel: 'A',
      },
    });
    dimensionAnswerId = dimensionAnswer.id;
    const selfResult = await prisma.perfStageResult.create({
      data: {
        cycleId,
        participantId,
        cycleConfigVersionId: config.id,
        stage: 'SELF',
        status: 'READY',
        reviewerCount: 1,
        compositeScore: '85',
        initialLevel: 'A',
        stageLevel: 'A',
        constraintReasons: [],
        calculationDetail: {},
      },
    });
    await prisma.perfStageDimensionResult.create({
      data: {
        stageResultId: selfResult.id,
        dimensionKey: 'dimension:self',
        name: '自评',
        weight: '100',
        isCore: true,
        score: '85',
        level: 'A',
      },
    });
    await prisma.perfStageResult.create({
      data: {
        cycleId,
        participantId,
        cycleConfigVersionId: config.id,
        stage: 'MANAGER',
        status: 'NO_DATA',
        reviewerCount: 0,
        constraintReasons: [],
        calculationDetail: {},
      },
    });
    const calibration = await prisma.perfCalibration.create({
      data: {
        participantId,
        decision: 'KEEP',
        beforeLevel: 'B',
        afterLevel: 'B',
        inputRevision: 'a'.repeat(64),
        operatorOpenId: operator,
      },
    });
    calibrationId = calibration.id;
    const resultVersion = await prisma.perfResultVersion.create({
      data: {
        participantId,
        version: 1,
        finalLevel: 'B',
        sourceCalibrationId: calibration.id,
        resultSnapshot: {
          cycle: { id: cycleId },
          manager: {},
          self: {},
          promotion: null,
        },
        publishedByOpenId: operator,
        confirmedAt: new Date(),
        confirmedByOpenId: participant.employeeOpenId,
      },
    });
    resultVersionId = resultVersion.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    if (cycleId) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "performance"."perf_result_versions" DISABLE TRIGGER USER',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "performance"."perf_calibrations" DISABLE TRIGGER USER',
      );
      await prisma.perfResultVersion.deleteMany({ where: { participantId } });
      await prisma.perfCalibration.deleteMany({ where: { participantId } });
      await prisma.perfStageResult.deleteMany({ where: { cycleId } });
      await prisma.perfCycle.update({
        where: { id: cycleId },
        data: { status: 'DRAFT' },
      });
      await prisma.perfCycle.delete({ where: { id: cycleId } });
    }
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "performance"."perf_config_template_versions" DISABLE TRIGGER USER',
    );
    try {
      if (configRootId)
        await prisma.perfConfigTemplateVersion.deleteMany({
          where: { templateId: configRootId },
        });
      if (configRootId)
        await prisma.perfConfigTemplate.delete({
          where: { id: configRootId },
        });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "performance"."perf_config_template_versions" ENABLE TRIGGER USER',
      );
    }
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "performance"."perf_form_template_versions" DISABLE TRIGGER USER',
    );
    try {
      if (formRootId)
        await prisma.perfFormTemplateVersion.deleteMany({
          where: { templateId: formRootId },
        });
      if (formRootId)
        await prisma.perfFormTemplate.delete({ where: { id: formRootId } });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "performance"."perf_form_template_versions" ENABLE TRIGGER USER',
      );
    }
    await prisma.$disconnect();
    if (managedDatabase) {
      await adminPool!.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
        [managedDatabaseName],
      );
      await adminPool!.query(
        `DROP DATABASE IF EXISTS "${managedDatabaseName}"`,
      );
      await adminPool!.end();
    }
  });

  it('真实事务完成预览、并发复核、追加版本和重算', async () => {
    const peer = new PeerStageResultService(prisma, rbac as never);
    const manager = new ManagerStageResultService(prisma);
    const self = new EvaluationSubmissionService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const service = new ActiveCycleConfigChangeService(
      prisma,
      rbac as never,
      self,
      peer,
      manager,
    );
    const input = {
      expectedConfigVersionId: (
        await prisma.perfCycle.findUniqueOrThrow({ where: { id: cycleId } })
      ).currentConfigVersionId!,
      dimensionOverrides: [
        {
          jobLevelPrefix: 'D' as const,
          dimensionKey: 'dimension:manager',
          weight: '60',
          isCore: false,
        },
        {
          jobLevelPrefix: 'D' as const,
          dimensionKey: 'dimension:manager-growth',
          weight: '40',
          isCore: true,
        },
      ],
      ratings: ratings.map((rating) =>
        rating.symbol === 'A' ? { ...rating, mappingScore: '88' } : rating,
      ),
      reviewerRelationWeights: {
        ORG_OWNER: '30',
        PROJECT_OWNER: '30',
        PEER: '25',
        CROSS_DEPT: '15',
      },
    };

    rbac.isAdmin.mockResolvedValue(false);
    rbac.getOrgScope.mockResolvedValue(['od_other']);
    await expect(service.preview('ou_hr', cycleId, input)).rejects.toThrow(
      '授权范围',
    );
    rbac.isAdmin.mockResolvedValue(true);
    const stalePreview = await service.preview(operator, cycleId, input);
    await prisma.perfEvaluationDimensionAnswer.update({
      where: { id: dimensionAnswerId },
      data: { calculationScore: '84' },
    });
    const versionCountBefore = await prisma.perfCycleConfigVersion.count({
      where: { cycleId },
    });
    await expect(
      service.apply(operator, cycleId, {
        ...input,
        impactRevision: stalePreview.impactRevision,
        reason: '旧预览',
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ACTIVE_CONFIG_IMPACT_STALE',
      }),
    });
    expect(
      await prisma.perfCycleConfigVersion.count({ where: { cycleId } }),
    ).toBe(versionCountBefore);

    const preview = await service.preview(operator, cycleId, input);
    expect(
      preview.stageChanges.find((change) => change.stage === 'SELF'),
    ).toMatchObject({
      before: { compositeScore: '85', stageLevel: 'A' },
      after: { compositeScore: '88.00', stageLevel: 'A' },
      changed: true,
    });
    const beforeFailedApply = {
      currentConfigVersionId: (
        await prisma.perfCycle.findUniqueOrThrow({ where: { id: cycleId } })
      ).currentConfigVersionId,
      configVersionCount: await prisma.perfCycleConfigVersion.count({
        where: { cycleId },
      }),
      participantSnapshotId: (
        await prisma.perfParticipant.findUniqueOrThrow({
          where: { id: participantId },
        })
      ).formSnapshotId,
      submissionSnapshotId: (
        await prisma.perfEvaluationSubmission.findFirstOrThrow({
          where: { participantId, stage: 'SELF', status: 'SUBMITTED' },
        })
      ).formSnapshotId,
      calculationScore: (
        await prisma.perfEvaluationDimensionAnswer.findUniqueOrThrow({
          where: { id: dimensionAnswerId },
        })
      ).calculationScore?.toString(),
      auditCount: await prisma.auditLog.count({
        where: {
          action: 'cycle.active_config.recalculate',
          targetId: String(cycleId),
        },
      }),
    };
    const failingService = new ActiveCycleConfigChangeService(
      prisma,
      rbac as never,
      {
        recalculateSelf: jest
          .fn()
          .mockRejectedValue(new Error('真实事务中的自评重算失败')),
      } as never,
      peer,
      manager,
    );
    await expect(
      failingService.apply(operator, cycleId, {
        ...input,
        impactRevision: preview.impactRevision,
        reason: '验证失败回滚',
        confirmed: true,
      }),
    ).rejects.toThrow('真实事务中的自评重算失败');
    expect(
      (await prisma.perfCycle.findUniqueOrThrow({ where: { id: cycleId } }))
        .currentConfigVersionId,
    ).toBe(beforeFailedApply.currentConfigVersionId);
    expect(
      await prisma.perfCycleConfigVersion.count({ where: { cycleId } }),
    ).toBe(beforeFailedApply.configVersionCount);
    expect(
      (
        await prisma.perfParticipant.findUniqueOrThrow({
          where: { id: participantId },
        })
      ).formSnapshotId,
    ).toBe(beforeFailedApply.participantSnapshotId);
    expect(
      (
        await prisma.perfEvaluationSubmission.findFirstOrThrow({
          where: { participantId, stage: 'SELF', status: 'SUBMITTED' },
        })
      ).formSnapshotId,
    ).toBe(beforeFailedApply.submissionSnapshotId);
    expect(
      (
        await prisma.perfEvaluationDimensionAnswer.findUniqueOrThrow({
          where: { id: dimensionAnswerId },
        })
      ).calculationScore?.toString(),
    ).toBe(beforeFailedApply.calculationScore);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'cycle.active_config.recalculate',
          targetId: String(cycleId),
        },
      }),
    ).toBe(beforeFailedApply.auditCount);
    const protectedCalibrationBefore =
      await prisma.perfCalibration.findUniqueOrThrow({
        where: { id: calibrationId },
      });
    const protectedResultBefore =
      await prisma.perfResultVersion.findUniqueOrThrow({
        where: { id: resultVersionId },
      });
    await service.apply(operator, cycleId, {
      ...input,
      impactRevision: preview.impactRevision,
      reason: '修正映射分',
      confirmed: true,
    });
    expect(
      await prisma.perfCycleConfigVersion.count({ where: { cycleId } }),
    ).toBe(2);
    expect(
      (
        await prisma.perfEvaluationDimensionAnswer.findUniqueOrThrow({
          where: { id: dimensionAnswerId },
        })
      ).calculationScore!.toString(),
    ).toBe('88');
    expect(
      await prisma.perfStageResult.count({
        where: { participantId, stage: 'MANAGER' },
      }),
    ).toBe(2);
    const selfResults = await prisma.perfStageResult.findMany({
      where: { participantId, stage: 'SELF' },
      orderBy: { cycleConfigVersionId: 'asc' },
      include: { dimensions: true },
    });
    expect(selfResults).toHaveLength(2);
    expect(
      selfResults.map((result) => result.compositeScore?.toString()),
    ).toEqual(['85', '88']);
    expect(selfResults[1].dimensions[0]).toMatchObject({
      dimensionKey: 'dimension:self',
      level: 'A',
    });
    const current = await prisma.perfCycle.findUniqueOrThrow({
      where: { id: cycleId },
      include: { currentConfigVersion: { include: { formSnapshots: true } } },
    });
    const currentContent = current.currentConfigVersion!.formSnapshots[0]
      .content as {
      subforms: Array<{
        type: string;
        dimensions: Array<{ key: string; weight: string; isCore: boolean }>;
      }>;
    };
    expect(
      currentContent.subforms.find((item) => item.type === 'MANAGER')!
        .dimensions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'dimension:manager',
          weight: '60',
          isCore: false,
        }),
        expect.objectContaining({
          key: 'dimension:manager-growth',
          weight: '40',
          isCore: true,
        }),
      ]),
    );
    expect(
      await prisma.perfCalibration.findUniqueOrThrow({
        where: { id: calibrationId },
      }),
    ).toEqual(protectedCalibrationBefore);
    expect(
      await prisma.perfResultVersion.findUniqueOrThrow({
        where: { id: resultVersionId },
      }),
    ).toEqual(protectedResultBefore);
  });
});
