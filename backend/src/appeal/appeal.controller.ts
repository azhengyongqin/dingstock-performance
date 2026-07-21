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
import { PerfAppealStatus } from '../generated/prisma/enums';
import { RolesGuard } from '../rbac/roles.guard';
import { AppealService } from './appeal.service';

class CreateAppealDto {
  @IsInt()
  participantId!: number;

  @IsInt()
  resultVersionId!: number;

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

class ResolveAppealDto {
  @IsString()
  @MaxLength(1000)
  conclusion!: string;

  @IsInt()
  expectedCalibrationRevision!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('申诉')
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
      dto.participantId,
      dto.resultVersionId,
      dto.reason,
      dto.attachments,
    );
  }

  @Get('appeals')
  @ApiOperation({ summary: '申诉列表（当前 Leader / 授权 HR / Admin）' })
  @ApiQuery({ name: 'cycle_id', required: false })
  @ApiQuery({ name: 'status', required: false, enum: PerfAppealStatus })
  list(
    @Req() req: AuthenticatedRequest,
    @Query('cycle_id') cycleId?: string,
    @Query('status') status?: PerfAppealStatus,
  ) {
    return this.appealService.list(req.user.open_id, {
      cycleId: cycleId ? Number(cycleId) : undefined,
      status,
    });
  }

  @Get('appeals/:id')
  @ApiOperation({
    summary: '申诉详情（本人、当前 Leader、授权 HR/Admin）',
  })
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.appealService.detail(req.user.open_id, id);
  }

  @Patch('appeals/:id')
  @ApiOperation({ summary: '指派申诉处理人' })
  assign(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignAppealDto,
  ) {
    return this.appealService.assign(req.user.open_id, id, dto.handlerOpenId);
  }

  @Post('appeals/:id/resolve')
  @ApiOperation({
    summary: '关闭申诉（改判须先在校准工作台追加显式决定）',
  })
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveAppealDto,
  ) {
    return this.appealService.resolve(req.user.open_id, id, dto);
  }
}
