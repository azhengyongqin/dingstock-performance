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
  AdvanceCycleDto,
  ApplyTemplateDto,
  CreateCycleDto,
  UpdateCycleDto,
  UpsertDimensionsDto,
  UpsertNotificationRulesDto,
  UpsertScoringRuleDto,
  UpsertWindowsDto,
} from './cycle.dto';
import { CycleService } from './cycle.service';

// 周期管理为 HR/ADMIN 专属操作域（产品 §3.7）；员工/评审员侧走 self-reviews、review-tasks 等接口
@ApiTags('cycle')
@Controller('cycles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class CycleController {
  constructor(private readonly cycleService: CycleService) {}

  @Get()
  @ApiOperation({ summary: '周期列表（可按状态过滤）' })
  @ApiQuery({ name: 'status', required: false, enum: PerfCycleStatus })
  list(@Query('status') status?: PerfCycleStatus) {
    return this.cycleService.listCycles(status);
  }

  @Post()
  @ApiOperation({ summary: '创建周期（可从模板复制评分规则与维度集）' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCycleDto) {
    return this.cycleService.createCycle(req.user.open_id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '周期详情（含评分规则、维度、人数）' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.cycleService.getCycle(id);
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

  @Put(':id/scoring-rule')
  @ApiOperation({ summary: '配置评分规则（启动前）' })
  upsertScoringRule(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertScoringRuleDto,
  ) {
    return this.cycleService.upsertScoringRule(req.user.open_id, id, dto);
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
    summary: '启动前重新套用模板：整体覆盖评分规则与评估维度',
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
    return this.cycleService.startCheck(id);
  }

  @Post(':id/start')
  @ApiOperation({
    summary: '启动周期：写参与者快照、生成启动通知、进入自评阶段',
  })
  start(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cycleService.startCycle(req.user.open_id, id);
  }

  @Post(':id/advance')
  @ApiOperation({ summary: '推进周期阶段（合法流转由状态机校验）' })
  advance(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdvanceCycleDto,
  ) {
    return this.cycleService.advanceCycle(req.user.open_id, id, dto);
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
