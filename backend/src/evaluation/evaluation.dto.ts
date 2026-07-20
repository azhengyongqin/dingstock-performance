import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PerfRatingSymbol } from '../generated/prisma/enums';

/** 新版非计分字段作答；字段类型由周期快照决定，客户端只提交稳定 key 与值。 */
export class EvaluationFieldAnswerDto {
  @IsString()
  @MaxLength(200)
  fieldKey!: string;

  value!: unknown;
}

/** 新版维度作答：计分值直接位于维度，字段作答从属于该维度。 */
export class EvaluationDimensionAnswerDto {
  @IsString()
  @MaxLength(200)
  subformKey!: string;

  @IsString()
  @MaxLength(200)
  dimensionKey!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(PerfRatingSymbol)
  rawLevel?: PerfRatingSymbol;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rawScore?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluationFieldAnswerDto)
  fields!: EvaluationFieldAnswerDto[];
}

/** 草稿保存与提交共用同一 body 形状：草稿允许不完整，提交要求必填项齐全 */
export class SaveSelfEvaluationDto {
  @IsInt()
  cycleId!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluationDimensionAnswerDto)
  dimensions!: EvaluationDimensionAnswerDto[];
}

/** 360°草稿与提交共用载荷；participant/reviewer 身份只从有效 assignment 派生，禁止客户端伪造。 */
export class SavePeerEvaluationDto {
  @IsInt()
  assignmentId!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluationDimensionAnswerDto)
  dimensions!: EvaluationDimensionAnswerDto[];
}

/** 上级评估身份只从 participant 的当前 Leader 快照派生，不接受人工初评等级。 */
export class SaveManagerEvaluationDto {
  @IsInt()
  participantId!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluationDimensionAnswerDto)
  dimensions!: EvaluationDimensionAnswerDto[];
}

/** HR/Admin 显式转移考核 Leader；expectedLeaderOpenId 用于乐观并发检查。 */
export class TransferManagerResponsibilityDto {
  @IsInt()
  participantId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  expectedLeaderOpenId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  newLeaderOpenId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
