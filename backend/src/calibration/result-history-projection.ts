type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * 把结果版本中的旧晋升载荷收敛为历史列表可用的文本。
 * 仅允许旧 visible/items 白名单字段进入响应，未知对象不做 stringify，避免泄漏内部字段。
 */
export function projectHistoricalPromotion(
  resultSnapshot: unknown,
): string | null {
  if (!isRecord(resultSnapshot)) return null;

  const promotion = resultSnapshot.promotion;
  const projected = nonEmptyString(promotion);
  if (projected) return projected;
  if (!isRecord(promotion) || promotion.visible !== true) return null;
  if (!Array.isArray(promotion.items)) return null;

  const summaries = promotion.items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const value = nonEmptyString(item.value);
    if (!value) return [];
    const title = nonEmptyString(item.title);
    return [title ? `${title}：${value}` : value];
  });

  return summaries.length > 0 ? summaries.join('；') : null;
}
