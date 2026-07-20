/** 阶段结果表仍保留旧 mode 列用于 expand 期内部计算，但任何接口响应都不再公开该配置概念。 */
export function omitStageResultMode<T extends object>(
  value: T,
): Record<string, unknown>;
export function omitStageResultMode(value: null): null;
export function omitStageResultMode<T extends object>(
  value: T | null,
): Record<string, unknown> | null;
export function omitStageResultMode<T extends object>(value: T | null) {
  if (!value) return null;
  const publicValue = { ...value } as Record<string, unknown>;
  delete publicValue.mode;
  return publicValue;
}
