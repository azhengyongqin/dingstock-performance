import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PerfCycleStatus,
  PerfDimensionType,
  PerfRole,
  PerfScoringMethod,
} from '../generated/prisma/enums';
import {
  ConfigRatingDto,
  ConfigStageModesDto,
  ConstraintProfilesDto,
  NotificationRulesDto,
  ReviewerRelationWeightsDto,
} from '../config-template/config-template.dto';
import {
  FORM_AUDIENCES,
  FORM_DIMENSION_TYPES,
  FORM_ITEM_TYPES,
  FORM_SUBFORM_TYPES,
  type FormAudience,
  type FormDimensionType,
  type FormItemType,
  type FormSubformType,
} from '../form-template/form-template.contract';

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

  /** 新版四步创建只选择一份已发布配置版本，不再逐项拼装表单。 */
  @IsInt()
  configTemplateVersionId!: number;

  /** 计划启动时间必须带时区，作为所有相对计划的唯一绝对锚点。 */
  @IsDateString()
  @Matches(/(Z|[+-]\d{2}:\d{2})$/i, { message: 'plannedStartAt 必须包含时区' })
  plannedStartAt!: string;

  /** 周期负责人；缺省为当前操作人 */
  @IsOptional()
  @IsString()
  ownerOpenId?: string;
}

/** 为迁移后的旧草稿补齐新版配置快照；基础信息与快照必须原子写入。 */
export class InitializeCycleSetupDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsInt()
  configTemplateVersionId!: number;

  @IsDateString()
  @Matches(/(Z|[+-]\d{2}:\d{2})$/i, { message: 'plannedStartAt 必须包含时区' })
  plannedStartAt!: string;
}

/** 启动前重新套用已发布配置模板版本；整套覆盖评估规则与维度，不做字段级合并。 */
export class ReapplyCycleSetupDto {
  @IsInt()
  configTemplateVersionId!: number;
}

export class UpdateCycleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsDateString()
  @Matches(/(Z|[+-]\d{2}:\d{2})$/i, { message: 'plannedStartAt 必须包含时区' })
  plannedStartAt?: string;

  @IsOptional()
  @IsString()
  ownerOpenId?: string;
}

export class CyclePlanStageDto {
  @IsIn(['SELF', 'PEER', 'MANAGER'])
  stage!: 'SELF' | 'PEER' | 'MANAGER';

  @IsDateString()
  @Matches(/(Z|[+-]\d{2}:\d{2})$/i, { message: 'startAt 必须包含时区' })
  startAt!: string;

  @IsDateString()
  @Matches(/(Z|[+-]\d{2}:\d{2})$/i, {
    message: 'reminderDeadlineAt 必须包含时区',
  })
  reminderDeadlineAt!: string;
}

export class UpsertCyclePlanDto {
  @IsBoolean()
  allowStageOverlap!: boolean;

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ArrayUnique((item: CyclePlanStageDto) => item.stage)
  @ValidateNested({ each: true })
  @Type(() => CyclePlanStageDto)
  stages!: CyclePlanStageDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => NotificationRulesDto)
  notificationRules!: NotificationRulesDto;
}

/** 高级配置只调整周期自己的计算快照，不回写来源模板或 D/M 表单。 */
export class UpdateCycleAdvancedConfigDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ConfigStageModesDto)
  stageModes!: ConfigStageModesDto;

  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @ArrayUnique((item: ConfigRatingDto) => item.symbol)
  @ValidateNested({ each: true })
  @Type(() => ConfigRatingDto)
  ratings!: ConfigRatingDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => ConstraintProfilesDto)
  constraintProfiles!: ConstraintProfilesDto;

  @IsObject()
  @ValidateNested()
  @Type(() => ReviewerRelationWeightsDto)
  reviewerRelationWeights!: ReviewerRelationWeightsDto;
}

export class ActiveCycleDimensionOverrideDto {
  @IsIn(['D', 'M'])
  jobLevelPrefix!: 'D' | 'M';

  @IsString()
  @MaxLength(200)
  dimensionKey!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  weight!: string;

  @IsBoolean()
  isCore!: boolean;
}

