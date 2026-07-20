import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { ListLegacyPromotionArchivesDto } from './legacy-promotion-archive.dto';
import { LegacyPromotionArchiveService } from './legacy-promotion-archive.service';

@ApiTags('旧晋升归档')
@Controller('legacy-promotion-archives')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class LegacyPromotionArchiveController {
  constructor(private readonly service: LegacyPromotionArchiveService) {}

  @Get()
  @ApiOperation({ summary: '分页查看旧晋升答案只读归档（HR/ADMIN）' })
  list(@Query() query: ListLegacyPromotionArchivesDto) {
    return this.service.list({
      page: query.page,
      pageSize: query.page_size,
      cycleId: query.cycle_id,
      sourceType: query.source_type,
    });
  }
}
