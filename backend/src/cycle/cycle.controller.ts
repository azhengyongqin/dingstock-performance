import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
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
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfCycleStatus, PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import {
  ApplyActiveCycleRollbackDto,
  ArchiveCycleDto,
  CreateCycleDto,
  ReapplyCycleSetupDto,
  UpdateCycleAdvancedConfigDto,
  UpdateCycleDto,
  PreviewActiveCycleRollbackDto,
  UpsertCyclePlanDto,
} from './cycle.dto';
import { CycleService } from './cycle.service';
import { CycleSetupService } from './cycle-setup.service';
import { CycleProgressService } from './cycle-progress.service';
import { ActiveCycleRollbackService } from './active-cycle-rollback.service';
import { CycleArchiveService } from './cycle-archive.service';

// 周期管理为 HR/ADMIN 专属操作域（产品 §3.7）；员工/评审员侧走 self-reviews、review-tasks 等接口
@ApiTags('绩效周期')
@Controller('cycles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class CycleController {
  constructor(
    private readonly cycleService: CycleService,
    private readonly cycleSetupService: CycleSetupService,
    private readonly cycleProgressService: CycleProgressService,
    private readonly activeCycleRollbackService: ActiveCycleRollbackService,
    private readonly cycleArchiveService: CycleArchiveService,
  ) {}

  @Get()
  @ApiOperation({ summary: '周期列表（可按状态过滤）' })
  @ApiQuery({ name: 'status', required: false, enum: PerfCycleStatus })
  list(@Query('status') status?: PerfCycleStatus) {
    return this.cycleService.listCycles(status);
  }

  @Post()
  @ApiOperation({ summary: '从已发布配置版本创建周期并固化完整快照' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCycleDto) {
    return this.cycleSetupService.createFromPublishedConfig(
      req.user.open_id,
      dto,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '周期详情（含评估规则、维度、人数）' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.cycleService.getCycle(id);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: '按任务与参与人事实聚合周期进度和下一步操作' })
  progress(@Param('id', ParseIntPipe) id: number) {
    return this.cycleProgressService.getProgress(id);
  }

  @Get(':id/config-snapshot')
  @ApiOperation({ summary: '读取周期独立配置与 D/M 表单快照' })
  configSnapshot(@Param('id', ParseIntPipe) id: number) {
    return this.cycleSetupService.getConfigSnapshot(id);
  }

  @Post(':id/config-snapshot/reapply')
  @ApiOperation({ summary: '启动前重新套用已发布配置模板版本' })
  reapplyConfigSnapshot(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReapplyCycleSetupDto,
  ) {
    return this.cycleSetupService.reapplyPublishedConfig(
      req.user.open_id,
      id,
      dto,
    );
  }

  @Put(':id/config-snapshot')
  @ApiOperation({ summary: '调整周期自己的评级、约束与关系权重快照' })
  updateConfigSnapshot(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCycleAdvancedConfigDto,
  ) {
    return this.cycleSetupService.updateAdvancedConfig(
      req.user.open_id,
      id,
      dto,
    );
  }

  @Get(':id/participants/prefix-check')
  @ApiOperation({ summary: '检查每名参与人的 D/M 职级与唯一表单匹配' })
  participantPrefixCheck(@Param('id', ParseIntPipe) id: number) {
    return this.cycleSetupService.getParticipantPrefixCheck(id);
  }

  @Get(':id/plan')
  @ApiOperation({ summary: '读取基于计划启动时间生成的三阶段实际计划' })
  plan(@Param('id', ParseIntPipe) id: number) {
    return this.cycleSetupService.getPlan(id);
  }

  @Put(':id/plan')
  @ApiOperation({ summary: '调整三阶段计划与通知规则' })
  updatePlan(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertCyclePlanDto,
  ) {
    return this.cycleSetupService.updatePlan(req.user.open_id, id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新周期基础信息（启动前）' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCycleDto,
  ) {
    return this.cycleService.updateCycle(req.user.open_id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除周期（仅 DRAFT，软删除）' })
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cycleService.deleteCycle(req.user.open_id, id);
  }

  @Get(':id/start-check')
  @ApiOperation({ summary: '启动前完整性检查（人员/规则/维度权重/窗口）' })
  startCheck(@Param('id', ParseIntPipe) id: number) {
    return this.cycleSetupService.startCheck(id);
  }

  @Post(':id/schedule')
  @ApiOperation({ summary: '检查通过后设为待启动；不提前创建评估任务' })
  schedule(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cycleSetupService.schedule(req.user.open_id, id);
  }

  @Post(':id/return-to-draft')
  @ApiOperation({ summary: '把待启动周期退回草稿继续调整' })
  returnToDraft(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cycleSetupService.returnToDraft(req.user.open_id, id);
  }

  @Post(':id/rollback/preview')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '超级管理员预览活动周期整体退回影响' })
  previewRollback(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PreviewActiveCycleRollbackDto,
  ) {
    return this.activeCycleRollbackService.preview(
      req.user.open_id,
      id,
      dto.targetStatus,
    );
  }

  @Post(':id/rollback')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '超级管理员确认后整体退回活动周期' })
  rollback(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyActiveCycleRollbackDto,
  ) {
    return this.activeCycleRollbackService.rollback(req.user.open_id, id, dto);
  }

  @Get(':id/archive-preview')
  @ApiOperation({ summary: '查看周期关闭统计与逐参与者归档阻塞明细' })
  previewArchive(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cycleArchiveService.preview(req.user.open_id, id);
  }

  @Post(':id/archive')
  @ApiOperation({ summary: '确认全员收口摘要后永久归档周期' })
  archive(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ArchiveCycleDto,
  ) {
    return this.cycleArchiveService.archive(req.user.open_id, id, dto);
  }
}
