import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const DECIMAL_TEXT = /^\d+(?:\.\d{1,2})?$/;
// 关系权重直接写入 Decimal(5,2) 列，DTO 必须先拦截数据库不接受的单项范围。
const PERCENT_DECIMAL_TEXT = /^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/;
const NON_BLANK_TEXT = /\S/;
const LEVELS = ['S', 'A', 'B', 'C'] as const;
const SCHEDULE_STAGES = ['SELF', 'PEER', 'MANAGER'] as const;

export class CreateConfigTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(NON_BLANK_TEXT)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;
}

export class ConfigStageModesDto {
  @IsIn(['DIRECT_RATING'])
  SELF!: 'DIRECT_RATING';

  @IsIn(['WEIGHTED_RATING', 'WEIGHTED_SCORE'])
  PEER!: 'WEIGHTED_RATING' | 'WEIGHTED_SCORE';

  @IsIn(['WEIGHTED_RATING', 'WEIGHTED_SCORE'])
  MANAGER!: 'WEIGHTED_RATING' | 'WEIGHTED_SCORE';

  @IsIn(['DIRECT_RATING'])
  AI!: 'DIRECT_RATING';
}

export class ConfigRatingDto {
  @IsIn(LEVELS)
  symbol!: (typeof LEVELS)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsString()
  @Matches(DECIMAL_TEXT)
  minScore!: string;

  @IsString()
  @Matches(DECIMAL_TEXT)
  maxScore!: string;

  @IsString()
  @Matches(DECIMAL_TEXT)
  mappingScore!: string;

  @IsBoolean()
  commentRequired!: boolean;
}

class RatingConstraintRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id!: string;

  @IsIn(['CORE_RATING_FORCE', 'CORE_RATING_CAP', 'ANY_RATING_CAP'])
  type!: 'CORE_RATING_FORCE' | 'CORE_RATING_CAP' | 'ANY_RATING_CAP';

  @IsBoolean()
  enabled!: boolean;

  @IsIn(LEVELS)
  triggerRating!: (typeof LEVELS)[number];

  @IsIn(LEVELS)
  targetLevel!: (typeof LEVELS)[number];
}

class ScoreConstraintRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id!: string;

  @IsIn(['CORE_SCORE_FORCE', 'CORE_SCORE_CAP', 'ANY_SCORE_CAP'])
  type!: 'CORE_SCORE_FORCE' | 'CORE_SCORE_CAP' | 'ANY_SCORE_CAP';

  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Matches(DECIMAL_TEXT)
  threshold!: string;

  @IsIn(LEVELS)
  targetLevel!: (typeof LEVELS)[number];
}

export class ConstraintProfilesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RatingConstraintRuleDto)
  WEIGHTED_RATING!: RatingConstraintRuleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreConstraintRuleDto)
  WEIGHTED_SCORE!: ScoreConstraintRuleDto[];
}

export class ReviewerRelationWeightsDto {
  @IsString()
  @Matches(PERCENT_DECIMAL_TEXT)
  ORG_OWNER!: string;

  @IsString()
  @Matches(PERCENT_DECIMAL_TEXT)
  PROJECT_OWNER!: string;

  @IsString()
  @Matches(PERCENT_DECIMAL_TEXT)
  PEER!: string;

  @IsString()
  @Matches(PERCENT_DECIMAL_TEXT)
  CROSS_DEPT!: string;
}

class ScheduleStagePresetDto {
  @IsIn(SCHEDULE_STAGES)
  stage!: (typeof SCHEDULE_STAGES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  startOffsetMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  reminderDeadlineOffsetMinutes!: number;
}

class SchedulePresetDto {
  @IsBoolean()
  allowStageOverlap!: boolean;

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ArrayUnique((item: ScheduleStagePresetDto) => item.stage)
  @ValidateNested({ each: true })
  @Type(() => ScheduleStagePresetDto)
  stages!: ScheduleStagePresetDto[];
}

class NotificationTargetDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(['ASSIGNEE'])
  recipient!: 'ASSIGNEE';

  @IsBoolean()
  ccLeader!: boolean;

  @IsBoolean()
  ccHr!: boolean;
}

class ReminderFrequencyDto {
  @IsIn([
    'ONCE_AT_DEADLINE',
    'DAILY_AFTER_DEADLINE',
    'EVERY_N_DAYS_AFTER_DEADLINE',
  ])
  type!:
    'ONCE_AT_DEADLINE' | 'DAILY_AFTER_DEADLINE' | 'EVERY_N_DAYS_AFTER_DEADLINE';

  @ValidateIf(
    (value: ReminderFrequencyDto) =>
      value.type === 'EVERY_N_DAYS_AFTER_DEADLINE',
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  intervalDays?: number;
}

class NotificationReminderDto extends NotificationTargetDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ReminderFrequencyDto)
  frequency!: ReminderFrequencyDto;
}

class NotificationStageRuleDto {
  @IsIn(SCHEDULE_STAGES)
  stage!: (typeof SCHEDULE_STAGES)[number];

  @IsObject()
  @ValidateNested()
  @Type(() => NotificationTargetDto)
  taskOpened!: NotificationTargetDto;

  @IsObject()
  @ValidateNested()
  @Type(() => NotificationReminderDto)
  reminder!: NotificationReminderDto;
}

export class NotificationRulesDto {
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ArrayUnique((item: NotificationStageRuleDto) => item.stage)
  @ValidateNested({ each: true })
  @Type(() => NotificationStageRuleDto)
  stages!: NotificationStageRuleDto[];
}

export class ReplaceConfigTemplateDraftDto extends CreateConfigTemplateDto {
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

  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  formTemplateVersionIds!: number[];

  @IsObject()
  @ValidateNested()
  @Type(() => SchedulePresetDto)
  schedulePreset!: SchedulePresetDto;

  @IsObject()
  @ValidateNested()
  @Type(() => NotificationRulesDto)
  notificationRules!: NotificationRulesDto;
}

class PreviewRelationDto {
  @IsIn(['ORG_OWNER', 'PROJECT_OWNER', 'PEER', 'CROSS_DEPT', 'LEADER'])
  type!: 'ORG_OWNER' | 'PROJECT_OWNER' | 'PEER' | 'CROSS_DEPT' | 'LEADER';

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  rawValues!: string[];
}

class PreviewDimensionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dimensionId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PreviewRelationDto)
  relations!: PreviewRelationDto[];
}

export class CalculateConfigTemplatePreviewDto {
  @IsIn(['SELF', 'PEER', 'MANAGER', 'AI'])
  stage!: 'SELF' | 'PEER' | 'MANAGER' | 'AI';

  @IsIn(['D', 'M'])
  jobLevelPrefix!: 'D' | 'M';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewDimensionDto)
  dimensions?: PreviewDimensionDto[];

  @IsOptional()
  @IsIn(LEVELS)
  directRating?: (typeof LEVELS)[number];
}
