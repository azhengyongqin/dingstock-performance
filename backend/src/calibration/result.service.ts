import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PerfParticipantStatus } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ParticipantService } from '../participant/participant.service';

/** 员工侧结果查询与确认（产品 §5.6）；结果推送前员工不可见任何评分（产品 §3.2） */
@Injectable()
export class ResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly participantService: ParticipantService,
  ) {}

  private static readonly VISIBLE_STATUSES: PerfParticipantStatus[] = [
    PerfParticipantStatus.RESULT_PUSHED,
    PerfParticipantStatus.CONFIRMED,
    PerfParticipantStatus.APPEALING,
    PerfParticipantStatus.RE_CONFIRMING,
    PerfParticipantStatus.ARCHIVED,
  ];

  /** 我的当前结果：仅结果已推送后可见 */
  async getCurrent(employeeOpenId: string, cycleId?: number) {
    const participant = await this.prisma.perfParticipant.findFirst({
      where: {
        employeeOpenId,
        cycle: { deletedAt: null },
        ...(cycleId ? { cycleId } : {}),
        status: { in: ResultService.VISIBLE_STATUSES },
      },
      orderBy: { id: 'desc' },
      include: {
        cycle: { select: { id: true, name: true, status: true } },
        result: true,
        appeals: { orderBy: { id: 'desc' } },
      },
    });
    if (!participant?.result) return { participant: null, result: null };

    // 晋升结论可见性：由晋升维度 employee_visible 配置决定
    let promotionVisible = false;
    if (participant.isPromotionEnabled) {
      const promotionDim = await this.prisma.perfDimension.findFirst({
        where: {
          cycleId: participant.cycleId,
          type: 'PROMOTION',
          deletedAt: null,
        },
        select: { employeeVisible: true },
      });
      promotionVisible = promotionDim?.employeeVisible ?? false;
    }
    const result = {
      ...participant.result,
      promotionResult: promotionVisible
        ? participant.result.promotionResult
        : null,
    };
    return {
      participant: {
        id: participant.id,
        status: participant.status,
        cycle: participant.cycle,
      },
      result,
      appeals: participant.appeals,
    };
  }

  /** 员工确认结果；与申诉互斥 */
  async confirm(employeeOpenId: string, cycleId: number) {
    const participant = await this.prisma.perfParticipant.findFirst({
      where: { employeeOpenId, cycleId },
      include: { result: true },
    });
    if (!participant?.result) throw new NotFoundException('结果尚未推送');
    if (
      participant.status !== PerfParticipantStatus.RESULT_PUSHED &&
      participant.status !== PerfParticipantStatus.RE_CONFIRMING
    ) {
      throw new ConflictException('当前状态不允许确认结果');
    }

    await this.prisma.perfResult.update({
      where: { id: participant.result.id },
      data: { confirmedByEmployee: true, confirmedAt: new Date() },
    });
    await this.participantService.transition(
      employeeOpenId,
      participant.id,
      PerfParticipantStatus.CONFIRMED,
    );
    await this.auditService.record({
      operatorOpenId: employeeOpenId,
      action: 'result.confirm',
      targetType: 'perf_participant',
      targetId: String(participant.id),
    });
    return { ok: true };
  }
}
