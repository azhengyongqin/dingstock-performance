import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { AiReportService } from './ai-report.service';

/** AI 参考管理接口；对象级 Leader/HR 组织范围权限统一由 service 校验。 */
@ApiTags('AI报告')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('participants/:participantId/ai-report')
export class AiReportController {
  constructor(private readonly aiReportService: AiReportService) {}

  @Get()
  @ApiOperation({ summary: '当前 Leader 或授权 HR/Admin 查看 AI 参考报告' })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.aiReportService.getForManager(req.user.open_id, participantId);
  }

  @Post('generate')
  @ApiOperation({ summary: '按当前有效人工输入幂等排队 AI 报告' })
  generate(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.aiReportService.requestGeneration(
      req.user.open_id,
      participantId,
    );
  }

  @Post('retry')
  @ApiOperation({ summary: '人工重试失败的 AI 报告任务' })
  retry(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.aiReportService.retry(req.user.open_id, participantId);
  }
}
