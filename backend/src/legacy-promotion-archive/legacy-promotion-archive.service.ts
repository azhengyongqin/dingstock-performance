import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { PerfLegacyPromotionArchiveSource } from '../generated/prisma/enums';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';

type JsonRecord = Record<string, unknown>;
type SafeArchiveEntry =
  | { kind: 'TEXT'; label: string; content: string }
  | { kind: 'LINK'; label: string; url: string }
  | { kind: 'ATTACHMENT'; label: string; name: string; url: string };

const MAX_ENTRY_COUNT = 100;
const MAX_LABEL_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20_000;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, maxLength = MAX_CONTENT_LENGTH) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;

const boundedNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const httpUrl = (value: unknown) => {
  const url = boundedString(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? url
      : null;
  } catch {
    return null;
  }
};

/** 旧归档只读查询；原始 JSON 永不直接穿透到 API。 */
@Injectable()
export class LegacyPromotionArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

  async list(
    operatorOpenId: string,
    filters: {
      page: number;
      pageSize: number;
      cycleId?: number;
      sourceType?: PerfLegacyPromotionArchiveSource;
    },
  ) {
    const orgScope = await this.rbacService.getOrgScope(operatorOpenId);
    const where: Prisma.PerfLegacyPromotionArchiveWhereInput = {
      cycleId: filters.cycleId,
      sourceType: filters.sourceType,
      // ADMIN 与全局 HR 的 null 范围不加过滤；部门 HR 只读取参与者周期部门快照命中的历史。
      ...(orgScope === null
        ? {}
        : {
            participant: {
              departmentIdSnapshot: { in: orgScope },
            },
          }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.perfLegacyPromotionArchive.findMany({
        where,
        orderBy: [{ archivedAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: {
          id: true,
          sourceType: true,
          sourceRecordId: true,
          payload: true,
          sourceCreatedAt: true,
          archivedAt: true,
          cycle: { select: { id: true, name: true } },
          participant: { select: { id: true, employeeOpenId: true } },
        },
      }),
      this.prisma.perfLegacyPromotionArchive.count({ where }),
    ]);

    const openIds = [
      ...new Set(rows.map((row) => row.participant.employeeOpenId)),
    ];
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: openIds } },
      select: { open_id: true, name: true, avatar: true },
    });
    const userMap = new Map(users.map((user) => [user.open_id, user]));

    return {
      items: rows.map((row) => {
        const employee = userMap.get(row.participant.employeeOpenId);
        return {
          id: row.id,
          cycle: row.cycle,
          participant: {
            id: row.participant.id,
            employee: {
              openId: row.participant.employeeOpenId,
              name: employee?.name ?? null,
              avatarUrl: this.avatarUrl(employee?.avatar),
            },
          },
          source: {
            type: row.sourceType,
            recordId: row.sourceRecordId,
            createdAt: row.sourceCreatedAt,
          },
          payload: this.projectPayload(row.sourceType, row.payload),
          archivedAt: row.archivedAt,
        };
      }),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  private projectPayload(
    sourceType: PerfLegacyPromotionArchiveSource,
    payload: Prisma.JsonValue,
  ) {
    const root = isRecord(payload) ? payload : {};
    if (sourceType === 'RESULT_VERSION_SNAPSHOT') {
      return {
        kind: 'RESULT_SNAPSHOT' as const,
        version: boundedNumber(root.version),
        entries: this.projectResultEntries(root.promotion),
      };
    }

    return {
      kind: 'EVALUATION_ANSWER' as const,
      stage: boundedString(root.stage, 40),
      status: boundedString(root.status, 40),
      submittedAt: boundedString(root.submittedAt, 40),
      dimensionKey: boundedString(root.dimensionKey, 200),
      fieldKey: boundedString(root.itemKey, 200),
      fieldType: boundedString(root.itemType, 40),
      rating: this.rating(root.rawLevel),
      score: boundedNumber(root.rawScore),
      calculationScore: boundedNumber(root.calculationScore),
      entries: this.projectAnswerEntries(root.itemType, root.value),
    };
  }

  private projectAnswerEntries(
    rawType: unknown,
    value: unknown,
  ): SafeArchiveEntry[] {
    const type = boundedString(rawType, 40);
    if (type === 'LINK') {
      const url = httpUrl(value);
      return url ? [{ kind: 'LINK', label: '链接', url }] : [];
    }
    if (type === 'ATTACHMENT' && Array.isArray(value)) {
      return value.slice(0, MAX_ENTRY_COUNT).flatMap((item) => {
        if (!isRecord(item)) return [];
        const name = boundedString(item.name, MAX_LABEL_LENGTH);
        const url = httpUrl(item.url);
        return name && url
          ? [{ kind: 'ATTACHMENT' as const, label: '附件', name, url }]
          : [];
      });
    }
    if (type === 'MULTI_SELECT' && Array.isArray(value)) {
      return value.slice(0, MAX_ENTRY_COUNT).flatMap((item) => {
        const content = boundedString(item, MAX_LABEL_LENGTH);
        return content
          ? [{ kind: 'TEXT' as const, label: '已选项', content }]
          : [];
      });
    }
    const content = boundedString(value);
    return content ? [{ kind: 'TEXT', label: '作答内容', content }] : [];
  }

  private projectResultEntries(value: unknown): SafeArchiveEntry[] {
    const direct = boundedString(value);
    if (direct) return [{ kind: 'TEXT', label: '晋升结果', content: direct }];
    if (
      !isRecord(value) ||
      value.visible !== true ||
      !Array.isArray(value.items)
    ) {
      return [];
    }
    return value.items.slice(0, MAX_ENTRY_COUNT).flatMap((item) => {
      if (!isRecord(item)) return [];
      const content = boundedString(item.value);
      if (!content) return [];
      return [
        {
          kind: 'TEXT' as const,
          label: boundedString(item.title, MAX_LABEL_LENGTH) ?? '晋升内容',
          content,
        },
      ];
    });
  }

  private rating(value: unknown) {
    return value === 'S' || value === 'A' || value === 'B' || value === 'C'
      ? value
      : null;
  }

  private avatarUrl(value: unknown) {
    if (!isRecord(value)) return null;
    return (
      httpUrl(value.avatar_72) ??
      httpUrl(value.avatar_240) ??
      httpUrl(value.avatar_origin)
    );
  }
}
