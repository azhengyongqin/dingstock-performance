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
  CalculateConfigTemplatePreviewDto,
  CreateConfigTemplateDto,
  ReplaceConfigTemplateDraftDto,
} from './config-template.dto';
import { ConfigTemplateService } from './config-template.service';

@ApiTags('config-template')
@Controller('config-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class ConfigTemplateController {
  constructor(private readonly configTemplateService: ConfigTemplateService) {}

  @Get()
  @ApiOperation({ summary: '查看可见的配置模板版本' })
  list(@Req() request: AuthenticatedRequest) {
    return this.configTemplateService.listConfigTemplates(request.user.open_id);
  }

  @Post()
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '创建配置模板及首个草稿版本' })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateConfigTemplateDto,
  ) {
    return this.configTemplateService.createConfigTemplate(
      request.user.open_id,
      dto,
    );
  }

  @Get(':templateId/versions')
  @ApiOperation({ summary: '查看配置模板的可见版本历史' })
  listVersions(
    @Req() request: AuthenticatedRequest,
    @Param('templateId', ParseIntPipe) templateId: number,
  ) {
    return this.configTemplateService.listTemplateVersions(
      request.user.open_id,
      templateId,
    );
  }

  @Get('versions/:versionId')
  @ApiOperation({ summary: '查看配置模板版本详情、绑定与不可用原因' })
  detail(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.configTemplateService.getVersion(
      request.user.open_id,
      versionId,
    );
  }

  @Put('versions/:versionId')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '整体覆盖配置模板草稿' })
  replaceDraft(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body() dto: ReplaceConfigTemplateDraftDto,
  ) {
    return this.configTemplateService.replaceDraftContent(
      request.user.open_id,
      versionId,
      dto,
    );
  }

  @Post('versions/:versionId/validate')
  @ApiOperation({ summary: '返回配置模板版本的全部发布校验问题' })
  validate(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.configTemplateService.validateVersion(
      request.user.open_id,
      versionId,
    );
  }

  @Post('versions/:versionId/publish')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '原子校验并发布配置模板草稿' })
  publish(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.configTemplateService.publishVersion(
      request.user.open_id,
      versionId,
    );
  }

  @Post('versions/:versionId/new-draft')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '从已发布配置版本深复制新草稿' })
  newDraft(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.configTemplateService.createDraftFromVersion(
      request.user.open_id,
      versionId,
    );
  }

  @Post('versions/:versionId/archive')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '归档已发布配置模板版本' })
  archive(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.configTemplateService.archiveVersion(
      request.user.open_id,
      versionId,
    );
  }

  @Post('versions/:versionId/calculation-preview')
  @ApiOperation({ summary: '使用共享计算引擎预览阶段结果' })
  calculationPreview(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body() dto: CalculateConfigTemplatePreviewDto,
  ) {
    return this.configTemplateService.calculatePreview(
      request.user.open_id,
      versionId,
      dto,
    );
  }
}
