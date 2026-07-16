import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { CutoverMonitoringService } from './cutover-monitoring.service';
import { SkipPerformanceCutoverGate } from './performance-cutover.decorator';

@ApiTags('绩效切换监控')
@ApiBearerAuth()
@SkipPerformanceCutoverGate()
@Controller('performance-cutover')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
export class CutoverMonitoringController {
  constructor(private readonly service: CutoverMonitoringService) {}

  @Get('status')
  @ApiOperation({ summary: '查询新绩效模型切换门禁与分类监控状态' })
  status() {
    return this.service.getStatus();
  }
}
