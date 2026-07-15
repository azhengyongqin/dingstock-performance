import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import {
  BatchAddReviewersDto,
  ReplaceReviewerDto,
  UpsertReviewersDto,
} from './review.dto';
import { ReviewService } from './review.service';
import { ReviewerService } from './reviewer.service';

/** 评审员指派：数据范围（Leader/HR）在 service 层校验 */
@ApiTags('review')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ReviewController {
  constructor(
    private readonly reviewerService: ReviewerService,
    private readonly reviewService: ReviewService,
  ) {}

  // ---- 评审员指派 ----

  @Get('participants/:participantId/reviewers')
  @ApiOperation({ summary: '评审员指派列表 + 系统推荐（Leader/HR）' })
  listReviewers(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.reviewerService.listWithRecommendations(
      req.user.open_id,
      participantId,
    );
  }

  @Put('participants/:participantId/reviewers')
  @ApiOperation({ summary: '覆盖式指派评审员（Leader 指定 / HR 补充）' })
  upsertReviewers(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Body() dto: UpsertReviewersDto,
  ) {
    return this.reviewerService.upsertReviewers(
      req.user.open_id,
      participantId,
      dto.items,
      dto.knownAssignmentIds,
    );
  }

  @Post('participants/:participantId/reviewers/:assignmentId/replace')
  @ApiOperation({
    summary: '显式替换评审员（保留旧关系审计并撤销旧评审员权限）',
  })
  replaceReviewer(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
    @Param('assignmentId', ParseIntPipe) assignmentId: number,
    @Body() dto: ReplaceReviewerDto,
  ) {
    return this.reviewerService.replaceReviewer(
      req.user.open_id,
      participantId,
      assignmentId,
      dto,
    );
  }

  @Post('cycles/:cycleId/reviewers/batch')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: 'HR 批量为多个参与者补充评审员' })
  batchAddReviewers(
    @Req() req: AuthenticatedRequest,
    @Param('cycleId', ParseIntPipe) cycleId: number,
    @Body() dto: BatchAddReviewersDto,
  ) {
    return this.reviewerService.batchAdd(
      req.user.open_id,
      cycleId,
      dto.participantIds,
      dto.items,
    );
  }

  // ---- 评审任务（360° 与上级评估共用任务模型） ----

  @Get('review-tasks')
  @ApiOperation({ summary: '我的评审任务列表（360° + 上级评估）' })
  listMyTasks(@Req() req: AuthenticatedRequest) {
    return this.reviewService.listMyTasks(req.user.open_id);
  }
}
