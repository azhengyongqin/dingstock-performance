import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PerfCycleStatus, PerfRole } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { RbacService } from '../rbac/rbac.service';

const CLOSED_STATUSES = new Set(['CONFIRMED', 'NO_RESULT', 'WITHDRAWN']);

export type CycleArchiveBlocker = {
  participantId: number;
  employeeOpenId: string;
  code: string;
  message: string;
};

export type CycleArchiveSummary = {
  participantCount: number;
  confirmedCount: number;
  noResultCount: number;
  withdrawnCount: number;
  levelDistribution: Record<string, number>;
};

type ArchiveParticipant = {
  id: number;
  employeeOpenId: string;
  departmentIdSnapshot: string | null;
  status: string;
  evaluationSubmissions: Array<{ stage: string; status: string }>;
  calibrations: Array<{ id: number }>;
  resultVersions: Array<{
    id: number;
    finalLevel: string;
    confirmedAt: Date | null;
  }>;
  appeals: Array<{ id: number; status: string }>;
};

export type CycleArchivePreview = {
  cycleId: number;
  canArchive: boolean;
  summary: CycleArchiveSummary;
  blockers: CycleArchiveBlocker[];
  revision: string;
};

/**
 * 周期归档边界：预览与执行复用同一套全量检查，避免前端与写事务产生规则漂移。
 */
