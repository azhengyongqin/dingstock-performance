import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { DevLoginDto } from './dto/dev-login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('lark/authorize-url')
  @ApiOperation({ summary: '获取飞书 OAuth2 授权页地址（前端跳转用）' })
  getAuthorizeUrl() {
    return this.authService.buildAuthorizeUrl();
  }

  @Get('lark/callback')
  @ApiOperation({
    summary: '飞书授权回调：用授权码换会话并 302 跳回前端',
  })
  async larkCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const { token, user } = await this.authService.loginWithAuthorizationCode(
      code,
      state,
    );
    // 登录态通过前端回调页的 query 传递，由前端存储后清理地址栏。
    res.redirect(this.authService.buildWebRedirectUrl(token, user));
  }

  @Get('lark/jsapi-signature')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '飞书网页组件 JSAPI 鉴权签名（成员名片/搜索组件 config 用）',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    description: '当前页面完整 URL（不含 #hash 部分）',
  })
  getJsapiSignature(
    @Query('url') url: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.authService.buildJsapiSignature(url, req.user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户（校验会话 JWT）' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return req.user;
  }

  // ---- 开发环境快速登录（免鉴权，dev 开关关闭时统一 404；生产必须关闭） ----

  @Get('dev/users')
  @ApiOperation({
    summary: '【仅开发】列出可快速登录的员工及角色标记（选人用）',
  })
  listDevUsers() {
    return this.authService.listDevUsers();
  }

  @Post('dev/login')
  @ApiOperation({
    summary: '【仅开发】按 open_id 直接登录（免飞书 OAuth），返回会话 token',
  })
  devLogin(@Body() body: DevLoginDto) {
    return this.authService.devLogin(body.open_id);
  }
}
