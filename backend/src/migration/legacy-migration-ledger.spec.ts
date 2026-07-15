import { createHash } from 'node:crypto';
import {
  canonicalChecksum,
  decideMigrationItem,
} from './legacy-migration-ledger';

describe('legacy migration idempotency ledger', () => {
  it('规范化对象键顺序后生成相同 SHA-256', () => {
    expect(canonicalChecksum({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalChecksum({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(canonicalChecksum({ a: 1 })).toHaveLength(64);
    expect(canonicalChecksum({ a: 1 })).toBe(
      createHash('sha256').update('{"a":1}').digest('hex'),
    );
  });

  it('同来源同 checksum 复用目标，不重复写；来源变化必须阻断', () => {
    expect(
      decideMigrationItem(
        { checksum: 'a'.repeat(64), status: 'MIGRATED', targetId: 19 },
        'a'.repeat(64),
      ),
    ).toEqual({ action: 'REUSE', targetId: 19 });
    expect(
      decideMigrationItem(
        { checksum: 'a'.repeat(64), status: 'MIGRATED', targetId: 19 },
        'b'.repeat(64),
      ),
    ).toEqual({
      action: 'CONFLICT',
      code: 'SOURCE_CHANGED_AFTER_MIGRATION',
    });
    expect(decideMigrationItem(null, 'a'.repeat(64))).toEqual({
      action: 'CREATE',
    });
  });

  it('FAILED/SKIPPED 的同源同 checksum 可以重跑，ROLLED_BACK 必须重新显式创建', () => {
    expect(
      decideMigrationItem(
        { checksum: 'a'.repeat(64), status: 'FAILED', targetId: null },
        'a'.repeat(64),
      ),
    ).toEqual({ action: 'RETRY' });
    expect(
      decideMigrationItem(
        { checksum: 'a'.repeat(64), status: 'ROLLED_BACK', targetId: 2 },
        'a'.repeat(64),
      ),
    ).toEqual({ action: 'RETRY' });
  });
});
