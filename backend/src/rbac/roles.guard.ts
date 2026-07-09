import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import type { PerfRole } from '../generated/prisma/enums';
import { RbacService } from './rbac.service';
import { ROLES_KEY } from './roles.decorator';

/**
 * 接口级角色守卫：配合 @Roles() 使用，必须排在 JwtAuthGuard 之后
 * （依赖 request.user 已注入）。未声明 @Roles 的路由直接放行。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PerfRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const openId = request.user?.open_id;
    if (!openId || !(await this.rbacService.hasAnyRole(openId, required))) {
      throw new ForbiddenException(`需要 ${required.join(' / ')} 角色`);
    }
    return true;
  }
}
