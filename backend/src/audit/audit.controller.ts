import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { AuditService } from './audit.service';

@ApiTags('审计日志')
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '查询操作日志（HR/ADMIN；后端分页）' })
  @ApiQuery({ name: 'target_type', required: false })
  @ApiQuery({ name: 'target_id', required: false })
  @ApiQuery({
    name: 'operator',
    required: false,
    description: '操作人 open_id',
  })
  @ApiQuery({
    name: 'action',
    required: false,
    description: '操作类型（模糊匹配）',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'page_size', required: false })
  list(
    @Query('target_type') targetType?: string,
    @Query('target_id') targetId?: string,
    @Query('operator') operator?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.auditService.list({
      targetType,
      targetId,
      operatorOpenId: operator,
      action,
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(200, Math.max(1, Number(pageSize) || 20)),
    });
  }
}
