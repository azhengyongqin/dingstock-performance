import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PerfLegacyMigrationItemStatus } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import {
  canonicalChecksum,
  decideMigrationItem,
} from './legacy-migration-ledger';

/**
 * 迁移账本负责来源级串行化、幂等判定与失败取证。
 * 目标创建必须发生在账本 claim 之后，并与 claim 共用同一事务。
 */
@Injectable()
export class LegacyMigrationLedgerService {
  private readonly logger = new Logger(LegacyMigrationLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async migrateItem(
    runId: number,
    sourceType: string,
    sourceBusinessKey: string,
    sourcePayload: unknown,
    targetType: string,
    createTarget: (tx: Prisma.TransactionClient) => Promise<number>,
  ): Promise<number> {
    const checksum = canonicalChecksum(sourcePayload);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 锁粒度是全局来源业务键；不同 run 并发重跑也只能创建一个目标。
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${sourceType}:${sourceBusinessKey}`}, 0)
          )
        `;
        const existing = await tx.perfLegacyMigrationItem.findUnique({
          where: {
            sourceType_sourceBusinessKey: { sourceType, sourceBusinessKey },
          },
        });
        const decision = decideMigrationItem(existing, checksum);
        if (decision.action === 'REUSE') {
          await tx.perfLegacyMigrationItem.update({
            where: { id: existing!.id },
            data: { runId, status: PerfLegacyMigrationItemStatus.MIGRATED },
          });
          return decision.targetId;
        }
        if (decision.action === 'CONFLICT') throw new Error(decision.code);

        // 先 claim 再创建目标；任一步失败时整个事务回滚，不留下半成品。
        const claimed = await tx.perfLegacyMigrationItem.upsert({
          where: {
            sourceType_sourceBusinessKey: { sourceType, sourceBusinessKey },
          },
          create: {
            runId,
            sourceType,
            sourceBusinessKey,
            checksum,
            status: PerfLegacyMigrationItemStatus.SKIPPED,
            detail: { claim: 'PROCESSING' },
          },
          update: {
            runId,
            targetType: null,
            targetId: null,
            checksum,
            status: PerfLegacyMigrationItemStatus.SKIPPED,
            detail: { claim: 'PROCESSING', replayed: true },
          },
        });
        const targetId = await createTarget(tx);
        await tx.perfLegacyMigrationItem.update({
          where: { id: claimed.id },
          data: {
            runId,
            targetType,
            targetId,
            checksum,
            status: PerfLegacyMigrationItemStatus.MIGRATED,
            detail: { replayed: decision.action === 'RETRY' },
          },
        });
        this.logger.log(
          `${sourceType} ${sourceBusinessKey} -> ${targetType}:${targetId}`,
        );
        return targetId;
      });
    } catch (error) {
      await this.recordFailure(
        runId,
        sourceType,
        sourceBusinessKey,
        sourcePayload,
        error,
      );
      throw error;
    }
  }

  /** 已成功的全局来源绝不允许被并发失败覆盖。 */
  async recordFailure(
    runId: number,
    sourceType: string,
    sourceBusinessKey: string,
    sourcePayload: unknown,
    error: unknown,
  ) {
    const checksum = canonicalChecksum(sourcePayload);
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`${sourceType}:${sourceBusinessKey}`}, 0)
        )
      `;
      const existing = await tx.perfLegacyMigrationItem.findUnique({
        where: {
          sourceType_sourceBusinessKey: { sourceType, sourceBusinessKey },
        },
      });
      if (
        existing?.status === PerfLegacyMigrationItemStatus.MIGRATED ||
        (existing && existing.checksum !== checksum)
      ) {
        // 保留首次来源 checksum，避免一次冲突失败把全局防漂移证据改写掉。
        return;
      }
      await tx.perfLegacyMigrationItem.upsert({
        where: {
          sourceType_sourceBusinessKey: { sourceType, sourceBusinessKey },
        },
        create: {
          runId,
          sourceType,
          sourceBusinessKey,
          checksum,
          status: PerfLegacyMigrationItemStatus.FAILED,
          detail: { code: message.split(':')[0], message },
        },
        update: {
          runId,
          checksum,
          status: PerfLegacyMigrationItemStatus.FAILED,
          detail: { code: message.split(':')[0], message },
        },
      });
    });
  }
}
