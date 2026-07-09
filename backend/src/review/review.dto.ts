import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PerfReviewerRelation } from '../generated/prisma/enums';

export class ReviewerItemDto {
  @IsString()
  reviewerOpenId!: string;

  @IsEnum(PerfReviewerRelation)
  relation!: PerfReviewerRelation;
}

export class UpsertReviewersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewerItemDto)
  items!: ReviewerItemDto[];
}

export class SaveSelfReviewDto {
  @IsInt()
  cycleId!: number;

  @IsOptional()
  @IsObject()
  okrContent?: Record<string, unknown>;

  /** 工作总结分节：{ outputs, results, collaboration, reflection, plan } */
  @IsOptional()
  @IsObject()
  summary?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  promotionSelfReview?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  attachments?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  documentToken?: string;
}

export class SubmitSelfReviewDto {
  @IsInt()
  cycleId!: number;
}

export class ReturnSelfReviewDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/** 360° 评估草稿；dimensionScores: [{ dimensionId, score?, level?, conclusion?, comment }] */
export class SaveReviewDto {
  @IsInt()
  participantId!: number;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  dimensionScores?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  comments?: string;

  @IsOptional()
  @IsObject()
  promotionFeedback?: Record<string, unknown>;
}

export class SubmitByParticipantDto {
  @IsInt()
  participantId!: number;
}

export class SaveManagerReviewDto {
  @IsInt()
  participantId!: number;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  dimensionScores?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  overallComment?: string;

  /** 初步评级，取值受周期评估规则 levels 约束（service 校验） */
  @IsOptional()
  @IsString()
  initialLevel?: string;

  @IsOptional()
  @IsString()
  promotionConclusion?: string;
}

export class BatchAddReviewersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  participantIds!: number[];

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReviewerItemDto)
  items!: ReviewerItemDto[];
}
