import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PerfReviewerRelation } from '../generated/prisma/enums';

export class ReviewerItemDto {
  @IsString()
  @IsNotEmpty()
  reviewerOpenId!: string;

  @IsIn([
    PerfReviewerRelation.ORG_OWNER,
    PerfReviewerRelation.PROJECT_OWNER,
    PerfReviewerRelation.PEER,
    PerfReviewerRelation.CROSS_DEPT,
  ])
  relation!: PerfReviewerRelation;
}

/** 已提交关系只能经显式替换入口变更；原因会与旧、新指派一并写入审计。 */
export class ReplaceReviewerDto extends ReviewerItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class UpsertReviewersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewerItemDto)
  items!: ReviewerItemDto[];

  /** 页面加载时的指派 id 快照（乐观校验）：加载后他人新增的指派缺席不视为删除 */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  knownAssignmentIds?: number[];
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
