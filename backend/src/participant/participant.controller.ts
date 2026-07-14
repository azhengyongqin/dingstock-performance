import {
  Body,
  Controller,
  Delete,
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
import { ArrayNotEmpty, IsArray, IsBoolean, IsString } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { ParticipantService } from './participant.service';

class AddByOpenIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  openIds!: string[];
}

class AddByDepartmentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  departmentIds!: string[];
}

class UpdateParticipantDto {
  @IsBoolean()
  isPromotionEnabled!: boolean;
}

@ApiTags('participant')
@Controller('cycles/:cycleId/participants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class ParticipantController {
  constructor(private readonly participantService: ParticipantService) {}

  @Get()
  @ApiOperation({
    summary: '考核人员列表（含员工/Leader/部门主数据与各环节进度）',
  })
  list(@Param('cycleId', ParseIntPipe) cycleId: number) {
    return this.participantService.list(cycleId);
  }

  @Post()
  @ApiOperation({ summary: '按 open_id 名单批量添加考核人员（启动前）' })
  addByOpenIds(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Body() dto: AddByOpenIdsDto,
  ) {
    return this.participantService.addByOpenIds(
      req.user.open_id,
      cycleId,
      dto.openIds,
    );
  }

  @Post('by-departments')
  @ApiOperation({ summary: '按部门圈人（含子部门；启动前）' })
  addByDepartments(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Body() dto: AddByDepartmentsDto,
  ) {
    return this.participantService.addByDepartments(
      req.user.open_id,
      cycleId,
      dto.departmentIds,
    );
  }

  @Patch(':participantId')
  @ApiOperation({ summary: '更新参与者（是否参与晋升评估）' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Body() dto: UpdateParticipantDto,
  ) {
    return this.participantService.update(
      req.user.open_id,
      cycleId,
      participantId,
      dto.isPromotionEnabled,
    );
  }

  @Delete(':participantId')
  @ApiOperation({
    summary: '移除考核人员（启动前；ADMIN 进行中移除需 confirm=true 二次确认）',
  })
  @ApiQuery({ name: 'confirm', required: false, type: Boolean })
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Query('confirm') confirm?: string,
  ) {
    return this.participantService.remove(
      req.user.open_id,
      cycleId,
      participantId,
      confirm === 'true',
    );
  }
}