@Injectable()
export class CycleArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

  async preview(operatorOpenId: string, cycleId: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id: cycleId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    if (cycle.status !== PerfCycleStatus.ACTIVE) {
      throw new ConflictException('只有进行中的周期可以归档');
    }
    const participants = await this.loadParticipants(this.prisma, cycleId);
    await this.assertCycleCoverage(operatorOpenId, participants);
    return this.buildPreview(cycleId, participants);
  }

  async archive(
    operatorOpenId: string,
    cycleId: number,
    input: { confirmed: boolean; expectedRevision: string },
  ) {
    if (!input.confirmed) {
      throw new ConflictException('归档是永久操作，请先明确确认归档摘要');
    }
    return this.prisma.$transaction(
      async (tx) => {
        // 周期行锁把归档、退回及其它状态转换串行化；事务内必须重算，不能信任旧预览。
        await tx.$queryRaw`SELECT "id" FROM "performance"."perf_cycles" WHERE "id" = ${cycleId} AND "deleted_at" IS NULL FOR UPDATE`;
        const cycle = await tx.perfCycle.findFirst({
          where: { id: cycleId, deletedAt: null },
          select: { id: true, status: true },
        });
        if (!cycle) throw new NotFoundException('绩效周期不存在');
        if (cycle.status !== PerfCycleStatus.ACTIVE) {
          throw new ConflictException('只有进行中的周期可以归档');
        }
        const participants = await this.loadParticipants(tx, cycleId);
        await this.assertCycleCoverage(operatorOpenId, participants);
        const preview = this.buildPreview(cycleId, participants);
        if (preview.blockers.length > 0) {
          throw new ConflictException({
            code: 'CYCLE_ARCHIVE_BLOCKED',
            message: '周期仍有未收口参与者，不能归档',
            summary: preview.summary,
            blockers: preview.blockers,
            revision: preview.revision,
          });
        }
        if (preview.revision !== input.expectedRevision) {
          throw new ConflictException({
            code: 'ARCHIVE_PREVIEW_STALE',
            message: '归档摘要已变化，请刷新预览后重新确认',
            summary: preview.summary,
            blockers: preview.blockers,
            revision: preview.revision,
          });
        }

        const now = new Date();
        const changed = await tx.perfCycle.updateMany({
          where: { id: cycleId, status: PerfCycleStatus.ACTIVE },
          data: { status: PerfCycleStatus.ARCHIVED },
        });
        if (changed.count !== 1) {
          throw new ConflictException('周期状态已变化，请刷新后重试');
        }
        const archive = await tx.perfCycleArchive.create({
          data: {
            cycleId,
            operatorOpenId,
            summary: preview.summary,
            checkResult: {
              revision: preview.revision,
              blockers: preview.blockers,
            },
            archivedAt: now,
          },
        });
        await tx.auditLog.create({
          data: {
            operatorOpenId,
            action: 'cycle.archive',
            targetType: 'perf_cycle',
            targetId: String(cycleId),
            before: { status: PerfCycleStatus.ACTIVE },
            after: {
              status: PerfCycleStatus.ARCHIVED,
              archiveId: archive.id,
              summary: preview.summary,
              revision: preview.revision,
            },
          },
        });
        return {
          cycleId,
          status: PerfCycleStatus.ARCHIVED,
          archiveId: archive.id,
          archivedAt: archive.archivedAt,
          summary: preview.summary,
          revision: preview.revision,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private loadParticipants(
    client: Pick<PrismaService, 'perfParticipant'>,
    cycleId: number,
  ): Promise<ArchiveParticipant[]> {
    return client.perfParticipant.findMany({
      where: { cycleId },
      orderBy: { id: 'asc' },
      include: {
        evaluationSubmissions: {
          where: { status: 'SUBMITTED' },
          select: { stage: true, status: true },
        },
        calibrations: {
          where: { invalidatedAt: null },
          orderBy: { id: 'desc' },
          take: 1,
          select: { id: true },
        },
        resultVersions: {
          where: { supersededAt: null, invalidatedAt: null },
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            id: true,
            finalLevel: true,
            confirmedAt: true,
          },
        },
        appeals: {
          where: { invalidatedAt: null, status: { not: 'RESOLVED' } },
          select: { id: true, status: true },
        },
      },
    });
  }

  private async assertCycleCoverage(
    operatorOpenId: string,
    participants: ArchiveParticipant[],
  ) {
    if (await this.rbacService.isAdmin(operatorOpenId)) return;
    if (!(await this.rbacService.hasAnyRole(operatorOpenId, [PerfRole.HR]))) {
      throw new ForbiddenException('只有 Admin 或 HR 可以预览和归档周期');
    }
    const orgScope = await this.rbacService.getOrgScope(operatorOpenId);
    if (orgScope === null) return;
    const covered = new Set(orgScope);
    if (
      participants.some(
        (participant) =>
          !participant.departmentIdSnapshot ||
          !covered.has(participant.departmentIdSnapshot),
      )
    ) {
      throw new ForbiddenException('你的 HR 授权范围未覆盖本周期全部参与者');
    }
  }

  private buildPreview(
    cycleId: number,
    participants: ArchiveParticipant[],
  ): CycleArchivePreview {
    const summary: CycleArchiveSummary = {
      participantCount: participants.length,
      confirmedCount: 0,
      noResultCount: 0,
      withdrawnCount: 0,
      levelDistribution: {},
    };
    const blockers: CycleArchiveBlocker[] = [];

    for (const participant of participants) {
      if (participant.status === 'CONFIRMED') summary.confirmedCount += 1;
      if (participant.status === 'NO_RESULT') summary.noResultCount += 1;
      if (participant.status === 'WITHDRAWN') summary.withdrawnCount += 1;
      const currentResult = participant.resultVersions[0];
      if (participant.status === 'CONFIRMED' && currentResult) {
        summary.levelDistribution[currentResult.finalLevel] =
          (summary.levelDistribution[currentResult.finalLevel] ?? 0) + 1;
      }

      const addBlocker = (code: string, message: string) =>
        blockers.push({
          participantId: participant.id,
          employeeOpenId: participant.employeeOpenId,
          code,
          message,
        });
      const isNoResultOrWithdrawn =
        participant.status === 'NO_RESULT' ||
        participant.status === 'WITHDRAWN';
      if (!isNoResultOrWithdrawn) {
        const submittedStages = new Set(
          participant.evaluationSubmissions
            .filter((submission) => submission.status === 'SUBMITTED')
            .map((submission) => submission.stage),
        );
        const hasSelf = submittedStages.has('SELF');
        const hasManager = submittedStages.has('MANAGER');
        if (!hasSelf) {
          addBlocker('REQUIRED_SELF_MISSING', '缺少必交的员工自评');
        }
        if (!hasManager) {
          addBlocker('REQUIRED_MANAGER_MISSING', '缺少必交的上级评估');
        }
      }

      if (
        participant.appeals.length > 0 ||
        participant.status === 'APPEALING'
      ) {
        addBlocker('OPEN_APPEAL', '存在尚未关闭的申诉');
      }
      if (participant.status === 'RE_CONFIRMING') {
        addBlocker('RECONFIRMATION_PENDING', '申诉处理后仍待员工再次确认');
      }
      if (
        [
          'CALIBRATED',
          'RESULT_PUBLISHED',
          'APPEALING',
          'RE_CONFIRMING',
          'CONFIRMED',
        ].includes(participant.status) &&
        participant.calibrations.length === 0
      ) {
        addBlocker('CALIBRATION_MISSING', '缺少当前有效的校准决定');
      }
      if (
        [
          'CALIBRATED',
          'RESULT_PUBLISHED',
          'APPEALING',
          'RE_CONFIRMING',
          'CONFIRMED',
        ].includes(participant.status) &&
        !currentResult
      ) {
        addBlocker('RESULT_NOT_PUBLISHED', '缺少当前有效的已发布结果版本');
      }
      if (
        participant.status === 'RESULT_PUBLISHED' ||
        (participant.status === 'CONFIRMED' && !currentResult?.confirmedAt)
      ) {
        addBlocker('CONFIRMATION_PENDING', '当前结果版本仍待员工确认');
      }
      if (!CLOSED_STATUSES.has(participant.status)) {
        const stateBlockers: Record<string, [string, string]> = {
          CALIBRATED: ['RESULT_NOT_PUBLISHED', '已校准但结果尚未发布'],
          RESULT_PUBLISHED: ['CONFIRMATION_PENDING', '结果已发布但尚未确认'],
          APPEALING: ['OPEN_APPEAL', '申诉尚未关闭'],
          RE_CONFIRMING: [
            'RECONFIRMATION_PENDING',
            '申诉处理后仍待员工再次确认',
          ],
        };
        const [code, message] = stateBlockers[participant.status] ?? [
          'PARTICIPANT_NOT_CLOSED',
          `参与者状态 ${participant.status} 尚未收口`,
        ];
        if (
          !blockers.some(
            (blocker) =>
              blocker.participantId === participant.id && blocker.code === code,
          )
        ) {
          addBlocker(code, message);
        }
      }
    }

    const revision = createHash('sha256')
      .update(JSON.stringify({ cycleId, summary, blockers }))
      .digest('hex');
    return {
      cycleId,
      canArchive: blockers.length === 0,
      summary,
      blockers,
      revision,
    };
  }
}
