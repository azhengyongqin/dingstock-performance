import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ApplyActiveCycleConfigDto,
  PreviewActiveCycleConfigDto,
} from '../cycle/cycle.dto';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { ActiveCycleConfigChangeService } from './active-cycle-config-change.service';

/**
 * 路由仍归属 cycles，但 provider 放在 EvaluationModule，复用 PEER/MANAGER 重算服务，
 * 避免 CycleModule 与 EvaluationModule 形成循环依赖。
 */
@ApiTags('绩效周期')
@Controller('cycles/:id/active-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class ActiveCycleConfigChangeController {
  constructor(private readonly service: ActiveCycleConfigChangeService) {}

  @Post('preview')
  @ApiOperation({ summary: '预览活动周期计算配置修改的重算与人工结果保护范围' })
  preview(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) cycleId: number,
    @Body() dto: PreviewActiveCycleConfigDto,
  ) {
    return this.service.preview(req.user.open_id, cycleId, dto);
  }

  @Post('apply')
  @ApiOperation({ summary: '确认后创建新周期配置版本并原子统一重算' })
  apply(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) cycleId: number,
    @Body() dto: ApplyActiveCycleConfigDto,
  ) {
    return this.service.apply(req.user.open_id, cycleId, dto);
  }
}
