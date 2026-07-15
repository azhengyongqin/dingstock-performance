import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfAppealStatus, PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { AppealService } from './appeal.service';

class CreateAppealDto {
  @IsInt()
  cycleId!: number;

  @IsString()
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  attachments?: Record<string, unknown>[];
}

class AssignAppealDto {
  @IsString()
  handlerOpenId!: string;
}

class InterviewDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantOpenIds?: string[];

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  employeeFeedback?: string;

  @IsOptional()
  @IsString()
  conclusion?: string;
}

class ResolveAppealDto {
  @IsString()
  @MaxLength(1000)
  conclusion!: string;

  /** 需要调整结果时给出新等级；同时必须填 reason */
  @IsOptional()
  @IsString()
  adjustedLevel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('appeal')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AppealController {
  constructor(private readonly appealService: AppealService) {}

  @Post('appeals')
  @ApiOperation({ summary: '员工发起申诉（与结果确认互斥）' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateAppealDto) {
    return this.appealService.create(
      req.user.open_id,
      dto.cycleId,
      dto.reason,
      dto.attachments,
    );
  }

  @Get('appeals')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '申诉列表（HR）' })
  @ApiQuery({ name: 'cycle_id', required: false })
  @ApiQuery({ name: 'status', required: false, enum: PerfAppealStatus })
  list(
    @Query('cycle_id') cycleId?: string,
    @Query('status') status?: PerfAppealStatus,
  ) {
    return this.appealService.list({
      cycleId: cycleId ? Number(cycleId) : undefined,
      status,
    });
  }

  @Get('appeals/:id')
  @ApiOperation({ summary: '申诉详情（本人或 HR；含面谈与校准历史）' })
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.appealService.detail(req.user.open_id, id);
  }

  @Patch('appeals/:id')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '指派申诉处理人' })
  assign(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignAppealDto,
  ) {
    return this.appealService.assign(req.user.open_id, id, dto.handlerOpenId);
  }

  @Post('appeals/:id/interviews')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '添加申诉面谈记录' })
  addInterview(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InterviewDto,
  ) {
    return this.appealService.addInterview(req.user.open_id, id, dto);
  }

  @Post('appeals/:id/resolve')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({
    summary: '申诉处理结论（等级调整须先在校准工作台创建显式决定）',
  })
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveAppealDto,
  ) {
    return this.appealService.resolve(req.user.open_id, id, dto);
  }

  @Post('participants/:participantId/interviews')
  @ApiOperation({ summary: '选择性面谈记录（Leader/HR）' })
  addOptionalInterview(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Body() dto: InterviewDto,
  ) {
    return this.appealService.addOptionalInterview(
      req.user.open_id,
      participantId,
      dto,
    );
  }
}
