import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('数据看板')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('dashboard/hr')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: 'HR 全局仪表盘（完成率/等级分布/状态分布）' })
  @ApiQuery({ name: 'cycle_id', required: false })
  hrDashboard(@Query('cycle_id') cycleId?: string) {
    return this.dashboardService.hrDashboard(
      cycleId ? Number(cycleId) : undefined,
    );
  }

  @Get('dashboard/team')
  @ApiOperation({ summary: 'Leader 团队看板（按 Leader 快照过滤）' })
  @ApiQuery({ name: 'cycle_id', required: false })
  teamDashboard(
    @Req() req: AuthenticatedRequest,
    @Query('cycle_id') cycleId?: string,
  ) {
    return this.dashboardService.teamDashboard(
      req.user.open_id,
      cycleId ? Number(cycleId) : undefined,
    );
  }

  @Get('profiles/:openId/performance')
  @ApiOperation({ summary: '个人绩效档案（本人/Leader/HR；仅归档结果）' })
  profile(@Req() req: AuthenticatedRequest, @Param('openId') openId: string) {
    return this.dashboardService.profile(req.user.open_id, openId);
  }

  @Get('workbench/todos')
  @ApiOperation({ summary: '工作台待办聚合' })
  myTodos(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.myTodos(req.user.open_id);
  }
}
