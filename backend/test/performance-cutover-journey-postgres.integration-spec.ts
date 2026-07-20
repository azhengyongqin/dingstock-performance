import { execFileSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { AiReportService } from '../src/ai-report/ai-report.service';
import { AuditService } from '../src/audit/audit.service';
import { buildDefaultConfigTemplate } from '../src/config-template/default-config-template';
import { ConfigTemplateService } from '../src/config-template/config-template.service';
import { loadAppConfig } from '../src/config/configuration';
import { CycleActivationService } from '../src/cycle/cycle-activation.service';
import { CycleSetupService } from '../src/cycle/cycle-setup.service';
import { EvaluationTaskAccessService } from '../src/cycle/evaluation-task-access.service';
import { EvaluationEmployeeProfileService } from '../src/evaluation/evaluation-employee-profile.service';
import { EvaluationSubmissionService } from '../src/evaluation/evaluation-submission.service';
import { ManagerEvaluationSubmissionService } from '../src/evaluation/manager-evaluation-submission.service';
import { ManagerStageResultService } from '../src/evaluation/manager-stage-result.service';
import { PeerEvaluationSubmissionService } from '../src/evaluation/peer-evaluation-submission.service';
import { PeerStageResultService } from '../src/evaluation/peer-stage-result.service';
import type { FormSnapshotContent } from '../src/evaluation/evaluation.service-types';
import { DEFAULT_FORM_TEMPLATES } from '../src/form-template/default-form-templates';
import { FormTemplateService } from '../src/form-template/form-template.service';
import { PerfRole } from '../src/generated/prisma/enums';
import { NotificationEventService } from '../src/notification/notification-event.service';
import { ParticipantEvaluationLockService } from '../src/participant/participant-evaluation-lock.service';
import { RbacService } from '../src/rbac/rbac.service';
import { PrismaService } from '../src/shared/database/prisma.service';
import { REDIS_CLIENT } from '../src/shared/redis/redis.constants';

/**
 * 最高层真实旅程：在临时 PostgreSQL 数据库建立当前 schema，并只通过公开业务服务完成
 * “发布模板 → 周期快照 → 三类提交 → 阶段结果”。测试不依赖 dedicated env，也不允许 skip。
 */
describe('新版评估维度 PostgreSQL + Nest 真实业务旅程', () => {
  jest.setTimeout(120_000);

  const baseUrl = loadAppConfig().database.url;
  const databaseName = `dimension_journey_${process.pid}_${Date.now()}`;
  const tempUrlObject = new URL(baseUrl);
  tempUrlObject.pathname = `/${databaseName}`;
  tempUrlObject.searchParams.delete('schema');
  const tempUrl = tempUrlObject.toString();
  const adminPool = new Pool({ connectionString: baseUrl });
  const operator = `dimension_admin_${process.pid}`;

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let formTemplateService: FormTemplateService;
  let configTemplateService: ConfigTemplateService;
  let cycleSetupService: CycleSetupService;
  let cycleActivationService: CycleActivationService;
  let selfService: EvaluationSubmissionService;
  let peerService: PeerEvaluationSubmissionService;
  let managerService: ManagerEvaluationSubmissionService;
  let publishedConfigVersionId: number;

  beforeAll(async () => {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    // 真实旅程必须从空库部署完整迁移链；db push 会绕过历史顺序问题。
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
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: REDIS_CLIENT, useValue: {} },
        {
          provide: AiReportService,
          // AI 是非阻塞消费者，本旅程只验证三类人工阶段的真实传递。
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
        EvaluationEmployeeProfileService,
        EvaluationSubmissionService,
        PeerStageResultService,
        PeerEvaluationSubmissionService,
        ManagerStageResultService,
        ManagerEvaluationSubmissionService,
      ],
    }).compile();
    formTemplateService = moduleRef.get(FormTemplateService);
    configTemplateService = moduleRef.get(ConfigTemplateService);
    cycleSetupService = moduleRef.get(CycleSetupService);
    cycleActivationService = moduleRef.get(CycleActivationService);
    selfService = moduleRef.get(EvaluationSubmissionService);
    peerService = moduleRef.get(PeerEvaluationSubmissionService);
    managerService = moduleRef.get(ManagerEvaluationSubmissionService);

    await prisma.roleGrant.create({
      data: { userOpenId: operator, role: PerfRole.ADMIN },
    });
    publishedConfigVersionId = await publishTemplatesAndConfig();
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
    if (prisma) await prisma.$disconnect();
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
      [databaseName],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminPool.end();
  });

  async function publishTemplatesAndConfig(): Promise<number> {
    const formVersionIds: number[] = [];
    for (const source of DEFAULT_FORM_TEMPLATES) {
      const input = structuredClone(source);
      if (input.jobLevelPrefix === 'D') {
        const manager = input.subforms.find(
          (subform) => subform.type === 'MANAGER',
        )!;
        // 同一 MANAGER 子表单混用评级和分数，是本次重构最关键的跨模块契约。
        manager.dimensions[0].scoringMethod = 'RATING';
      }
      // 新建草稿的业务 key 只能由服务端生成，避免客户端伪造稳定标识。
      for (const subform of input.subforms) {
        for (const dimension of subform.dimensions) {
          delete (dimension as { key?: string }).key;
          for (const field of dimension.fields) {
            delete (field as { key?: string }).key;
          }
        }
      }
      const draft = await formTemplateService.createFormTemplate(operator, {
        name: `旅程 ${input.jobLevelPrefix} 表单`,
        jobLevelPrefix: input.jobLevelPrefix,
      });
      await formTemplateService.replaceDraftContent(operator, draft.id, {
        name: `旅程 ${input.jobLevelPrefix} 表单`,
        description: input.description,
        jobLevelPrefix: input.jobLevelPrefix,
        subforms: input.subforms,
      } as never);
      const published = await formTemplateService.publishVersion(
        operator,
        draft.id,
      );
      expect(published.status).toBe('PUBLISHED');
      formVersionIds.push(published.id);
    }

    const draft = await configTemplateService.createConfigTemplate(operator, {
      name: '维度旅程配置',
    });
    const draftId: unknown = draft.id;
    if (typeof draftId !== 'number') {
      throw new Error('配置模板草稿未返回数值 ID');
    }
    const defaults = buildDefaultConfigTemplate();
    await configTemplateService.replaceDraftContent(operator, draftId, {
      name: '维度旅程配置',
      description: defaults.description,
      ratings: defaults.ratings,
      reviewerRelationWeights: defaults.reviewerRelationWeights,
      schedulePreset: {
        allowStageOverlap: true,
        stages: defaults.schedulePreset.stages.map((stage) => ({
          ...stage,
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 60,
        })),
      },
      notificationRules: defaults.notificationRules,
      formTemplateVersionIds: formVersionIds,
    });
    const validation = await configTemplateService.validateVersion(
      operator,
      draftId,
    );
    expect(validation.issues).toEqual([]);
    await configTemplateService.publishVersion(operator, draftId);
    return draftId;
  }

  function dimensionsFor(
    content: FormSnapshotContent,
    stage: 'SELF' | 'PEER' | 'MANAGER',
  ) {
    return content.subforms
      .filter((subform) => subform.type === stage)
      .flatMap((subform) =>
        subform.dimensions.map((dimension) => {
          const raw =
            dimension.type === 'SCORING'
              ? dimension.scoringMethod === 'RATING'
                ? { rawLevel: 'A' as const }
                : { rawScore: 90 }
              : {};
          const fields = (dimension.fields ?? []).flatMap((field) => {
            // 同时填写条件必填字段，覆盖分数映射到 S/C 后的完整性校验。
            if (field.requiredRule === 'OPTIONAL') return [];
            const value =
              field.type === 'SINGLE_SELECT'
                ? ((field.config as { options?: Array<{ value: string }> })
                    ?.options?.[0]?.value ?? 'OPTION_1')
                : field.type === 'MULTI_SELECT'
                  ? [
                      (
                        field.config as {
                          options?: Array<{ value: string }>;
                        }
                      )?.options?.[0]?.value ?? 'OPTION_1',
                    ]
                  : field.type === 'ATTACHMENT'
                    ? [
                        {
                          name: 'evidence.pdf',
                          url: 'https://files.example/evidence',
                        },
                      ]
                    : field.type === 'LINK'
                      ? 'https://example.com/evidence'
                      : '真实旅程必填字段内容';
            return [{ fieldKey: field.key, value }];
          });
          return {
            subformKey: subform.key,
            dimensionKey: dimension.key,
            ...raw,
            fields,
          };
        }),
      );
  }

  it('混合 RATING/SCORE 经发布、快照与三类提交真实生成统一阶段结果', async () => {
    const suffix = `${process.pid}_${Date.now()}`;
    const employeeOpenId = `journey_employee_${suffix}`;
    const leaderOpenId = `journey_leader_${suffix}`;
    const reviewerOpenId = `journey_reviewer_${suffix}`;
    const plannedStartAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    const cycle = await cycleSetupService.createFromPublishedConfig(operator, {
      name: `维度切换真实旅程 ${suffix}`,
      configTemplateVersionId: publishedConfigVersionId,
      plannedStartAt: plannedStartAt.toISOString(),
    });
    const snapshot = cycle.currentConfigVersion!.formSnapshots.find(
      (candidate) => candidate.jobLevelPrefix === 'D',
    )!;
    const content = snapshot.content as unknown as FormSnapshotContent;
    const managerDimensions = content.subforms.find(
      (subform) => subform.type === 'MANAGER',
    )!.dimensions;
    expect(
      managerDimensions.map((dimension) => dimension.scoringMethod),
    ).toEqual(['RATING', 'SCORE', 'SCORE']);

    await prisma.larkUser.createMany({
      data: [
        {
          open_id: employeeOpenId,
          name: '旅程员工',
          leader_user_id: leaderOpenId,
          department_ids: ['od_journey'],
        },
        { open_id: leaderOpenId, name: '旅程 Leader' },
        { open_id: reviewerOpenId, name: '旅程 Reviewer' },
      ],
    });
    await prisma.larkCorehrEmployee.create({
      data: {
        open_id: employeeOpenId,
        direct_manager_id: leaderOpenId,
        department_id: 'od_journey',
        job_level: {
          code: 'D6',
          name: [{ lang: 'zh-CN', value: 'D6' }],
        },
      },
    });
    const participant = await prisma.perfParticipant.create({
      data: {
        cycleId: cycle.id,
        employeeOpenId,
        leaderOpenIdSnapshot: leaderOpenId,
        departmentIdSnapshot: 'od_journey',
        jobLevelSnapshot: { code: 'D6' },
        jobLevelPrefixSnapshot: 'D',
        formSnapshotId: snapshot.id,
      },
    });
    const assignment = await prisma.perfReviewerAssignment.create({
      data: {
        cycleId: cycle.id,
        participantId: participant.id,
        reviewerOpenId,
        relation: 'PEER',
        source: 'HR_ASSIGNED',
      },
    });

    await cycleSetupService.schedule(operator, cycle.id);
    const activation = await cycleActivationService.activateCycle(
      cycle.id,
      new Date(),
    );
    if (activation.status !== 'ACTIVATED') {
      throw new Error(`周期启动失败：${JSON.stringify(activation)}`);
    }
    expect(activation.changed).toBe(true);
    await selfService.submitSelf(employeeOpenId, {
      cycleId: cycle.id,
      dimensions: dimensionsFor(content, 'SELF'),
    });
    await peerService.submitPeer(reviewerOpenId, {
      assignmentId: assignment.id,
      dimensions: dimensionsFor(content, 'PEER'),
    });
    await managerService.submitManager(leaderOpenId, {
      participantId: participant.id,
      dimensions: dimensionsFor(content, 'MANAGER'),
    });

    const currentConfigVersionId = (
      await prisma.perfCycle.findUniqueOrThrow({ where: { id: cycle.id } })
    ).currentConfigVersionId!;
    const results = await prisma.perfStageResult.findMany({
      where: {
        participantId: participant.id,
        cycleConfigVersionId: currentConfigVersionId,
      },
      orderBy: { stage: 'asc' },
      include: { dimensions: { orderBy: { dimensionKey: 'asc' } } },
    });
    expect(results.map((result) => result.stage)).toEqual([
      'SELF',
      'PEER',
      'MANAGER',
    ]);
    expect(results.find((result) => result.stage === 'SELF')).toMatchObject({
      status: 'READY',
      stageLevel: 'A',
    });
    expect(results.find((result) => result.stage === 'PEER')).toMatchObject({
      status: 'READY',
      stageLevel: 'A',
    });
    const manager = results.find((result) => result.stage === 'MANAGER')!;
    expect(manager).toMatchObject({
      status: 'READY',
      stageLevel: 'A',
    });
    expect(Number(manager.compositeScore)).toBe(86.5);
    expect(
      manager.dimensions.map((dimension) => dimension.score.toString()),
    ).toEqual(expect.arrayContaining(['85', '90']));
    expect(
      await prisma.perfEvaluationDimensionAnswer.count({
        where: {
          submission: { participantId: participant.id },
          calculationScore: { not: null },
          derivedLevel: { not: null },
        },
      }),
    ).toBeGreaterThan(0);
  });
});
