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
  ApplyTemplateDto,
  CreateCycleDto,
  InitializeCycleSetupDto,
  ReapplyCycleSetupDto,
  UpdateCycleAdvancedConfigDto,
  UpdateCycleDto,
  UpsertDimensionsDto,
  UpsertCyclePlanDto,
  UpsertNotificationRulesDto,
  UpsertEvaluationRuleDto,
  UpsertWindowsDto,
} from './cycle.dto';
import { CycleService } from './cycle.service';
import { CycleSetupService } from './cycle-setup.service';
import { CycleProgressService } from './cycle-progress.service';

// 周期管理为 HR/ADMIN 专属操作域（产品 §3.7）；员工/评审员侧走 self-reviews、review-tasks 等接口
@ApiTags('cycle')
@Controller('cycles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class CycleController {
  constructor(
    private readonly cycleService: CycleService,
    private readonly cycleSetupService: CycleSetupService,
    private readonly cycleProgressService: CycleProgressService,
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

  @Post(':id/config-snapshot/initialize')
  @ApiOperation({ summary: '为迁移后的旧草稿原子初始化配置与表单快照' })
  initializeConfigSnapshot(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InitializeCycleSetupDto,
  ) {
    return this.cycleSetupService.initializeLegacyDraft(
      req.user.open_id,
      id,
      dto,
    );
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

  @Put(':id/evaluation-rule')
  @ApiOperation({ summary: '配置评估规则（启动前）' })
  upsertEvaluationRule(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertEvaluationRuleDto,
  ) {
    return this.cycleService.upsertEvaluationRule(req.user.open_id, id, dto);
  }

  @Put(':id/dimensions')
  @ApiOperation({
    summary: '整体维护评估维度（带 id 更新/不带新增/缺席软删；启动前）',
  })
  upsertDimensions(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertDimensionsDto,
  ) {
    return this.cycleService.upsertDimensions(req.user.open_id, id, dto);
  }

  @Post(':id/apply-template')
  @ApiOperation({
    summary: '启动前重新套用模板：整体覆盖评估规则与评估维度',
  })
  applyTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyTemplateDto,
  ) {
    return this.cycleService.applyTemplate(req.user.open_id, id, dto);
  }

  @Put(':id/windows')
  @ApiOperation({ summary: '配置/调整时间窗口（启动后调整=延长窗口，写审计）' })
  updateWindows(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertWindowsDto,
  ) {
    return this.cycleService.updateWindows(req.user.open_id, id, dto.windows);
  }

  @Put(':id/notification-rules')
  @ApiOperation({ summary: '配置催办/通知规则' })
  updateNotificationRules(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertNotificationRulesDto,
  ) {
    return this.cycleService.updateNotificationRules(
      req.user.open_id,
      id,
      dto.notificationRules,
    );
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

  @Post(':id/close')
  @ApiOperation({ summary: '归档周期：参与者与结果全部落 archived' })
  close(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cycleService.closeCycle(req.user.open_id, id);
  }
}
