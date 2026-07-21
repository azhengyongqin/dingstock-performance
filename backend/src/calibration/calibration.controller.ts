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
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  PerfCalibrationDecision,
  PerfRatingSymbol,
  PerfRole,
} from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { CalibrationService } from './calibration.service';
import { ResultService } from './result.service';
import { RedLineFindingService } from './red-line-finding.service';
import { CalibrationDecisionService } from './calibration-decision.service';

class CalibrationDecisionDto {
  @IsEnum(PerfCalibrationDecision)
  decision!: PerfCalibrationDecision;

  @IsOptional()
  @IsEnum(PerfRatingSymbol)
  afterLevel?: PerfRatingSymbol;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ValidateIf(
    (dto: CalibrationDecisionDto) => dto.expectedCalibrationRevision !== null,
  )
  @IsInt()
  expectedCalibrationRevision!: number | null;

  @IsString()
  @Length(64, 64)
  expectedInputRevision!: string;
}

class ConfirmRedLineDto {
  @IsString()
  @MaxLength(100)
  findingType!: string;

  @IsString()
  @MaxLength(2000)
  facts!: string;

  @IsDefined()
  evidence!: unknown;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

class RevokeRedLineDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

class PushResultsDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  participantIds?: number[];
}

class ConfirmCalibrationsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  participantIds!: number[];
}

class ConfirmResultDto {
  @IsInt()
  participantId!: number;

  @IsInt()
  resultVersionId!: number;
}

@ApiTags('绩效校准')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CalibrationController {
  constructor(
    private readonly calibrationService: CalibrationService,
    private readonly resultService: ResultService,
    private readonly redLineFindingService: RedLineFindingService,
    private readonly calibrationDecisionService: CalibrationDecisionService,
  ) {}

  // ---- 校准（当前 Leader / 授权 HR / Admin） ----

  @Get('cycles/:cycleId/calibrations')
  @ApiOperation({ summary: '校准工作台：参与者等级列表 + 分布对比' })
  list(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
  ) {
    return this.calibrationService.listForCycle(req.user.open_id, cycleId);
  }

  @Get('calibrations/:participantId/decision-context')
  @ApiOperation({
    summary: '读取逐员工校准上下文与乐观并发修订',
  })
  decisionContext(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.calibrationDecisionService.getContext(
      req.user.open_id,
      participantId,
    );
  }

  @Post('calibrations/:participantId/decision')
  @ApiOperation({ summary: '追加 KEEP / ADJUST 校准决定并首次锁定人工评估' })
  decide(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Body() dto: CalibrationDecisionDto,
  ) {
    return this.calibrationDecisionService.decide(
      req.user.open_id,
      participantId,
      dto,
    );
  }

  @Get('calibrations/:participantId/history')
  @ApiOperation({
    summary: '校准记录历史（当前 Leader / 授权 HR / Admin）',
  })
  history(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.calibrationService.getHistory(req.user.open_id, participantId);
  }

  @Post('calibrations/:participantId/red-lines')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: 'HR/Admin 确认红线并强制 MANAGER 阶段等级为 C' })
  confirmRedLine(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Body() dto: ConfirmRedLineDto,
  ) {
    return this.redLineFindingService.confirm(
      req.user.open_id,
      participantId,
      dto,
    );
  }

  @Post('calibrations/:participantId/red-lines/:findingId/revoke')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: 'HR/Admin 追加红线撤销事件' })
  revokeRedLine(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Param('findingId', ParseIntPipe) findingId: number,
    @Body() dto: RevokeRedLineDto,
  ) {
    return this.redLineFindingService.revoke(
      req.user.open_id,
      participantId,
      findingId,
      dto.reason,
    );
  }

  @Post('cycles/:cycleId/calibrations/confirm')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '批量确认校准并补齐显式 KEEP 决定' })
  confirmCalibrations(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Body() dto: ConfirmCalibrationsDto,
  ) {
    return this.calibrationDecisionService.confirmCycle(
      req.user.open_id,
      cycleId,
      dto.participantIds,
    );
  }

  @Post('cycles/:cycleId/results/push')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '发布不可变结果版本并通知员工确认' })
  pushResults(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Body() dto: PushResultsDto,
  ) {
    return this.resultService.publishCycle(
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
    return this.resultService.confirm(
      req.user.open_id,
      dto.participantId,
      dto.resultVersionId,
    );
  }
}
