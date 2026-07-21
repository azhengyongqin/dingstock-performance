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
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfInterviewStatus } from '../generated/prisma/enums';
import { RolesGuard } from '../rbac/roles.guard';
import { InterviewService } from './interview.service';

class ScheduleInterviewDto {
  @IsInt()
  participantId!: number;

  @IsString()
  scheduledStartAt!: string;

  @IsString()
  scheduledEndAt!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  extraAttendeeOpenIds?: string[];

  @IsOptional()
  @IsInt()
  appealId?: number;
}

class RescheduleInterviewDto {
  @IsString()
  scheduledStartAt!: string;

  @IsString()
  scheduledEndAt!: string;
}

class NotesDto {
  @IsString()
  @MaxLength(5000)
  resultNotes!: string;
}

@ApiTags('面谈')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class InterviewController {
  constructor(private readonly interviewService: InterviewService) {}

  @Get('interviews')
  @ApiOperation({ summary: '面谈列表（Leader/HR/Admin，含纪要）' })
  @ApiQuery({ name: 'status', required: false, enum: PerfInterviewStatus })
  list(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: PerfInterviewStatus,
  ) {
    return this.interviewService.listForManager(req.user.open_id, { status });
  }

  @Get('interviews/mine')
  @ApiOperation({ summary: '员工本人面谈预约（不含纪要）' })
  listMine(@Req() req: AuthenticatedRequest) {
    return this.interviewService.listMine(req.user.open_id);
  }

  @Get('interviews/:id')
  @ApiOperation({ summary: '面谈详情（管理侧，含纪要）' })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.interviewService.getForManager(req.user.open_id, id);
  }

  @Post('interviews')
  @ApiOperation({ summary: '预约面谈（创建飞书日程）' })
  schedule(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ScheduleInterviewDto,
  ) {
    return this.interviewService.schedule(req.user.open_id, dto);
  }

  @Patch('interviews/:id/schedule')
  @ApiOperation({ summary: '改期（同步飞书日程）' })
  reschedule(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RescheduleInterviewDto,
  ) {
    return this.interviewService.reschedule(req.user.open_id, id, dto);
  }

  @Post('interviews/:id/cancel')
  @ApiOperation({ summary: '取消面谈（同步取消飞书日程）' })
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.interviewService.cancel(req.user.open_id, id);
  }

  @Post('interviews/:id/complete')
  @ApiOperation({ summary: '完成面谈并填写结果纪要' })
  complete(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NotesDto,
  ) {
    return this.interviewService.complete(
      req.user.open_id,
      id,
      dto.resultNotes,
    );
  }

  @Patch('interviews/:id/notes')
  @ApiOperation({ summary: '更新已完成面谈的结果纪要' })
  updateNotes(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NotesDto,
  ) {
    return this.interviewService.updateNotes(
      req.user.open_id,
      id,
      dto.resultNotes,
    );
  }
}
