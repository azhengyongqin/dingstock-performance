import { SetMetadata } from '@nestjs/common';
import type { PerfRole } from '../generated/prisma/enums';

export const ROLES_KEY = 'perf:roles';

/**
 * 接口级角色要求（产品文档 §3.7 权限矩阵）。
 * 仅用于 HR/ADMIN 等显式授权角色；EMPLOYEE/REVIEWER/LEADER 为任务关系派生角色，
 * 其数据范围过滤在 service 层实现（研发文档 §8.4）。
 */
export const Roles = (...roles: PerfRole[]) => SetMetadata(ROLES_KEY, roles);
