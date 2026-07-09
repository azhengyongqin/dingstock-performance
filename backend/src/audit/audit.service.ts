import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';

export type AuditEntry = {
  operatorOpenId: string;
  /** 操作类型，约定 `<聚合>.<动作>`，如 cycle.start / calibration.adjust */
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string;
};

/**
 * 操作日志（audit_logs，append-only）。
 * 记录失败只打日志不抛错——审计不能阻断业务主流程，
 * 但所有敏感操作调用方必须 await 本方法以保证顺序。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry) {
    try {
      await this.prisma.auditLog.create({
        data: {
          operatorOpenId: entry.operatorOpenId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          before: entry.before ?? undefined,
          after: entry.after ?? undefined,
          reason: entry.reason,
          ip: entry.ip,
        },
      });
    } catch (error) {
      this.logger.error(
        `写入操作日志失败：${entry.action} ${entry.targetType}#${entry.targetId}`,
        error,
      );
    }
  }

  async list(filters: {
    targetType?: string;
    targetId?: string;
    operatorOpenId?: string;
    action?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.AuditLogWhereInput = {
      targetType: filters.targetType || undefined,
      targetId: filters.targetId || undefined,
      operatorOpenId: filters.operatorOpenId || undefined,
      action: filters.action ? { contains: filters.action } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // 补操作人姓名，操作日志页直接展示
    const openIds = [...new Set(items.map((item) => item.operatorOpenId))];
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: openIds } },
      select: { open_id: true, name: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));
    return {
      items: items.map((item) => ({
        ...item,
        operator: userMap.get(item.operatorOpenId) ?? null,
      })),
      total,
    };
  }
}
