import { BadRequestException } from '@nestjs/common';

export type EvaluationRating = {
  symbol: string;
  name: string;
  minScore: number;
  maxScore: number;
  maxInclusive?: boolean;
  remark?: string;
};

export type CommentRequiredRules = {
  requiredRatingSymbols: string[];
};

export const DEFAULT_COMMENT_REQUIRED_RULES: CommentRequiredRules = {
  requiredRatingSymbols: ['S', 'C'],
};

/** 默认评估规则：百分制四档，区间左闭右开，最高档右闭。 */
export const DEFAULT_EVALUATION_RATINGS: EvaluationRating[] = [
  {
    symbol: 'C',
    name: '不符预期',
    minScore: 0,
    maxScore: 60,
    remark:
      '绩效目标完成情况、工作态度、价值观等不符合预期，需进行绩效改进；绩效改进不合格者，则进行绩效淘汰',
  },
  {
    symbol: 'B',
    name: '良好',
    minScore: 60,
    maxScore: 80,
    remark: '绩效目标完成情况符合预期，但仍需持续改进和提升',
  },
  {
    symbol: 'A',
    name: '优秀',
    minScore: 80,
    maxScore: 90,
    remark: '绩效目标完成情况优秀，和公司价值观统一，整体超出预期',
  },
  {
    symbol: 'S',
    name: '卓越',
    minScore: 90,
    maxScore: 100,
    maxInclusive: true,
    remark:
      '工作结果、成长速度等方面有重大突破和创新，价值观表现等可作团队标杆',
  },
];

export function normalizeEvaluationRule(input: {
  levels: Record<string, unknown>[];
  commentRequiredRules?: Record<string, unknown>;
}) {
  const levels = validateRatings(input.levels);
  const commentRequiredRules = normalizeCommentRequiredRules(
    input.commentRequiredRules,
    levels,
  );

  return { levels, commentRequiredRules };
}

export function hasRatingSymbol(
  levels: unknown,
  symbol: string | null | undefined,
) {
  if (!symbol || !Array.isArray(levels)) return false;
  return levels.some((item) => {
    if (!item || typeof item !== 'object') return false;
    return (item as { symbol?: unknown }).symbol === symbol;
  });
}

function validateRatings(raw: Record<string, unknown>[]): EvaluationRating[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestException('评估规则至少需要一个评级');
  }

  const ratings = raw.map((item) => ({
    symbol: textOf(item.symbol).trim(),
    name: textOf(item.name).trim(),
    minScore: Number(item.minScore),
    maxScore: Number(item.maxScore),
    maxInclusive: Boolean(item.maxInclusive),
    remark:
      item.remark === undefined || item.remark === null
        ? undefined
        : textOf(item.remark),
  }));

  const symbols = new Set<string>();
  for (const rating of ratings) {
    if (!rating.symbol) throw new BadRequestException('评级符号不能为空');
    if (!rating.name) throw new BadRequestException('评级名称不能为空');
    if (symbols.has(rating.symbol)) {
      throw new BadRequestException(`评级符号 ${rating.symbol} 重复`);
    }
    symbols.add(rating.symbol);
    if (
      !Number.isFinite(rating.minScore) ||
      !Number.isFinite(rating.maxScore)
    ) {
      throw new BadRequestException(`评级 ${rating.symbol} 的分数区间无效`);
    }
    if (rating.minScore < 0 || rating.maxScore > 100) {
      throw new BadRequestException('评级分数区间必须在 0-100 内');
    }
    if (rating.minScore >= rating.maxScore) {
      throw new BadRequestException(
        `评级 ${rating.symbol} 的分数下限必须小于上限`,
      );
    }
  }

  const sorted = [...ratings].sort((a, b) => a.minScore - b.minScore);
  if (sorted[0].minScore !== 0) {
    throw new BadRequestException('最低评级必须从 0 分开始');
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const isLast = index === sorted.length - 1;

    if (!isLast && current.maxInclusive) {
      throw new BadRequestException(
        `评级 ${current.symbol} 不是最高档，不能右闭`,
      );
    }
    if (next && current.maxScore !== next.minScore) {
      throw new BadRequestException(
        `评级 ${current.symbol} 与 ${next.symbol} 的区间必须连续`,
      );
    }
    if (isLast && (current.maxScore !== 100 || !current.maxInclusive)) {
      throw new BadRequestException('最高评级必须到 100 分且右闭');
    }
  }

  return sorted;
}

function textOf(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function normalizeCommentRequiredRules(
  raw: Record<string, unknown> | undefined,
  levels: EvaluationRating[],
): CommentRequiredRules {
  const symbols = new Set(levels.map((item) => item.symbol));
  const requested = Array.isArray(raw?.requiredRatingSymbols)
    ? raw.requiredRatingSymbols
    : DEFAULT_COMMENT_REQUIRED_RULES.requiredRatingSymbols;

  // 必填评级只能来自当前评估规则，避免评级改名后留下悬空配置。
  return {
    requiredRatingSymbols: [...new Set(requested.map(String))].filter(
      (symbol) => symbols.has(symbol),
    ),
  };
}
