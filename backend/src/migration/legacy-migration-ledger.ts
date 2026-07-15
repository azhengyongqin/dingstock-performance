import { createHash } from 'node:crypto';

type ExistingLedgerItem = {
  checksum: string;
  status: 'MIGRATED' | 'SKIPPED' | 'FAILED' | 'ROLLED_BACK';
  targetId: number | null;
};

export type LedgerDecision =
  | { action: 'CREATE' | 'RETRY' }
  | { action: 'REUSE'; targetId: number }
  | {
      action: 'CONFLICT';
      code: 'SOURCE_CHANGED_AFTER_MIGRATION' | 'SOURCE_WAS_ROLLED_BACK';
    };

/** 迁移 checksum 使用递归稳定排序，避免 JSON 对象键顺序导致误报来源变化。 */
export function canonicalChecksum(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function decideMigrationItem(
  existing: ExistingLedgerItem | null,
  checksum: string,
): LedgerDecision {
  if (!existing) return { action: 'CREATE' };
  if (existing.status === 'ROLLED_BACK') {
    return existing.checksum === checksum
      ? { action: 'RETRY' }
      : { action: 'CONFLICT', code: 'SOURCE_CHANGED_AFTER_MIGRATION' };
  }
  if (existing.checksum !== checksum) {
    return { action: 'CONFLICT', code: 'SOURCE_CHANGED_AFTER_MIGRATION' };
  }
  if (existing.status === 'MIGRATED' && existing.targetId !== null) {
    return { action: 'REUSE', targetId: existing.targetId };
  }
  return { action: 'RETRY' };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
