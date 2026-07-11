import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PerfRole } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';

/**
 * RBAC 角色解析与授权管理（产品文档 §3、研发文档 §8.4）。
 *
 * 角色分两类：
 * - 显式授权角色（HR/ADMIN）：存 role_grants 表；
 * - 派生角色（EMPLOYEE/REVIEWER/LEADER）：由 participant/assignment/leader 快照推导，不入表。
 *
 * 兜底：飞书租户超级管理员（lark_users.is_tenant_manager）自动视为 ADMIN，
 * 解决"第一个管理员由谁授权"的引导问题。
 */
@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /** 解析用户的显式角色集合（含租户管理员兜底） */
  async getExplicitRoles(openId: string): Promise<PerfRole[]> {
    const [grants, larkUser] = await Promise.all([
      this.prisma.roleGrant.findMany({ where: { userOpenId: openId } }),
      this.prisma.larkUser.findUnique({
        where: { open_id: openId },
        select: { is_tenant_manager: true },
      }),
    ]);

    const roles = new Set<PerfRole>(grants.map((grant) => grant.role));
    if (larkUser?.is_tenant_manager) {
      roles.add(PerfRole.ADMIN);
    }
    return [...roles];
  }

  /**
   * 派生角色标记（前端菜单/路由权限用）：
   * LEADER 由汇报关系派生——通讯录直属下属或任一周期的 Leader 快照命中即视为 Leader。
   */
  async getDerivedFlags(openId: string): Promise<{ isLeader: boolean }> {
    const [subordinates, snapshotLeader] = await Promise.all([
      this.prisma.larkUser.count({ where: { leader_user_id: openId } }),
      this.prisma.perfParticipant.count({ where: { leaderOpenIdSnapshot: openId } }),
    ]);

    return { isLeader: subordinates > 0 || snapshotLeader > 0 };
  }

  /** 是否具备任一要求角色；ADMIN 隐含通过所有检查 */
  async hasAnyRole(openId: string, required: PerfRole[]): Promise<boolean> {
    const roles = await this.getExplicitRoles(openId);
    if (roles.includes(PerfRole.ADMIN)) return true;
    return required.some((role) => roles.includes(role));
  }

  /** 是否为 ADMIN（含租户超管兜底）；管理员可编辑进行中周期的每个步骤 */
  async isAdmin(openId: string): Promise<boolean> {
    const roles = await this.getExplicitRoles(openId);
    return roles.includes(PerfRole.ADMIN);
  }

  /**
   * HR 的组织范围（授权部门子树展开后的部门 id 集合）。
   * 返回 null 表示不受限（ADMIN 或 org_scope 为空的全局授权）。
   */
  async getOrgScope(openId: string): Promise<string[] | null> {
    const roles = await this.getExplicitRoles(openId);
    if (roles.includes(PerfRole.ADMIN)) return null;

    const grants = await this.prisma.roleGrant.findMany({
      where: { userOpenId: openId, role: PerfRole.HR },
    });
    const rootIds = grants.flatMap((grant) => grant.orgScope);
    // org_scope 为空 = 全局 HR
    if (grants.length > 0 && rootIds.length === 0) return null;
    if (rootIds.length === 0) return [];

    return this.expandDepartmentSubtree(rootIds);
  }

  /** 展开部门子树（含自身）；复用 lark_departments 的 parent 关系 */
  async expandDepartmentSubtree(rootIds: string[]): Promise<string[]> {
    const departments = await this.prisma.larkDepartment.findMany({
      select: { open_department_id: true, parent_department_id: true },
    });
    const childrenMap = new Map<string, string[]>();
    for (const dept of departments) {
      const list = childrenMap.get(dept.parent_department_id) ?? [];
      list.push(dept.open_department_id);
      childrenMap.set(dept.parent_department_id, list);
    }

    const result = new Set<string>();
    const queue = [...rootIds];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (result.has(current)) continue;
      result.add(current);
      queue.push(...(childrenMap.get(current) ?? []));
    }
    return [...result];
  }

  // ---- 授权管理（ADMIN 操作） ----

  async listGrants() {
    const grants = await this.prisma.roleGrant.findMany({
      orderBy: { createdAt: 'desc' },
    });
    // 补充授权人/被授权人的姓名头像，前端直接展示
    const openIds = [
      ...new Set(
        grants.flatMap((g) =>
          [g.userOpenId, g.grantedByOpenId].filter(Boolean),
        ),
      ),
    ] as string[];
    const users = await this.prisma.larkUser.findMany({
      where: { open_id: { in: openIds } },
      select: { open_id: true, name: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.open_id, u]));
    return {
      items: grants.map((grant) => ({
        ...grant,
        user: userMap.get(grant.userOpenId) ?? null,
        grantedBy: grant.grantedByOpenId
          ? (userMap.get(grant.grantedByOpenId) ?? null)
          : null,
      })),
      total: grants.length,
    };
  }

  async createGrant(input: {
    userOpenId: string;
    role: PerfRole;
    orgScope: string[];
    grantedByOpenId: string;
  }) {
    if (input.role !== PerfRole.HR && input.role !== PerfRole.ADMIN) {
      throw new BadRequestException(
        '仅支持授予 HR / ADMIN 角色，其余角色由任务关系派生',
      );
    }
    return this.prisma.roleGrant.upsert({
      where: {
        userOpenId_role: { userOpenId: input.userOpenId, role: input.role },
      },
      create: {
        userOpenId: input.userOpenId,
        role: input.role,
        orgScope: input.orgScope,
        grantedByOpenId: input.grantedByOpenId,
      },
      update: {
        orgScope: input.orgScope,
        grantedByOpenId: input.grantedByOpenId,
      },
    });
  }

  async removeGrant(id: number) {
    const grant = await this.prisma.roleGrant.findUnique({ where: { id } });
    if (!grant) throw new NotFoundException('授权记录不存在');
    await this.prisma.roleGrant.delete({ where: { id } });
    return grant;
  }
}
