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
  async lockSelfWrite(
    tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
    participantId: number,
    employeeOpenId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: number; status: PerfParticipantStatus }>
    >`
      SELECT "id", "status"
      FROM "performance"."perf_participants"
      WHERE "id" = ${participantId} AND "employee_open_id" = ${employeeOpenId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('你不在本周期考核名单中');
    }
    if (rows[0].status === PerfParticipantStatus.NO_RESULT) {
      throw new ConflictException({
        code: 'EVALUATION_PARTICIPANT_LOCKED',
        message: '该员工已标记为当前周期无绩效结果，请先撤销后再继续填写',
      });
    }
  }
}
