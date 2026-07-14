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
  AnalyzeFormTemplatePrefixCoverageDto,
  CreateFormTemplateDto,
  ReplaceFormTemplateDraftDto,
} from './form-template.dto';
import { FormTemplateService } from './form-template.service';

@ApiTags('form-template')
@Controller('form-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class FormTemplateController {
  constructor(private readonly formTemplateService: FormTemplateService) {}

  @Get()
  @ApiOperation({ summary: '查看可见的评估表单模板版本' })
  list(@Req() request: AuthenticatedRequest) {
    return this.formTemplateService.listFormTemplates(request.user.open_id);
  }

  @Post('prefix-coverage')
  @ApiOperation({ summary: '分析一组已发布表单版本的 D/M 前缀覆盖' })
  analyzePrefixCoverage(@Body() dto: AnalyzeFormTemplatePrefixCoverageDto) {
    return this.formTemplateService.analyzePublishedPrefixCoverage(
      dto.versionIds,
    );
  }

  @Post()
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '创建评估表单模板及首个草稿版本' })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateFormTemplateDto,
  ) {
    return this.formTemplateService.createFormTemplate(
      request.user.open_id,
      dto,
    );
  }

  @Get(':templateId/versions')
  @ApiOperation({ summary: '查看稳定模板的可见版本历史' })
  listVersions(
    @Req() request: AuthenticatedRequest,
    @Param('templateId', ParseIntPipe) templateId: number,
  ) {
    return this.formTemplateService.listTemplateVersions(
      request.user.open_id,
      templateId,
    );
  }

  @Get('versions/:versionId')
  @ApiOperation({ summary: '查看评估表单模板版本详情' })
  detail(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.formTemplateService.getVersion(request.user.open_id, versionId);
  }

  @Put('versions/:versionId')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '整体覆盖评估表单模板草稿内容' })
  replaceDraft(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body() dto: ReplaceFormTemplateDraftDto,
  ) {
    return this.formTemplateService.replaceDraftContent(
      request.user.open_id,
      versionId,
      dto,
    );
  }

  @Post('versions/:versionId/publish')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '校验并发布评估表单模板草稿' })
  publish(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.formTemplateService.publishVersion(
      request.user.open_id,
      versionId,
    );
  }

  @Post('versions/:versionId/new-draft')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '从已发布版本深复制新草稿' })
  newDraft(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.formTemplateService.createDraftFromVersion(
      request.user.open_id,
      versionId,
    );
  }

  @Post('versions/:versionId/archive')
  @Roles(PerfRole.ADMIN)
  @ApiOperation({ summary: '归档已发布评估表单模板版本' })
  archive(
    @Req() request: AuthenticatedRequest,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.formTemplateService.archiveVersion(
      request.user.open_id,
      versionId,
    );
  }
}