/** ACTIVE 周期计算配置预览：expectedConfigVersionId 是页面打开时看到的乐观并发令牌。 */
export class PreviewActiveCycleConfigDto extends UpdateCycleAdvancedConfigDto {
  @IsInt()
  expectedConfigVersionId!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActiveCycleDimensionOverrideDto)
  dimensionOverrides!: ActiveCycleDimensionOverrideDto[];
}

/** 只有完成影响预览、填写原因并显式确认后，才允许创建新配置版本并统一重算。 */
export class ApplyActiveCycleConfigDto extends PreviewActiveCycleConfigDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  impactRevision!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsBoolean()
  confirmed!: boolean;
}

/** Ticket 18 表单项输入；受控 config 的类型细则由发布校验器继续复核。 */
export class CycleFormItemChangeDto {
  @IsString()
  @MaxLength(200)
  key!: string;

  @IsIn(FORM_ITEM_TYPES)
  type!: FormItemType;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  placeholder?: string | null;

  @IsBoolean()
  required!: boolean;

  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown> | null;
}

export class CycleFormDimensionChangeDto {
  @IsString()
  @MaxLength(200)
  key!: string;

  @IsIn(FORM_DIMENSION_TYPES)
  kind!: FormDimensionType;

  @IsIn(FORM_AUDIENCES)
  audience!: FormAudience;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  weight?: string | null;

  @IsBoolean()
  isCore!: boolean;

  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CycleFormItemChangeDto)
  items!: CycleFormItemChangeDto[];
}

export class CycleFormSubformChangeDto {
  @IsString()
  @MaxLength(200)
  key!: string;

  @IsIn(FORM_SUBFORM_TYPES)
  type!: FormSubformType;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CycleFormDimensionChangeDto)
  dimensions!: CycleFormDimensionChangeDto[];
}

export class CycleFormContentChangeDto {
  @IsIn([1])
  schemaVersion!: 1;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsIn(['D', 'M'])
  jobLevelPrefix!: 'D' | 'M';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CycleFormSubformChangeDto)
  subforms!: CycleFormSubformChangeDto[];
}

/** 完整周期表单快照输入；DTO 负责形状校验，领域发布校验器负责跨字段规则。 */
export class CycleFormSnapshotChangeDto {
  @IsIn(['D', 'M'])
  jobLevelPrefix!: 'D' | 'M';

  @IsObject()
  @ValidateNested()
  @Type(() => CycleFormContentChangeDto)
  content!: CycleFormContentChangeDto;
}

/** 预览使用当前配置版本作为乐观并发令牌，避免确认过期表单结构。 */
export class PreviewCycleFormChangeDto {
  @IsInt()
  expectedConfigVersionId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique((item: CycleFormSnapshotChangeDto) => item.jobLevelPrefix)
  @ValidateNested({ each: true })
  @Type(() => CycleFormSnapshotChangeDto)
  formSnapshots!: CycleFormSnapshotChangeDto[];
}

/** 结构/文案变更应用前必须回传影响修订、原因并显式确认。 */
export class ApplyCycleFormChangeDto extends PreviewCycleFormChangeDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  impactRevision!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsBoolean()
  confirmed!: boolean;
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

/** Ticket 17：预览只需要目标状态；执行必须回传预览修订并二次确认。 */
export class PreviewActiveCycleRollbackDto {
  @IsIn([PerfCycleStatus.DRAFT, PerfCycleStatus.SCHEDULED])
  targetStatus!:
    (typeof PerfCycleStatus)['DRAFT'] | (typeof PerfCycleStatus)['SCHEDULED'];
}

export class ApplyActiveCycleRollbackDto extends PreviewActiveCycleRollbackDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  impactRevision!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsBoolean()
  confirmed!: boolean;

  /** 退回 SCHEDULED 时必填且必须为未来时间；DRAFT 不使用。 */
  @IsOptional()
  @IsDateString()
  @Matches(/(Z|[+-]\d{2}:\d{2})$/i, { message: 'plannedStartAt 必须包含时区' })
  plannedStartAt?: string;
}

/** Ticket 19：执行归档必须回传刚查看的全量关闭检查修订并明确确认。 */
export class ArchiveCycleDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedRevision!: string;

  @IsBoolean()
  confirmed!: boolean;
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
