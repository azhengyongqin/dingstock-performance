/**
 * 幂等初始化 D/M 默认评估表单模板。
 * 运行：pnpm seed:form-templates
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { loadAppConfig } from '../config/configuration';
import {
  DEFAULT_FORM_TEMPLATES,
  toDefaultLegacyPromotionCreateData,
} from '../form-template/default-form-templates';
import { toPerformanceSubformCreateData } from '../form-template/form-template.persistence';
import { validateFormTemplatePublication } from '../form-template/publication-validator';
import { PrismaClient } from '../generated/prisma/client';

const SYSTEM_OPERATOR = 'SYSTEM_FORM_TEMPLATE_SEED';

async function main() {
  const config = loadAppConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.database.url }),
  });

  try {
    for (const template of DEFAULT_FORM_TEMPLATES) {
      const issues = validateFormTemplatePublication(template);
      if (issues.length > 0) {
        throw new Error(
          `默认表单 ${template.systemKey} 未通过发布校验：${JSON.stringify(issues)}`,
        );
      }

      const existing = await prisma.perfFormTemplate.findUnique({
        where: { systemKey: template.systemKey },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (existing) {
        console.log(
          `${template.systemKey} 已存在（templateId=${existing.id}），跳过初始化`,
        );
        continue;
      }

      const created = await prisma.$transaction(async (tx) => {
        const root = await tx.perfFormTemplate.create({
          data: {
            systemKey: template.systemKey,
            createdByOpenId: SYSTEM_OPERATOR,
          },
        });
        const version = await tx.perfFormTemplateVersion.create({
          data: {
            templateId: root.id,
            version: template.version,
            // 数据库要求所有版本从 DRAFT 起步，子层写完后再走正式发布状态转换。
            status: 'DRAFT',
            name: template.name,
            description: template.description,
            jobLevelPrefix: template.jobLevelPrefix,
            createdByOpenId: SYSTEM_OPERATOR,
            updatedByOpenId: SYSTEM_OPERATOR,
            subforms: {
              create: [
                ...toPerformanceSubformCreateData(template.subforms),
                toDefaultLegacyPromotionCreateData(),
              ],
            },
          },
        });

        const now = new Date();
        await tx.perfFormTemplateVersion.update({
          where: { id: version.id },
          data: {
            status: 'PUBLISHED',
            publishedByOpenId: SYSTEM_OPERATOR,
            publishedAt: now,
            updatedByOpenId: SYSTEM_OPERATOR,
          },
        });
        return { templateId: root.id, versionId: version.id };
      });

      console.log(
        `已发布 ${template.systemKey}（templateId=${created.templateId}, versionId=${created.versionId}）`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
