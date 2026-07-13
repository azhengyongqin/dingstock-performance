import { Injectable } from '@nestjs/common';
import { PrismaService } from '../shared/database/prisma.service';

/** 本地库查询：组织架构与员工（数据由 ContactSyncService 同步而来）。 */
@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  async listDepartments() {
    const items = await this.prisma.larkDepartment.findMany({
      orderBy: [{ parent_department_id: 'asc' }, { order: 'asc' }],
    });
    return { items, total: items.length };
  }

  async listUsers(departmentId?: string) {
    // 传入部门时，展开为「该部门 + 其所有子部门」的 ID 集合：
    // 只要成员归属其中任一部门就命中，从而在选中父部门时同时显示子部门成员。
    const departmentIds = departmentId
      ? await this.collectDepartmentSubtreeIds(departmentId)
      : undefined;

    const items = await this.prisma.larkUser.findMany({
      // department_ids 为 PG 数组，hasSome 即“归属集合中的任一部门”。
      where: departmentIds
        ? { department_ids: { hasSome: departmentIds } }
        : undefined,
      // 一并返回 CoreHR 详情（可能为 null：未开通飞书人事或该账号未录入 CoreHR）。
      include: { corehr: true },
      orderBy: { name: 'asc' },
    });

    // CoreHR 的 direct_manager_id 是 open_id（同步时固定 user_id_type=open_id），
    // 这里统一反查姓名挂到 corehr.direct_manager_name，前端无需再逐个解析。
    const managerIds = [
      ...new Set(
        items
          .map((item) => item.corehr?.direct_manager_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const managers = managerIds.length
      ? await this.prisma.larkUser.findMany({
          where: { open_id: { in: managerIds } },
          select: { open_id: true, name: true },
        })
      : [];
    const managerNameById = new Map(managers.map((m) => [m.open_id, m.name]));

    const enriched = items.map((item) => ({
      ...item,
      corehr: item.corehr
        ? {
            ...item.corehr,
            direct_manager_name: item.corehr.direct_manager_id
              ? (managerNameById.get(item.corehr.direct_manager_id) ?? null)
              : null,
          }
        : null,
    }));

    return { items: enriched, total: enriched.length };
  }

  /** 按 open_id 返回页面展示所需的最小人员资料，供选人后补齐头像。 */
  async findUserBrief(openId: string) {
    return this.prisma.larkUser.findUnique({
      where: { open_id: openId },
      select: { open_id: true, name: true, avatar: true, job_title: true },
    });
  }

  /**
   * 收集指定部门及其所有后代部门的 open_department_id（含自身）。
   * 通过一次性拉取 parent 关系在内存中做 BFS，避免递归查询数据库。
   */
  private async collectDepartmentSubtreeIds(rootId: string): Promise<string[]> {
    const departments = await this.prisma.larkDepartment.findMany({
      select: { open_department_id: true, parent_department_id: true },
    });

    // 建立「父部门 -> 直接子部门列表」映射
    const childrenByParent = new Map<string, string[]>();
    for (const dept of departments) {
      const siblings = childrenByParent.get(dept.parent_department_id) ?? [];
      siblings.push(dept.open_department_id);
      childrenByParent.set(dept.parent_department_id, siblings);
    }

    const subtreeIds: string[] = [];
    const visited = new Set<string>();
    const queue = [rootId];

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) continue; // 防御环形数据导致的死循环
      visited.add(current);
      subtreeIds.push(current);
      queue.push(...(childrenByParent.get(current) ?? []));
    }

    return subtreeIds;
  }
}
