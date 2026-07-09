/**
 * 配置模板可用于创建/套用周期的领域校验：
 * 必须有评分等级、评估维度，并且各适用分组维度权重合计为 100。
 */
export function getCycleCreationUnavailableReasons(template: {
  levels: unknown;
  dimensions?: Array<{
    type?: unknown;
    weight: unknown;
    applicableScope?: unknown;
  }>;
}) {
  const reasons: string[] = [];
  const levels = Array.isArray(template.levels) ? template.levels : [];
  const dimensions = template.dimensions ?? [];

  if (levels.length === 0) reasons.push('缺少评分等级');
  if (dimensions.length === 0) reasons.push('缺少评估维度');

  reasons.push(...getWeightUnavailableReasons(dimensions));

  return reasons;
}

function getWeightUnavailableReasons(
  dimensions: Array<{
    type?: unknown;
    weight: unknown;
    applicableScope?: unknown;
  }>,
) {
  // 只有常规维度参与权重校验；晋升/文本反馈维度不要求配置权重。
  const weightBearingDimensions = dimensions.filter(
    (dim) => !dim.type || dim.type === 'REGULAR',
  );

  if (weightBearingDimensions.length === 0) return ['缺少维度权重'];
  if (
    weightBearingDimensions.some(
      (dim) => dim.weight === null || dim.weight === undefined,
    )
  ) {
    return ['缺少维度权重'];
  }

  const weighted = weightBearingDimensions.map((dim) => ({
    weight: Number(dim.weight),
    applicableScope: dim.applicableScope,
  }));

  if (weighted.some((dim) => Number.isNaN(dim.weight))) {
    return ['缺少维度权重'];
  }

  const scopeKeys = new Set(
    weighted.map((dim) =>
      dim.applicableScope ? JSON.stringify(dim.applicableScope) : '__ALL__',
    ),
  );
  const globalSum = weighted
    .filter((dim) => !dim.applicableScope)
    .reduce((sum, dim) => sum + dim.weight, 0);
  const failures: string[] = [];

  if (scopeKeys.size === 1 && scopeKeys.has('__ALL__')) {
    if (Math.abs(globalSum - 100) > 0.001) {
      failures.push(`全员维度权重合计 ${globalSum}，需为 100`);
    }
    return failures;
  }

  for (const key of scopeKeys) {
    if (key === '__ALL__') continue;
    const groupSum = weighted
      .filter(
        (dim) =>
          dim.applicableScope && JSON.stringify(dim.applicableScope) === key,
      )
      .reduce((sum, dim) => sum + dim.weight, 0);
    const total = groupSum + globalSum;
    if (Math.abs(total - 100) > 0.001) {
      failures.push(`分组 ${key} 权重合计 ${total}，需为 100`);
    }
  }

  return failures;
}
