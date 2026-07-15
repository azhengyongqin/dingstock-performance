import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PerfParticipantStatus } from '../generated/prisma/enums';

/**
 * 参与者评估写入行锁。
 * SELF 的新旧写入路径与 NO_RESULT 收口必须使用同一行锁，
 * 以保证“有效写入”与“无绩效结果”不会并发交错。
 */
@Injectable()
export class ParticipantEvaluationLockService {
  /**
   * 所有人工评估写入与校准共用参与者行锁。ensureWritable 的前置检查只改善提示，
   * 真正防止“校准刚成功、旧页面仍写入”的边界在这个事务内检查。
   */
  async lockHumanWrite(
    tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
    participantId: number,
    employeeOpenId?: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: number;
        employee_open_id: string;
        status: PerfParticipantStatus;
        evaluation_locked_at: Date | null;
      }>
    >`
      SELECT "id", "employee_open_id", "status", "evaluation_locked_at"
      FROM "performance"."perf_participants"
      WHERE "id" = ${participantId}
      FOR UPDATE
    `;
    if (
      rows.length !== 1 ||
      (employeeOpenId &&
        rows[0].employee_open_id &&
        rows[0].employee_open_id !== employeeOpenId)
    ) {
      throw new NotFoundException('你不在本周期考核名单中');
    }
    if (rows[0].evaluation_locked_at || this.isClosedStatus(rows[0].status)) {
      throw new ConflictException({
        code: 'EVALUATION_PARTICIPANT_LOCKED',
        message: '该员工已完成校准或评估收口，不能再修改或重新提交',
      });
    }
    return rows[0];
  }

  async lockSelfWrite(
    tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
    participantId: number,
    employeeOpenId: string,
  ) {
    return this.lockHumanWrite(tx, participantId, employeeOpenId);
  }

  private isClosedStatus(status: PerfParticipantStatus) {
    return new Set<string>([
      PerfParticipantStatus.CALIBRATED,
      PerfParticipantStatus.RESULT_PUSHED,
      PerfParticipantStatus.CONFIRMED,
      PerfParticipantStatus.APPEALING,
      PerfParticipantStatus.RE_CONFIRMING,
      PerfParticipantStatus.NO_RESULT,
      PerfParticipantStatus.ARCHIVED,
    ]).has(status);
  }
}
