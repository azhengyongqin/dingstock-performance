import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { PerfRole } from '../generated/prisma/enums';
import { RbacService } from './rbac.service';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

class CreateRoleGrantDto {
  @IsString()
  userOpenId!: string;

  /** 仅允许显式授权 HR / ADMIN */
  @IsIn([PerfRole.HR, PerfRole.ADMIN])
  role!: PerfRole;

  /** HR 的组织范围（open_department_id 列表）；空数组 = 全局 */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  orgScope?: string[];
}

@ApiTags('rbac')
@Controller('role-grants')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class RbacController {
  constructor(
    private readonly rbacService: RbacService,
    private readonly auditService: AuditService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: '查询当前用户的角色与组织范围（前端菜单/按钮权限用）',
  })
  async myRoles(@Req() req: AuthenticatedRequest) {
    const [roles, orgScope, derived] = await Promise.all([
      this.rbacService.getExplicitRoles(req.user.open_id),
      this.rbacService.getOrgScope(req.user.open_id),
      this.rbacService.getDerivedFlags(req.user.open_id),
    ]);
    return { roles, orgScope, ...derived };
  }

  @Get()
  @Roles(PerfRole.ADMIN, PerfRole.HR)
  @ApiOperation({ summary: '查询角色授权列表（HR/ADMIN）' })
  listGrants() {
    return this.rbacService.listGrants();
  }

  @Post()
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '授予 HR/ADMIN 角色（仅 ADMIN）' })
  async createGrant(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateRoleGrantDto,
  ) {
    const grant = await this.rbacService.createGrant({
      userOpenId: dto.userOpenId,
      role: dto.role,
      orgScope: dto.orgScope ?? [],
      grantedByOpenId: req.user.open_id,
    });
    await this.auditService.record({
      operatorOpenId: req.user.open_id,
      action: 'role_grant.create',
      targetType: 'role_grant',
      targetId: String(grant.id),
      after: grant,
    });
    return grant;
  }

  @Delete(':id')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '撤销角色授权（仅 ADMIN；物理删除并写审计）' })
  async removeGrant(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const grant = await this.rbacService.removeGrant(id);
    await this.auditService.record({
      operatorOpenId: req.user.open_id,
      action: 'role_grant.revoke',
      targetType: 'role_grant',
      targetId: String(id),
      before: grant,
    });
    return { ok: true };
  }
}
