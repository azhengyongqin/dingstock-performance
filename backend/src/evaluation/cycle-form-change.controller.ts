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
  ApplyCycleFormChangeDto,
  PreviewCycleFormChangeDto,
} from '../cycle/cycle.dto';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { CycleFormChangeService } from './cycle-form-change.service';

/** 周期表单结构变更 API：分类、影响确认与应用共用同一领域服务。 */
@ApiTags('cycle')
@Controller('cycles/:id/form-change')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class CycleFormChangeController {
  constructor(private readonly service: CycleFormChangeService) {}

  @Post('preview')
  @ApiOperation({ summary: '分类并预览周期表单变更及重新提交影响' })
  preview(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) cycleId: number,
    @Body() dto: PreviewCycleFormChangeDto,
  ) {
    return this.service.preview(req.user.open_id, cycleId, dto);
  }

  @Post('apply')
  @ApiOperation({ summary: '确认后应用周期表单文案或结构变更' })
  apply(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) cycleId: number,
    @Body() dto: ApplyCycleFormChangeDto,
  ) {
    return this.service.apply(req.user.open_id, cycleId, dto);
  }
}
