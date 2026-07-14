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
  PerfFormDimensionKind,
  PerfFormItemType,
  PerfFormSubformType,
  PerfJobLevelPrefix,
} from '../generated/prisma/enums';

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

class FormItemOptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;
}

class FormItemConfigDto {
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
  @Type(() => FormItemOptionDto)
  options?: FormItemOptionDto[];

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

class FormTemplateItemDto {
  @IsEnum(PerfFormItemType)
  type!: PerfFormItemType;

  @IsString()
  @MinLength(1)
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

  @IsBoolean()
  required!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => FormItemConfigDto)
  config?: FormItemConfigDto | null;
}

class FormTemplateDimensionDto {
  @IsEnum(PerfFormDimensionKind)
  kind!: PerfFormDimensionKind;

  @IsEnum(PerfFormAudience)
  audience!: PerfFormAudience;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

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
  @ArrayUnique((item: FormTemplateItemDto) => item.sortOrder)
  @ValidateNested({ each: true })
  @Type(() => FormTemplateItemDto)
  items!: FormTemplateItemDto[];
}

class FormTemplateSubformDto {
  @IsEnum(PerfFormSubformType)
  type!: PerfFormSubformType;

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
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @ArrayUnique((subform: FormTemplateSubformDto) => subform.type)
  @ValidateNested({ each: true })
  @Type(() => FormTemplateSubformDto)
  subforms!: FormTemplateSubformDto[];
}
