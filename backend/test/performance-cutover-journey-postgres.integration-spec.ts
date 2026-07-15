import { execFileSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { AiReportService } from '../src/ai-report/ai-report.service';
import { AuditService } from '../src/audit/audit.service';
import { CalibrationDecisionService } from '../src/calibration/calibration-decision.service';
import { ResultService } from '../src/calibration/result.service';
import { buildDefaultConfigTemplate } from '../src/config-template/default-config-template';
import { ConfigTemplateService } from '../src/config-template/config-template.service';
import { ActiveCycleRollbackService } from '../src/cycle/active-cycle-rollback.service';
import { CycleActivationService } from '../src/cycle/cycle-activation.service';
import { CycleArchiveService } from '../src/cycle/cycle-archive.service';
import { CycleSetupService } from '../src/cycle/cycle-setup.service';
import { EvaluationTaskAccessService } from '../src/cycle/evaluation-task-access.service';
import { EvaluationSubmissionService } from '../src/evaluation/evaluation-submission.service';
import { ManagerEvaluationSubmissionService } from '../src/evaluation/manager-evaluation-submission.service';
import { ManagerStageResultService } from '../src/evaluation/manager-stage-result.service';
import { PeerEvaluationSubmissionService } from '../src/evaluation/peer-evaluation-submission.service';
import { PeerStageResultService } from '../src/evaluation/peer-stage-result.service';
import { DEFAULT_FORM_TEMPLATES } from '../src/form-template/default-form-templates';
import { FormTemplateService } from '../src/form-template/form-template.service';
import {
  PerfCalibrationDecision,
  PerfCycleStatus,
  PerfRole,
} from '../src/generated/prisma/enums';
import { NotificationEventService } from '../src/notification/notification-event.service';
import { ParticipantEvaluationLockService } from '../src/participant/participant-evaluation-lock.service';
import { ParticipantNoResultService } from '../src/participant/participant-no-result.service';
import { RbacService } from '../src/rbac/rbac.service';
import { PrismaService } from '../src/shared/database/prisma.service';
import { REDIS_CLIENT } from '../src/shared/redis/redis.constants';
import { loadAppConfig } from '../src/config/configuration';

type Prefix = 'D' | 'M';
type SnapshotContent = {
  subforms: Array<{
    key: string;
    type: 'SELF' | 'PEER' | 'MANAGER' | 'PROMOTION';
    dimensions: Array<{
      key: string;
      items: Array<{
        key: string;
        type: string;
        required: boolean;
        config?: { options?: Array<{ value: string }> };
      }>;
    }>;
  }>;
};

/**
 * Ticket 21 最终旅程使用临时 PostgreSQL 数据库执行全部真实 migration，并通过
 * Nest TestingModule 装配生产 service；不存在自建玩具表或直接伪造状态迁移。
 */
describe('Ticket 21 PostgreSQL + Nest 最终模型旅程', () => {
  jest.setTimeout(120_000);

  const baseUrl = loadAppConfig().database.url;
  const databaseName = `ticket21_${process.pid}_${Date.now()}`;
  const tempUrlObject = new URL(baseUrl);
  tempUrlObject.pathname = `/${databaseName}`;
  tempUrlObject.searchParams.delete('schema');
  const tempUrl = tempUrlObject.toString();
  const adminPool = new Pool({ connectionString: baseUrl });
  const operator = `ticket21_admin_${process.pid}`;
  const scopedHr = `ticket21_hr_${process.pid}`;

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let formTemplateService: FormTemplateService;
  let configTemplateService: ConfigTemplateService;
  let cycleSetupService: CycleSetupService;
  let cycleActivationService: CycleActivationService;
  let selfService: EvaluationSubmissionService;
  let peerService: PeerEvaluationSubmissionService;
  let managerService: ManagerEvaluationSubmissionService;
  let calibrationService: CalibrationDecisionService;
  let resultService: ResultService;
  let rollbackService: ActiveCycleRollbackService;
  let archiveService: CycleArchiveService;
  let configVersionId: number;

  beforeAll(async () => {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: tempUrl },
      stdio: 'pipe',
    });

    prisma = new PrismaService({
      getOrThrow: () => tempUrl,
    } as unknown as ConfigService);
    await prisma.$connect();

    moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: {} },
        {
          provide: AiReportService,
          // AI 是非阻塞参考；旅程明确不创建/等待 AI 报告。
          useValue: { refreshForParticipant: jest.fn() },
        },
        AuditService,
        RbacService,
        NotificationEventService,
        FormTemplateService,
        ConfigTemplateService,
        CycleSetupService,
        CycleActivationService,
        EvaluationTaskAccessService,
        ParticipantEvaluationLockService,
        EvaluationSubmissionService,
        PeerStageResultService,
        PeerEvaluationSubmissionService,
        ManagerStageResultService,
        ManagerEvaluationSubmissionService,
        ParticipantNoResultService,
        CalibrationDecisionService,
        ResultService,
        ActiveCycleRollbackService,
        CycleArchiveService,
      ],
    }).compile();

    formTemplateService = moduleRef.get(FormTemplateService);
    configTemplateService = moduleRef.get(ConfigTemplateService);
    cycleSetupService = moduleRef.get(CycleSetupService);
    cycleActivationService = moduleRef.get(CycleActivationService);
    selfService = moduleRef.get(EvaluationSubmissionService);
    peerService = moduleRef.get(PeerEvaluationSubmissionService);
    managerService = moduleRef.get(ManagerEvaluationSubmissionService);
    calibrationService = moduleRef.get(CalibrationDecisionService);
    resultService = moduleRef.get(ResultService);
    rollbackService = moduleRef.get(ActiveCycleRollbackService);
    archiveService = moduleRef.get(CycleArchiveService);

    await prisma.roleGrant.createMany({
      data: [
        { userOpenId: operator, role: PerfRole.ADMIN },
        {
          userOpenId: scopedHr,
          role: PerfRole.HR,
          orgScope: ['od_outside'],
        },
      ],
    });
    configVersionId = await publishDAndMTemplates();
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    if (prisma) await prisma.$disconnect();
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
      [databaseName],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminPool.end();
  });

  async function publishDAndMTemplates() {
    const publishedFormIds: number[] = [];
    for (const template of DEFAULT_FORM_TEMPLATES) {
      const draft = await formTemplateService.createFormTemplate(operator, {
        name: `Ticket21 ${template.jobLevelPrefix} 表单`,
        jobLevelPrefix: template.jobLevelPrefix,
      });
      await formTemplateService.replaceDraftContent(
        operator,
        draft.id,
        structuredClone(template) as never,
      );
      const published = await formTemplateService.publishVersion(
        operator,
        draft.id,
      );
      expect(published.status).toBe('PUBLISHED');
      publishedFormIds.push(published.id);
    }

    const draft = await configTemplateService.createConfigTemplate(operator, {
      name: 'Ticket21 最终配置',
    });
    const defaults = buildDefaultConfigTemplate();
    await configTemplateService.replaceDraftContent(operator, draft.id, {
      name: defaults.name,
      description: defaults.description,
      stageModes: defaults.stageModes,
      ratings: defaults.ratings,
      constraintProfiles: defaults.constraintProfiles,
      reviewerRelationWeights: defaults.reviewerRelationWeights,
      schedulePreset: {
        ...defaults.schedulePreset,
        stages: defaults.schedulePreset.stages.map((stage) => ({
          ...stage,
          reminderDeadlineOffsetMinutes: 60,
        })),
      },
      notificationRules: defaults.notificationRules,
      formTemplateVersionIds: publishedFormIds,
    });
    const validation = await configTemplateService.validateVersion(
      operator,
      draft.id,
    );
    expect(validation.issues).toEqual([]);
    const published = await configTemplateService.publishVersion(
      operator,
      draft.id,
    );
    expect(published.status).toBe('PUBLISHED');
    return published.id;
  }

  function answersFor(
    content: SnapshotContent,
    stage: 'SELF' | 'PEER' | 'MANAGER',
  ) {
    return content.subforms
      .filter((subform) => subform.type === stage)
      .flatMap((subform) =>
        subform.dimensions.flatMap((dimension) =>
          dimension.items
            .filter((item) => item.required)
            .map((item) => {
              const identity = {
                subformKey: subform.key,
                dimensionKey: dimension.key,
                itemKey: item.key,
              };
              if (item.type === 'RATING') {
                return { ...identity, rawLevel: 'A' as const };
              }
              if (item.type === 'SCORE') return { ...identity, rawScore: 85 };
              if (item.type === 'SINGLE_SELECT') {
                return {
                  ...identity,
                  value: item.config?.options?.[0]?.value ?? 'NOT_APPLICABLE',
                };
              }
              return { ...identity, value: 'Ticket 21 真实旅程有效作答' };
            }),
        ),
      );
  }

  async function createAndCompleteJourney(prefix: Prefix, archive: boolean) {
    const suffix = `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const employeeOpenId = `ticket21_employee_${suffix}`;
    const leaderOpenId = `ticket21_leader_${suffix}`;
    const reviewerOpenId = `ticket21_reviewer_${suffix}`;
    const plannedStartAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    const created = await cycleSetupService.createFromPublishedConfig(
      operator,
      {
        name: `Ticket21 ${prefix} 旅程 ${suffix}`,
        configTemplateVersionId: configVersionId,
        plannedStartAt: plannedStartAt.toISOString(),
      },
    );
    const cycleId = created.id;
    const snapshot = created.currentConfigVersion!.formSnapshots.find(
      (item) => item.jobLevelPrefix === prefix,
    )!;

    await prisma.larkUser.createMany({
      data: [
        {
          open_id: employeeOpenId,
          name: `员工 ${prefix}`,
          leader_user_id: leaderOpenId,
          department_ids: ['od_target'],
        },
        { open_id: leaderOpenId, name: `Leader ${prefix}` },
        { open_id: reviewerOpenId, name: `Reviewer ${prefix}` },
      ],
    });
    await prisma.larkCorehrEmployee.create({
      data: {
        open_id: employeeOpenId,
        direct_manager_id: leaderOpenId,
        department_id: 'od_target',
        job_level: { code: `${prefix}6`, name: `${prefix} 序列` },
      },
    });
    const participant = await prisma.perfParticipant.create({
      data: {
        cycleId,
        employeeOpenId,
        leaderOpenIdSnapshot: leaderOpenId,
        departmentIdSnapshot: 'od_target',
        jobLevelSnapshot: { code: `${prefix}6` },
        jobLevelPrefixSnapshot: prefix,
        formSnapshotId: snapshot.id,
      },
    });
    const assignment = await prisma.perfReviewerAssignment.create({
      data: {
        cycleId,
        participantId: participant.id,
        reviewerOpenId,
        relation: 'PEER',
        source: 'HR_ASSIGNED',
      },
    });

    await cycleSetupService.schedule(operator, cycleId);
    await expect(
      cycleActivationService.activateCycle(cycleId, new Date()),
    ).resolves.toMatchObject({ status: 'ACTIVATED', changed: true });

    const tasks = await prisma.perfEvaluationTask.findMany({
      where: { participantId: participant.id },
    });
    expect(tasks).toHaveLength(4);
    expect(
      tasks
        .filter((task) => task.type !== 'AI')
        .every(
          (task) =>
            task.openedAt !== null &&
            task.reminderDeadlineAt !== null &&
            task.reminderDeadlineAt.getTime() < Date.now(),
        ),
    ).toBe(true);

    const content = snapshot.content as unknown as SnapshotContent;
    await selfService.submitSelf(employeeOpenId, {
      cycleId,
      items: answersFor(content, 'SELF'),
    });
    await peerService.submitPeer(reviewerOpenId, {
      assignmentId: assignment.id,
      items: answersFor(content, 'PEER'),
    });
    await managerService.submitManager(leaderOpenId, {
      participantId: participant.id,
      items: answersFor(content, 'MANAGER'),
    });

    // 真实对象级权限：组织范围不覆盖的 HR 不能校准，当前 Leader 可以。
    await expect(
      calibrationService.getContext(scopedHr, participant.id),
    ).rejects.toThrow('授权组织范围');
    const context = await calibrationService.getContext(
      leaderOpenId,
      participant.id,
    );
    await calibrationService.decide(leaderOpenId, participant.id, {
      decision: PerfCalibrationDecision.KEEP,
      expectedCalibrationRevision: context.calibrationRevision,
      expectedInputRevision: context.inputRevision,
    });
    await resultService.publishCycle(operator, cycleId, [participant.id]);

    const current = await resultService.getCurrent(employeeOpenId, cycleId);
    expect(current.result).toMatchObject({ version: 1, finalLevel: 'A' });
    expect(JSON.stringify(current)).not.toMatch(
      /reviewerOpenId|relationAggregates|aiReport|promotionSummary/,
    );
    await resultService.confirm(
      employeeOpenId,
      participant.id,
      current.result!.id,
    );

    expect(
      await prisma.perfNotificationEvent.count({
        where: {
          cycleId,
          type: 'RESULT_PUBLISHED',
          receiverOpenId: employeeOpenId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.perfAiReport.count({
        where: { participantId: participant.id },
      }),
    ).toBe(0);

    if (archive) {
      const preview = await archiveService.preview(operator, cycleId);
      expect(preview.canArchive).toBe(true);
      await archiveService.archive(operator, cycleId, {
        confirmed: true,
        expectedRevision: preview.revision,
      });
      await expect(
        calibrationService.getContext(leaderOpenId, participant.id),
      ).resolves.toBeDefined();
      expect(
        (await prisma.perfCycle.findUniqueOrThrow({ where: { id: cycleId } }))
          .status,
      ).toBe(PerfCycleStatus.ARCHIVED);
    }
    return {
      cycleId,
      participant,
      employeeOpenId,
      leaderOpenId,
      reviewerOpenId,
      assignment,
      content,
    };
  }

  it.each([{ prefix: 'D' as const }, { prefix: 'M' as const }])(
    '$prefix 职级通过真实服务完成模板发布、启动、三类评估、校准、发布、确认和归档',
    async ({ prefix }) => {
      await createAndCompleteJourney(prefix, true);
    },
  );

  it('已确认员工通过真实退回服务完成失效通知、解锁、重提、新版本、再次确认和归档', async () => {
    const journey = await createAndCompleteJourney('D', false);
    await expect(
      rollbackService.preview(journey.leaderOpenId, journey.cycleId, 'DRAFT'),
    ).rejects.toThrow('只有超级管理员');
    const preview = await rollbackService.preview(
      operator,
      journey.cycleId,
      PerfCycleStatus.DRAFT,
    );
    await rollbackService.rollback(operator, journey.cycleId, {
      targetStatus: PerfCycleStatus.DRAFT,
      reason: 'Ticket 21 验证已确认结果退回闭环',
      confirmed: true,
      impactRevision: preview.impactRevision,
    });

    const rolledBack = await prisma.perfParticipant.findUniqueOrThrow({
      where: { id: journey.participant.id },
    });
    expect(rolledBack).toMatchObject({
      status: 'ACTIVE',
      evaluationLockedAt: null,
    });
    expect(
      await prisma.perfResultVersion.count({
        where: {
          participantId: journey.participant.id,
          invalidatedAt: { not: null },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.perfNotificationEvent.count({
        where: { cycleId: journey.cycleId, type: 'RESULT_INVALIDATED' },
      }),
    ).toBe(1);

    // 模拟管理员完成 DRAFT 调整并重新启动；随后所有人工阶段走真实重新提交服务。
    await prisma.perfCycle.update({
      where: { id: journey.cycleId },
      data: { status: PerfCycleStatus.ACTIVE },
    });
    await selfService.submitSelf(journey.employeeOpenId, {
      cycleId: journey.cycleId,
      items: answersFor(journey.content, 'SELF'),
    });
    await peerService.submitPeer(journey.reviewerOpenId, {
      assignmentId: journey.assignment.id,
      items: answersFor(journey.content, 'PEER'),
    });
    await managerService.submitManager(journey.leaderOpenId, {
      participantId: journey.participant.id,
      items: answersFor(journey.content, 'MANAGER'),
    });
    const context = await calibrationService.getContext(
      journey.leaderOpenId,
      journey.participant.id,
    );
    await calibrationService.decide(
      journey.leaderOpenId,
      journey.participant.id,
      {
        decision: PerfCalibrationDecision.KEEP,
        expectedCalibrationRevision: context.calibrationRevision,
        expectedInputRevision: context.inputRevision,
      },
    );
    await resultService.publishCycle(operator, journey.cycleId, [
      journey.participant.id,
    ]);
    const republished = await resultService.getCurrent(
      journey.employeeOpenId,
      journey.cycleId,
    );
    expect(republished.result).toMatchObject({ version: 2, finalLevel: 'A' });
    await resultService.confirm(
      journey.employeeOpenId,
      journey.participant.id,
      republished.result!.id,
    );
    const archivePreview = await archiveService.preview(
      operator,
      journey.cycleId,
    );
    await archiveService.archive(operator, journey.cycleId, {
      confirmed: true,
      expectedRevision: archivePreview.revision,
    });

    expect(
      await prisma.perfResultVersion.count({
        where: { participantId: journey.participant.id },
      }),
    ).toBe(2);
    expect(
      (
        await prisma.perfCycle.findUniqueOrThrow({
          where: { id: journey.cycleId },
        })
      ).status,
    ).toBe(PerfCycleStatus.ARCHIVED);
  });
});
