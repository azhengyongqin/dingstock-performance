import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PerfFormAudience,
  PerfFormFieldRequiredRule,
  PerfFormFieldType,
  PerfFormScoringMethod,
  PerfRatingSymbol,
  PerfJobLevelPrefix,
} from '../generated/prisma/enums';

const PERFORMANCE_SUBFORMS = ['SELF', 'PEER', 'MANAGER'] as const;
const DIMENSION_TYPES = ['SCORING', 'NON_SCORING'] as const;
const FIELD_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'MARKDOWN',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'ATTACHMENT',
  'LINK',
] as const;

export class CreateFormTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsEnum(PerfJobLevelPrefix)
  jobLevelPrefix!: PerfJobLevelPrefix;
}

export class AnalyzeFormTemplatePrefixCoverageDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  versionIds!: number[];
}

class FormFieldOptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;
}

class FormFieldConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minLength?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxLength?: number;

  @IsOptional()
  @IsString()
  defaultValue?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FormFieldOptionDto)
  options?: FormFieldOptionDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSelections?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxSelections?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxFiles?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  maxSizeMb?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedExtensions?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(['http', 'https'], { each: true })
  allowedProtocols?: string[];
}

class FormTemplateFieldDto {
  /** 新字段可省略 key，由服务端创建一次；已有字段必须回传原 key。 */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  key?: string;

  @IsIn(FIELD_TYPES)
  type!: PerfFormFieldType;

  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  placeholder?: string | null;

  @IsEnum(PerfFormFieldRequiredRule)
  requiredRule!: PerfFormFieldRequiredRule;

  @IsArray()
  @ArrayUnique()
  @IsEnum(PerfRatingSymbol, { each: true })
  requiredLevels!: PerfRatingSymbol[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FormFieldConfigDto)
  config?: FormFieldConfigDto | null;
}

class FormTemplateDimensionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  key?: string;

  @IsIn(DIMENSION_TYPES)
  type!: (typeof DIMENSION_TYPES)[number];

  @IsEnum(PerfFormAudience)
  audience!: PerfFormAudience;

  @IsString()
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsOptional()
  @IsEnum(PerfFormScoringMethod)
  scoringMethod?: PerfFormScoringMethod | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  weight?: number | null;

  @IsBoolean()
  isCore!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsArray()
  @ArrayUnique((field: FormTemplateFieldDto) => field.sortOrder)
  @ValidateNested({ each: true })
  @Type(() => FormTemplateFieldDto)
  fields!: FormTemplateFieldDto[];
}

class FormTemplateSubformDto {
  @IsIn(PERFORMANCE_SUBFORMS)
  type!: (typeof PERFORMANCE_SUBFORMS)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormTemplateDimensionDto)
  dimensions!: FormTemplateDimensionDto[];
}

export class ReplaceFormTemplateDraftDto extends CreateFormTemplateDto {
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ArrayUnique((subform: FormTemplateSubformDto) => subform.type)
  @ValidateNested({ each: true })
  @Type(() => FormTemplateSubformDto)
  subforms!: FormTemplateSubformDto[];
}
