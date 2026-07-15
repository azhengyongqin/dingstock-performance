import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Ticket 15 申诉结果版本迁移约束', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260716050000_bind_appeals_to_result_versions/migration.sql',
    ),
    'utf8',
  );

  it('以复合外键保证申诉版本和处理决定属于同一参与者', () => {
    expect(migration).toContain(
      'CONSTRAINT "perf_appeals_result_version_participant_fkey"',
    );
    expect(migration).toContain(
      'CONSTRAINT "perf_appeals_resolution_calibration_participant_fkey"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("result_version_id", "participant_id")',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("resolution_calibration_id", "participant_id")',
    );
  });

  it('数据库限制每人一次申诉、处理闭环形状和不可改写来源绑定', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "perf_appeals_current_participant_key"',
    );
    expect(migration).toContain('CREATE TRIGGER "perf_appeals_reject_second"');
    expect(migration).toContain(
      'CONSTRAINT "perf_appeals_resolution_fields_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "perf_appeals_adjustment_calibration_check"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "perf_appeals_binding_immutable"',
    );
  });
});
