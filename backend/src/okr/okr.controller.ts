import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { OkrSyncService } from './okr-sync.service';

@ApiTags('飞书 OKR')
@Controller('okr')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class OkrController {
  constructor(private readonly okrSyncService: OkrSyncService) {}

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
