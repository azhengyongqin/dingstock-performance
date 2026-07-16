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
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { ParticipantService } from './participant.service';
import { ParticipantNoResultService } from './participant-no-result.service';

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

class ParticipantReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

@ApiTags('考核人员')
@Controller('cycles/:cycleId/participants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class ParticipantController {
  constructor(
    private readonly participantService: ParticipantService,
    private readonly participantNoResultService: ParticipantNoResultService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '考核人员列表（含员工/Leader/部门主数据与各环节进度）',
  })
  list(@Param('cycleId', ParseIntPipe) cycleId: number) {
    return this.participantService.list(cycleId);
  }

  @Post()
  @ApiOperation({ summary: '按 open_id 名单批量添加考核人员（含进行中补加）' })
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
  @ApiOperation({ summary: '按部门圈人（含子部门与进行中补加）' })
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

  @Post(':participantId/no-result')
  @ApiOperation({
    summary: '因始终缺失员工自评，标记为当前周期无绩效结果',
  })
  markNoResult(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Body() dto: ParticipantReasonDto,
  ) {
    return this.participantNoResultService.markNoResult(
      req.user.open_id,
      cycleId,
      participantId,
      dto.reason,
    );
  }

  @Post(':participantId/no-result/revoke')
  @ApiOperation({ summary: '归档前撤销当前周期无绩效结果并恢复参评' })
  revokeNoResult(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Body() dto: ParticipantReasonDto,
  ) {
    return this.participantNoResultService.revokeNoResult(
      req.user.open_id,
      cycleId,
      participantId,
      dto.reason,
    );
  }
}
