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
  CreateTemplateDto,
  UpdateTemplateDto,
  UpsertDimensionsDto,
} from './cycle.dto';
import { TemplateService } from './template.service';

@ApiTags('template')
@Controller('templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Get()
  @ApiOperation({ summary: '模板列表' })
  list() {
    return this.templateService.listTemplates();
  }

  @Post()
  @ApiOperation({ summary: '创建配置模板（评分规则部分）' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTemplateDto) {
    return this.templateService.createTemplate(req.user.open_id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '模板详情（含维度项）' })
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.templateService.getTemplate(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新模板；不影响已用该模板创建的周期' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templateService.updateTemplate(req.user.open_id, id, dto);
  }

  @Put(':id/dimensions')
  @ApiOperation({ summary: '整体维护模板维度项' })
  upsertDimensions(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertDimensionsDto,
  ) {
    return this.templateService.upsertDimensions(req.user.open_id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除模板（软删除；已创建的周期不受影响）' })
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.templateService.deleteTemplate(req.user.open_id, id);
  }
}
