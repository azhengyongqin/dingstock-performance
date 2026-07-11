import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PerfCycleStatus,
  PerfCycleType,
  PerfDimensionType,
  PerfRole,
  PerfScoringMethod,
} from '../generated/prisma/enums';

/** 维度配置项：周期维度与模板维度共用（差异只在归属外键） */
export class DimensionItemDto {
  /** 更新场景携带已有维度 id；不带则视为新增 */
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsEnum(PerfDimensionType)
  type!: PerfDimensionType;

  @IsEnum(PerfScoringMethod)
  scoringMethod!: PerfScoringMethod;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PerfRole, { each: true })
  visibleRoles?: PerfRole[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PerfRole, { each: true })
  editableRoles?: PerfRole[];

  @IsOptional()
  @IsObject()
  formSchema?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  applicableScope?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  conclusionOptions?: string[];

  @IsOptional()
  @IsBoolean()
  employeeVisible?: boolean;
}

export class UpsertDimensionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DimensionItemDto)
  items!: DimensionItemDto[];

  /** 进行中周期的破坏性修改二次确认（管理员编辑） */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

/** 评估规则：levels 为评级集合，commentRequiredRules 为评语必填评级配置 */
export class UpsertEvaluationRuleDto {
  @IsArray()
  @IsObject({ each: true })
  levels!: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  commentRequiredRules?: Record<string, unknown>;

  /** 进行中周期的破坏性修改二次确认（管理员编辑） */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class CreateCycleDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsEnum(PerfCycleType)
  type?: PerfCycleType;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  /** 周期负责人；缺省为当前操作人 */
  @IsOptional()
  @IsString()
  ownerOpenId?: string;

  /** 来源模板：创建时把评估规则与维度集复制为本周期快照 */
  @IsOptional()
  @IsInt()
  templateId?: number;
}

export class UpdateCycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(PerfCycleType)
  type?: PerfCycleType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  ownerOpenId?: string;
}

export class ApplyTemplateDto {
  /** 要重新套用的配置模板；会整体覆盖评估规则与评估维度 */
  @IsInt()
  templateId!: number;

  /** 进行中周期的破坏性修改二次确认（管理员编辑） */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class UpsertWindowsDto {
  /** { selfReview/review/calibration/confirm/appeal: { startAt, endAt, remindAt[] } } */
  @IsObject()
  windows!: Record<string, unknown>;
}

export class UpsertNotificationRulesDto {
  @IsObject()
  notificationRules!: Record<string, unknown>;
}

export class AdvanceCycleDto {
  /** 目标状态；合法性由周期状态机校验 */
  @IsIn(Object.values(PerfCycleStatus))
  to!: PerfCycleStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateTemplateDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsArray()
  @IsObject({ each: true })
  levels!: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  commentRequiredRules?: Record<string, unknown>;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  levels?: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  commentRequiredRules?: Record<string, unknown>;
}
