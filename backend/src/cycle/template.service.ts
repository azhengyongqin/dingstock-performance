import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateTemplateDto,
  UpdateTemplateDto,
  UpsertDimensionsDto,
} from './cycle.dto';
import { normalizeEvaluationRule } from './evaluation-rule';
import { getCycleCreationUnavailableReasons } from './template-usability';

/**
 * 绩效配置模板：评估规则 + 维度集的跨周期复用母本。
 * 创建周期时由 CycleService 复制为周期快照；模板本身的增删改不影响已创建周期。
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listTemplates() {
    const items = await this.prisma.perfTemplate.findMany({
      where: { deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      include: {
        dimensions: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { dimensions: true, cycles: true } },
      },
    });
    return {
      items: items.map((template) => {
        const unavailableReasons = getCycleCreationUnavailableReasons(template);
        return {
          ...template,
          canCreateCycle: unavailableReasons.length === 0,
          unavailableReasons,
        };
      }),
      total: items.length,
    };
  }

  async getTemplate(id: number) {
    const template = await this.prisma.perfTemplate.findFirst({
      where: { id, deletedAt: null },
      include: { dimensions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw new NotFoundException('配置模板不存在');
    return template;
  }

  async createTemplate(operatorOpenId: string, dto: CreateTemplateDto) {
    const template = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        // 至多一个默认模板
        await tx.perfTemplate.updateMany({
          data: { isDefault: false },
          where: { isDefault: true },
        });
      }
      const evaluationRule = normalizeEvaluationRule(dto);
      return tx.perfTemplate.create({
        data: {
          name: dto.name,
          description: dto.description,
          isDefault: dto.isDefault ?? false,
          levels: evaluationRule.levels,
          commentRequiredRules: evaluationRule.commentRequiredRules,
          updatedByOpenId: operatorOpenId,
        },
      });
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'template.create',
      targetType: 'perf_template',
      targetId: String(template.id),
      after: template,
    });
    return template;
  }

  async updateTemplate(
    operatorOpenId: string,
    id: number,
    dto: UpdateTemplateDto,
  ) {
    const before = await this.getTemplate(id);
    const template = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.perfTemplate.updateMany({
          data: { isDefault: false },
          where: { isDefault: true },
        });
      }
      const evaluationRule =
        dto.levels || dto.commentRequiredRules
          ? normalizeEvaluationRule({
              levels:
                dto.levels ??
                (before.levels as Record<string, unknown>[] | null) ??
                [],
              commentRequiredRules:
                dto.commentRequiredRules ??
                (before.commentRequiredRules as Record<
                  string,
                  unknown
                > | null) ??
                undefined,
            })
          : null;
      return tx.perfTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          isDefault: dto.isDefault,
          levels: evaluationRule?.levels,
          commentRequiredRules: evaluationRule
            ? (evaluationRule.commentRequiredRules as unknown as Prisma.InputJsonValue)
            : undefined,
          updatedByOpenId: operatorOpenId,
        },
      });
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'template.update',
      targetType: 'perf_template',
      targetId: String(id),
      before,
      after: template,
    });
    return template;
  }

  /** 整体覆盖式维护模板维度：带 id 更新、不带 id 新增、缺席的物理删除（模板项无历史包袱） */
  async upsertDimensions(
    operatorOpenId: string,
    templateId: number,
    dto: UpsertDimensionsDto,
  ) {
    await this.getTemplate(templateId);
    const keptIds = dto.items.filter((item) => item.id).map((item) => item.id!);

    await this.prisma.$transaction(async (tx) => {
      await tx.perfTemplateDimension.deleteMany({
        where: {
          templateId,
          id: { notIn: keptIds.length > 0 ? keptIds : [0] },
        },
      });
      for (const [index, item] of dto.items.entries()) {
        const data = {
          name: item.name,
          type: item.type,
          scoringMethod: item.scoringMethod,
          weight: item.weight,
          required: item.required ?? true,
          sortOrder: item.sortOrder ?? index,
          visibleRoles: item.visibleRoles ?? [],
          editableRoles: item.editableRoles ?? [],
          formSchema: item.formSchema as Prisma.InputJsonValue | undefined,
          applicableScope: item.applicableScope as
            Prisma.InputJsonValue | undefined,
          conclusionOptions: item.conclusionOptions as unknown as
            Prisma.InputJsonValue | undefined,
          employeeVisible: item.employeeVisible,
        };
        if (item.id) {
          await tx.perfTemplateDimension.update({
            where: { id: item.id },
            data,
          });
        } else {
          await tx.perfTemplateDimension.create({
            data: { ...data, templateId },
          });
        }
      }
    });

    await this.auditService.record({
      operatorOpenId,
      action: 'template.dimensions.upsert',
      targetType: 'perf_template',
      targetId: String(templateId),
      after: { count: dto.items.length },
    });
    return this.getTemplate(templateId);
  }

  async deleteTemplate(operatorOpenId: string, id: number) {
    const template = await this.getTemplate(id);
    await this.prisma.perfTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.record({
      operatorOpenId,
      action: 'template.delete',
      targetType: 'perf_template',
      targetId: String(id),
      before: template,
    });
    return { ok: true };
  }
}
