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
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { OkrReadService } from './okr-read.service';
import { OkrSyncService } from './okr-sync.service';

@ApiTags('飞书 OKR')
@Controller('okr')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class OkrController {
  constructor(
    private readonly okrSyncService: OkrSyncService,
    private readonly okrReadService: OkrReadService,
  ) {}

  @Get('participants/:participantId')
  @ApiOperation({
    summary: '读取评估参与者的本地 OKR 快照与单人同步状态',
  })
  getParticipantOkr(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.okrReadService.getParticipantOkr(
      req.user.open_id,
      participantId,
    );
  }

  @Post('participants/:participantId/sync')
  @ApiOperation({
    summary: '异步刷新评估参与者的飞书 OKR（本人/有效评审员/当前 Leader）',
  })
  async triggerParticipantSync(
    @Req() req: AuthenticatedRequest,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    const status = await this.okrReadService.triggerParticipantSync(
      req.user.open_id,
      participantId,
    );
    return { ok: true, ...status };
  }

  @Post('sync')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '触发飞书 OKR v2 全量同步（异步执行；HR/ADMIN）' })
  async triggerSync() {
    const status = await this.okrSyncService.triggerSync();
    return { ok: true, ...status };
  }

  @Get('sync/status')
  @ApiOperation({ summary: '查询飞书 OKR 同步任务状态' })
  getSyncStatus() {
    return this.okrSyncService.getStatus();
  }
}
