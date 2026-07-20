import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PerfLegacyPromotionArchiveSource } from '../generated/prisma/enums';

/** 归档列表仅开放受控筛选与分页，避免一次读取全部历史敏感内容。 */
export class ListLegacyPromotionArchivesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cycle_id?: number;

  @IsOptional()
  @IsIn(Object.values(PerfLegacyPromotionArchiveSource))
  source_type?: PerfLegacyPromotionArchiveSource;
}
