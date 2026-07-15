import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Ticket 13 校准与红线迁移约束', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260716010000_add_calibration_decisions_and_red_lines/migration.sql',
    ),
    'utf8',
  );

  it('历史回填后移除校准决定默认值，禁止新增记录隐式选择 ADJUST', () => {
    expect(migration).toContain(
      'ADD COLUMN "decision" "performance"."PerfCalibrationDecision" NOT NULL DEFAULT \'ADJUST\'',
    );
    expect(migration).toContain('ALTER COLUMN "decision" DROP DEFAULT');
    expect(migration).toContain(
      'CREATE TRIGGER "perf_calibrations_reject_new_legacy"',
    );
  });

  it('数据库限制决定形状、输入修订格式及红线撤销关系', () => {
    expect(migration).toContain(
      'CONSTRAINT "perf_calibrations_decision_shape_check"',
    );
    expect(migration).toContain('"input_revision" ~ \'^[0-9a-f]{64}$\'');
    expect(migration).toContain(
      'CONSTRAINT "perf_red_line_findings_event_shape_check"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "perf_red_line_findings_revoke_of_id_key"',
    );
    expect(migration).toContain(
      'red-line revocation must reference a confirmation of the same participant',
    );
    expect(migration).not.toContain('AND "after_level" = "before_level"');
  });

  it('校准记录与红线事实均由数据库拒绝更新和删除', () => {
    expect(migration).toContain(
      'CREATE TRIGGER "perf_calibrations_append_only"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "perf_red_line_findings_append_only"',
    );
    expect(migration.match(/BEFORE UPDATE OR DELETE/g)).toHaveLength(2);
    expect(migration).toContain(
      'CREATE TRIGGER "perf_results_enforce_active_red_line"',
    );
  });
});
