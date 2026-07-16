import { Injectable } from '@nestjs/common';
import { PrismaService } from '../shared/database/prisma.service';

export type PeerSafeEmployeeProfile = {
  open_id: string;
  name: string;
  avatar: unknown;
  departmentPath: string | null;
  jobTitle: string | null;
};

export type DetailedEmployeeProfile = PeerSafeEmployeeProfile & {
  jobLevel: string | null;
  effectiveDate: string | null;
};

type I18nName = Array<{ lang?: string; value?: string }>;

/** CoreHR 多语言字段统一取中文、英文或首个有效值。 */
const pickI18nName = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  const names = value as I18nName;
  return (
    names.find((item) => item.lang?.toLowerCase().startsWith('zh'))?.value ??
    names.find((item) => item.lang?.toLowerCase().startsWith('en'))?.value ??
    names.find((item) => item.value)?.value ??
    null
  );
};

const nestedName = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return pickI18nName((value as { name?: unknown }).name);
};

/** 评估填写页专用人员投影：只返回归一化展示字段，不泄露完整 CoreHR 对象。 */
@Injectable()
export class EvaluationEmployeeProfileService {
  private departmentCache:
    | {
        expiresAt: number;
        byId: Map<
          string,
          {
            open_department_id: string;
            name: string;
            parent_department_id: string;
          }
        >;
      }
    | undefined;

  constructor(private readonly prisma: PrismaService) {}

  getDetailed(openId: string) {
    return this.load(openId, true);
  }

  /** 360°边界只构造非敏感字段，职级和入职日期不会出现在响应对象中。 */
  getPeerSafe(openId: string) {
    return this.load(openId, false);
  }

  private async load(
    openId: string,
    includeSensitive: true,
  ): Promise<DetailedEmployeeProfile | null>;
  private async load(
    openId: string,
    includeSensitive: false,
  ): Promise<PeerSafeEmployeeProfile | null>;
  private async load(
    openId: string,
    includeSensitive: boolean,
  ): Promise<DetailedEmployeeProfile | PeerSafeEmployeeProfile | null> {
    const user = await this.prisma.larkUser.findUnique({
      where: { open_id: openId },
      select: {
        open_id: true,
        name: true,
        avatar: true,
        corehr: {
          select: {
            department_id: true,
            job: true,
            job_level: true,
            effective_date: true,
          },
        },
      },
    });
    if (!user) return null;

    const departmentPath = user.corehr?.department_id
      ? await this.resolveDepartmentPath(user.corehr.department_id)
      : null;
    const base: PeerSafeEmployeeProfile = {
      open_id: user.open_id,
      name: user.name,
      avatar: user.avatar,
      departmentPath,
      jobTitle: nestedName(user.corehr?.job),
    };

    if (!includeSensitive) return base;
    return {
      ...base,
      jobLevel: nestedName(user.corehr?.job_level),
      effectiveDate: this.formatDate(user.corehr?.effective_date),
    };
  }

  private async resolveDepartmentPath(departmentId: string) {
    const byId = await this.getDepartmentMap();
    const names: string[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = departmentId;

    while (currentId && currentId !== '0' && !visited.has(currentId)) {
      visited.add(currentId);
      const current = byId.get(currentId);
      if (!current) return null;
      names.unshift(current.name);
      currentId = current.parent_department_id;
    }
    return names.length > 0 ? names.join(' / ') : null;
  }

  /** 部门树更新频率低，短时缓存避免每次打开评估页都全表读取。 */
  private async getDepartmentMap() {
    if (this.departmentCache && this.departmentCache.expiresAt > Date.now()) {
      return this.departmentCache.byId;
    }
    const departments = await this.prisma.larkDepartment.findMany({
      select: {
        open_department_id: true,
        name: true,
        parent_department_id: true,
      },
    });
    const byId = new Map(
      departments.map((item) => [item.open_department_id, item]),
    );
    this.departmentCache = { expiresAt: Date.now() + 60_000, byId };
    return byId;
  }

  private formatDate(value?: string | null) {
    if (!value) return null;
    const day = value.split(/[ T]/)[0];
    return day.startsWith('9999') ? null : day;
  }
}
