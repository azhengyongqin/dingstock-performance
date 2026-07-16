import {
  Body,
  Controller,
  Get,
  ParseIntPipe,
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
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import {
  SaveManagerEvaluationDto,
  SavePeerEvaluationDto,
  SaveSelfEvaluationDto,
  TransferManagerResponsibilityDto,
} from './evaluation.dto';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { ManagerEvaluationSubmissionService } from './manager-evaluation-submission.service';
import { LeaderTransferService } from './leader-transfer.service';
import { PeerEvaluationSubmissionService } from './peer-evaluation-submission.service';
import { PeerStageResultService } from './peer-stage-result.service';

/** 统一评估提交（ADR-0009）：当前开放员工自评；身份取自 JWT，对象级鉴权在 service 层 */
@ApiTags('评估')
@Controller('evaluations')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EvaluationController {
  constructor(
    private readonly evaluationSubmissionService: EvaluationSubmissionService,
    private readonly peerEvaluationSubmissionService: PeerEvaluationSubmissionService,
    private readonly peerStageResultService: PeerStageResultService,
    private readonly managerEvaluationSubmissionService: ManagerEvaluationSubmissionService,
    private readonly leaderTransferService: LeaderTransferService,
  ) {}

  @Get('self')
  @ApiOperation({
    summary:
      '我的自评上下文（任务开放状态/表单快照内容/生效与草稿明细/状态标记）',
  })
  @ApiQuery({ name: 'cycleId', required: false })
  getSelfContext(
    @Req() req: AuthenticatedRequest,
    @Query('cycleId') cycleId?: string,
  ) {
    return this.evaluationSubmissionService.getSelfContext(
      req.user.open_id,
      cycleId ? Number(cycleId) : undefined,
    );
  }

  @Put('self/draft')
  @ApiOperation({ summary: '保存自评草稿（允许不完整，整体替换草稿明细）' })
  saveSelfDraft(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SaveSelfEvaluationDto,
  ) {
    return this.evaluationSubmissionService.saveSelfDraft(
      req.user.open_id,
      dto,
    );
  }

  @Post('self/submit')
  @ApiOperation({
    summary: '提交自评（完整性校验后原子替换生效明细并删除草稿）',
  })
  submitSelf(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SaveSelfEvaluationDto,
  ) {
    return this.evaluationSubmissionService.submitSelf(req.user.open_id, dto);
  }

  @Get('peer')
  @ApiOperation({
    summary: '我的 360°评估上下文（仅有效指派与 PEER 动态子表单）',
  })
  @ApiQuery({ name: 'assignmentId', required: true })
  getPeerContext(
    @Req() req: AuthenticatedRequest,
    @Query('assignmentId', ParseIntPipe) assignmentId: number,
  ) {
    return this.peerEvaluationSubmissionService.getPeerContext(
      req.user.open_id,
      assignmentId,
    );
  }

  @Put('peer/draft')
  @ApiOperation({ summary: '保存 360°评估更新草稿（允许不完整）' })
  savePeerDraft(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SavePeerEvaluationDto,
  ) {
    return this.peerEvaluationSubmissionService.savePeerDraft(
      req.user.open_id,
      dto,
    );
  }

  @Post('peer/submit')
  @ApiOperation({
    summary: '提交/重新提交 360°评估（原子替换当前生效答卷）',
  })
  submitPeer(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SavePeerEvaluationDto,
  ) {
    return this.peerEvaluationSubmissionService.submitPeer(
      req.user.open_id,
      dto,
    );
  }

  @Get('peer/result')
  @ApiOperation({
    summary: '查看当前 360°阶段结果及关系/维度计算明细（Leader/授权 HR）',
  })
  @ApiQuery({ name: 'participantId', required: true })
  getPeerStageResult(
    @Req() req: AuthenticatedRequest,
    @Query('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.peerStageResultService.getForManager(
      req.user.open_id,
      participantId,
    );
  }

  @Get('manager')
  @ApiOperation({
    summary: '当前 Leader 的上级评估上下文（动态表单、自评与 360°参考）',
  })
  @ApiQuery({ name: 'participantId', required: true })
  getManagerContext(
    @Req() req: AuthenticatedRequest,
    @Query('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.managerEvaluationSubmissionService.getManagerContext(
      req.user.open_id,
      participantId,
    );
  }

  @Put('manager/draft')
  @ApiOperation({ summary: '保存上级评估更新草稿（允许不完整）' })
  saveManagerDraft(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SaveManagerEvaluationDto,
  ) {
    return this.managerEvaluationSubmissionService.saveManagerDraft(
      req.user.open_id,
      dto,
    );
  }

  @Post('manager/submit')
  @ApiOperation({
    summary: '提交/重新提交上级评估并计算校准前权威阶段等级',
  })
  submitManager(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SaveManagerEvaluationDto,
  ) {
    return this.managerEvaluationSubmissionService.submitManager(
      req.user.open_id,
      dto,
    );
  }

  @Post('manager/transfer')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({
    summary: 'HR/Admin 显式转移考核 Leader 职责（必填原因与预期原负责人）',
  })
  transferManagerResponsibility(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TransferManagerResponsibilityDto,
  ) {
    return this.leaderTransferService.transfer(req.user.open_id, dto);
  }

  @Get('manager/result')
  @ApiOperation({ summary: '当前 Leader 查看上级评估权威阶段结果' })
  @ApiQuery({ name: 'participantId', required: true })
  getManagerStageResult(
    @Req() req: AuthenticatedRequest,
    @Query('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.managerEvaluationSubmissionService.getManagerResult(
      req.user.open_id,
      participantId,
    );
  }
}
