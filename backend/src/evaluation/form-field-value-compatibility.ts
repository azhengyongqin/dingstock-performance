import type { FormSnapshotField } from './evaluation.service-types';

/**
 * 表单字段值的唯一兼容口径。
 * 实时提交与周期结构迁移都必须走这里，避免新答卷可提交但旧值不能预填（或反之）。
 */
export function isFormFieldValueCompatible(
  field: FormSnapshotField,
  value: unknown,
): boolean {
  // 空值只表示“未作答”，不能形成字段答案，也不能在结构变更后继续预填。
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  if (Array.isArray(value) && value.length === 0) return false;

  const config = isRecord(field.config) ? field.config : {};
  if (
    field.type === 'SHORT_TEXT' ||
    field.type === 'LONG_TEXT' ||
    field.type === 'MARKDOWN'
  ) {
    if (typeof value !== 'string') return false;
    return withinOptionalRange(
      value.length,
      config.minLength,
      config.maxLength,
    );
  }
  if (field.type === 'SINGLE_SELECT') {
    return typeof value === 'string' && allowedOptions(config).has(value);
  }
  if (field.type === 'MULTI_SELECT') {
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === 'string')
    ) {
      return false;
    }
    const allowed = allowedOptions(config);
    return (
      value.every((item) => allowed.has(item)) &&
      withinOptionalRange(
        value.length,
        config.minSelections,
        config.maxSelections,
      )
    );
  }
  if (field.type === 'LINK') {
    if (typeof value !== 'string') return false;
    if (!withinOptionalRange(value.length, undefined, config.maxLength)) {
      return false;
    }
    return hasAllowedProtocol(value, config.allowedProtocols);
  }
  if (field.type === 'ATTACHMENT') {
    if (
      !Array.isArray(value) ||
      !withinOptionalRange(value.length, undefined, config.maxFiles)
    ) {
      return false;
    }
    const extensions = allowedExtensions(config);
    return value.every((item) => {
      if (!isRecord(item)) return false;
      if (
        typeof item.name !== 'string' ||
        item.name.trim().length === 0 ||
        typeof item.url !== 'string' ||
        !hasAllowedProtocol(item.url, ['http', 'https'])
      ) {
        return false;
      }
      return extensions.size === 0 || extensions.has(fileExtension(item.name));
    });
  }
  return false;
}

function withinOptionalRange(
  value: number,
  minimum: unknown,
  maximum: unknown,
) {
  return !(
    (typeof minimum === 'number' && value < minimum) ||
    (typeof maximum === 'number' && value > maximum)
  );
}

function allowedOptions(config: Record<string, unknown>) {
  const options = Array.isArray(config.options) ? config.options : [];
  return new Set(
    options.flatMap((option) =>
      isRecord(option) && typeof option.value === 'string'
        ? [option.value]
        : [],
    ),
  );
}

function allowedExtensions(config: Record<string, unknown>) {
  if (!Array.isArray(config.allowedExtensions)) return new Set<string>();
  return new Set(
    config.allowedExtensions.flatMap((extension) =>
      typeof extension === 'string' && extension.trim()
        ? [extension.trim().replace(/^\./, '').toLowerCase()]
        : [],
    ),
  );
}

function fileExtension(name: string) {
  const separator = name.lastIndexOf('.');
  return separator >= 0 ? name.slice(separator + 1).toLowerCase() : '';
}

function hasAllowedProtocol(value: string, configured: unknown) {
  try {
    const protocol = new URL(value).protocol.replace(':', '');
    const allowed = Array.isArray(configured) ? configured : ['http', 'https'];
    return allowed.includes(protocol);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
