import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PerfCycleStatus } from '../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { PrismaService } from '../shared/database/prisma.service';
import type { UpdateCycleDto } from './cycle.dto';

/** 切换后的周期服务只负责基础信息；配置、表单、计划和状态迁移由各自深模块负责。 */
@Injectable()
export class CycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rbacService: RbacService,
  ) {}

  async listCycles(status?: PerfCycleStatus) {
    const where: Prisma.PerfCycleWhereInput = {
      deletedAt: null,
      status: status || undefined,
    };
    const items = await this.prisma.perfCycle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        currentConfigVersion: {
          select: {
            id: true,
            version: true,
            sourceConfigTemplateVersionId: true,
          },
        },
        _count: { select: { participants: true } },
      },
    });
    return { items, total: items.length };
  }

  async getCycle(id: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id, deletedAt: null },
      include: {
        currentConfigVersion: {
          include: { formSnapshots: { orderBy: { jobLevelPrefix: 'asc' } } },
        },
        archive: true,
        _count: { select: { participants: true } },
      },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    return cycle;
  }

  async requireCycle(id: number) {
    const cycle = await this.prisma.perfCycle.findFirst({
      where: { id, deletedAt: null },
    });
    if (!cycle) throw new NotFoundException('绩效周期不存在');
    return cycle;
  }

  private async assertEditable(
    status: PerfCycleStatus,
    operatorOpenId: string,
  ) {
    if (await this.rbacService.isAdmin(operatorOpenId)) {
      if (status === PerfCycleStatus.ARCHIVED) {
        throw new ConflictException('周期已归档，配置不可修改');
      }
      return;
    }
    if (
      status !== PerfCycleStatus.DRAFT &&
      status !== PerfCycleStatus.SCHEDULED
    ) {
      throw new ConflictException('周期已启动，配置不可修改');
    }
  }

  async updateCycle(operatorOpenId: string, id: number, dto: UpdateCycleDto) {
    const cycle = await this.requireCycle(id);
    await this.assertEditable(cycle.status, operatorOpenId);
    const updated = await this.prisma.perfCycle.update({
      where: { id },
      data: {
        name: dto.name,
        plannedStartAt: dto.plannedStartAt
          ? new Date(dto.plannedStartAt)
          : undefined,
        ownerOpenId: dto.ownerOpenId,
      },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.update',
      targetType: 'perf_cycle',
      targetId: String(id),
      before: cycle,
      after: updated,
      reason:
        cycle.status === PerfCycleStatus.ACTIVE
          ? '管理员进行中编辑'
          : undefined,
    });
    return updated;
  }

  async deleteCycle(operatorOpenId: string, id: number) {
    const cycle = await this.requireCycle(id);
    if (cycle.status !== PerfCycleStatus.DRAFT) {
      throw new ConflictException('仅草稿状态的周期允许删除');
    }
    await this.prisma.perfCycle.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'cycle.delete',
      targetType: 'perf_cycle',
      targetId: String(id),
      before: cycle,
    });
    return { ok: true };
  }
}
