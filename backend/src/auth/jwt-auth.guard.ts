import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, LarkSessionUser } from './auth.service';

/** 挂载到 request 上的会话用户字段名 */
export type AuthenticatedRequest = Request & { user: LarkSessionUser };

/**
 * Bearer JWT 守卫：校验 Authorization 头中的应用会话 token，
 * 通过后把用户身份挂到 request.user 供控制器使用。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization ?? '';
    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('缺少 Bearer token');
    }

    request.user = await this.authService.verifySession(token);
    return true;
  }
}
