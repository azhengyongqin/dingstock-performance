/**
 * 初始化默认绩效配置模板（幂等：已存在同名模板则跳过）。
 * 运行：pnpm seed:template
 *
 * 内容来源：公司现行绩效评估指标 ——
 * - 员工岗指标(D)：核心业绩 70%（员工自评）/ 职业素养与潜力 10%（上级评估）/ 价值观 20%（上级评估）
 * - 管理岗指标(M)：核心业绩 50%（员工自评）/ 管理绩效 50%（上级评估）
 * - 晋升评估：结论型特殊维度，按参与者 is_promotion_enabled 展示
 * - 评估规则：S[90,100] / A[80,90) / B[60,80) / C[0,60)，最高/最低评级必填评语
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { loadAppConfig } from '../config/configuration';
import { PrismaClient } from '../generated/prisma/client';
import {
  PerfDimensionType,
  PerfRole,
  PerfScoringMethod,
} from '../generated/prisma/enums';
import {
  DEFAULT_COMMENT_REQUIRED_RULES,
  DEFAULT_EVALUATION_RATINGS,
} from '../cycle/evaluation-rule';

const TEMPLATE_NAME = '标准半年度评估模板';

async function main() {
  const config = loadAppConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.database.url }),
  });

  try {
    const existing = await prisma.perfTemplate.findFirst({
      where: { name: TEMPLATE_NAME, deletedAt: null },
    });
    if (existing) {
      console.log(
        `模板「${TEMPLATE_NAME}」已存在（id=${existing.id}），跳过初始化`,
      );
      return;
    }

    const template = await prisma.perfTemplate.create({
      data: {
        name: TEMPLATE_NAME,
        description:
          '公司现行绩效评估指标：员工岗(D) 核心业绩70/职业素养与潜力10/价值观20；管理岗(M) 核心业绩50/管理绩效50；含晋升评估结论维度',
        isDefault: true,
        levels: DEFAULT_EVALUATION_RATINGS,
        commentRequiredRules: DEFAULT_COMMENT_REQUIRED_RULES,
        dimensions: {
          create: [
            // ---- 员工岗指标（D）----
            {
              name: '核心业绩',
              type: PerfDimensionType.REGULAR,
              scoringMethod: PerfScoringMethod.LEVEL,
              weight: 70,
              sortOrder: 0,
              // （员工自评）：员工填写个人总结，评审员/上级打分
              editableRoles: [
                PerfRole.EMPLOYEE,
                PerfRole.REVIEWER,
                PerfRole.LEADER,
              ],
              visibleRoles: [
                PerfRole.EMPLOYEE,
                PerfRole.REVIEWER,
                PerfRole.LEADER,
              ],
              applicableScope: { jobCategory: 'D' },
            },
            {
              name: '职业素养与潜力',
              type: PerfDimensionType.REGULAR,
              scoringMethod: PerfScoringMethod.LEVEL,
              weight: 10,
              sortOrder: 1,
              // （上级评估）
              editableRoles: [PerfRole.REVIEWER, PerfRole.LEADER],
              visibleRoles: [PerfRole.REVIEWER, PerfRole.LEADER],
              applicableScope: { jobCategory: 'D' },
            },
            {
              name: '价值观',
              type: PerfDimensionType.REGULAR,
              scoringMethod: PerfScoringMethod.LEVEL,
              weight: 20,
              sortOrder: 2,
              // （上级评估）
              editableRoles: [PerfRole.REVIEWER, PerfRole.LEADER],
              visibleRoles: [PerfRole.REVIEWER, PerfRole.LEADER],
              applicableScope: { jobCategory: 'D' },
            },
            // ---- 管理岗指标（M）----
            {
              name: '核心业绩',
              type: PerfDimensionType.REGULAR,
              scoringMethod: PerfScoringMethod.LEVEL,
              weight: 50,
              sortOrder: 3,
              editableRoles: [
                PerfRole.EMPLOYEE,
                PerfRole.REVIEWER,
                PerfRole.LEADER,
              ],
              visibleRoles: [
                PerfRole.EMPLOYEE,
                PerfRole.REVIEWER,
                PerfRole.LEADER,
              ],
              applicableScope: { jobCategory: 'M' },
            },
            {
              name: '管理绩效',
              type: PerfDimensionType.REGULAR,
              scoringMethod: PerfScoringMethod.LEVEL,
              weight: 50,
              sortOrder: 4,
              editableRoles: [PerfRole.REVIEWER, PerfRole.LEADER],
              visibleRoles: [PerfRole.REVIEWER, PerfRole.LEADER],
              applicableScope: { jobCategory: 'M' },
            },
            // ---- 晋升评估（全员按参与者标记展示）----
            {
              name: '晋升评估',
              type: PerfDimensionType.PROMOTION,
              scoringMethod: PerfScoringMethod.CONCLUSION,
              sortOrder: 5,
              editableRoles: [
                PerfRole.EMPLOYEE,
                PerfRole.REVIEWER,
                PerfRole.LEADER,
              ],
              visibleRoles: [PerfRole.LEADER, PerfRole.HR],
              conclusionOptions: [
                '建议晋升',
                '暂缓晋升',
                '不建议晋升',
                '不适用',
              ],
              employeeVisible: true,
            },
          ],
        },
      },
      include: { dimensions: true },
    });

    console.log(
      `已创建默认模板「${template.name}」（id=${template.id}，默认=${template.isDefault}，维度 ${template.dimensions.length} 个）`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
