import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { CalibrationService } from './calibration.service';
import { ResultService } from './result.service';

class AdjustDto {
  @IsString()
  afterLevel!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

class ConfirmDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  participantIds!: number[];
}

class PushResultsDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  participantIds?: number[];
}

class ConfirmResultDto {
  @IsInt()
  cycleId!: number;
}

@ApiTags('calibration')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CalibrationController {
  constructor(
    private readonly calibrationService: CalibrationService,
    private readonly resultService: ResultService,
  ) {}

  // ---- 校准（HR/ADMIN） ----

  @Get('cycles/:cycleId/calibrations')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '校准工作台：参与者等级列表 + 分布对比' })
  list(@Param('cycleId', ParseIntPipe) cycleId: number) {
    return this.calibrationService.listForCycle(cycleId);
  }

  @Post('calibrations/:participantId/adjust')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '校准调整（append-only，必填原因）' })
  adjust(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Body() dto: AdjustDto,
  ) {
    return this.calibrationService.adjust(
      req.user.open_id,
      participantId,
      dto.afterLevel,
      dto.reason,
    );
  }

  @Get('calibrations/:participantId/history')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '校准记录历史' })
  history(@Param('participantId', ParseIntPipe) participantId: number) {
    return this.calibrationService.history(participantId);
  }

  @Post('cycles/:cycleId/calibrations/confirm')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '批量确认校准（参与者 → CALIBRATED）' })
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Body() dto: ConfirmDto,
  ) {
    return this.calibrationService.confirm(
      req.user.open_id,
      cycleId,
      dto.participantIds,
    );
  }

  @Post('cycles/:cycleId/results/push')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '推送结果给员工确认（生成 perf_results + 通知）' })
  pushResults(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Body() dto: PushResultsDto,
  ) {
    return this.calibrationService.pushResults(
      req.user.open_id,
      cycleId,
      dto.participantIds,
    );
  }

  // ---- 结果（员工侧） ----

  @Get('results/current')
  @ApiOperation({ summary: '我的绩效结果（结果推送后可见）' })
  @ApiQuery({ name: 'cycle_id', required: false })
  getCurrent(
    @Req() req: AuthenticatedRequest,
    @Query('cycle_id') cycleId?: string,
  ) {
    return this.resultService.getCurrent(
      req.user.open_id,
      cycleId ? Number(cycleId) : undefined,
    );
  }

  @Post('results/current/confirm')
  @ApiOperation({ summary: '确认我的绩效结果（与申诉互斥）' })
  confirmResult(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmResultDto,
  ) {
    return this.resultService.confirm(req.user.open_id, dto.cycleId);
  }
}
