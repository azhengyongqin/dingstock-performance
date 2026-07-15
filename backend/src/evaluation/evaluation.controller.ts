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
import { RolesGuard } from '../rbac/roles.guard';
import { SavePeerEvaluationDto, SaveSelfEvaluationDto } from './evaluation.dto';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { PeerEvaluationSubmissionService } from './peer-evaluation-submission.service';

/** 统一评估提交（ADR-0009）：当前开放员工自评；身份取自 JWT，对象级鉴权在 service 层 */
@ApiTags('evaluation')
@Controller('evaluations')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EvaluationController {
  constructor(
    private readonly evaluationSubmissionService: EvaluationSubmissionService,
    private readonly peerEvaluationSubmissionService: PeerEvaluationSubmissionService,
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
}
