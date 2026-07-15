import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsIn,
  IsNotEmpty,
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
