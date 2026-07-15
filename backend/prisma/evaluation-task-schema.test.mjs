import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    './migrations/20260714233000_add_evaluation_tasks/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('统一评估任务数据库契约', () => {
  it('每名参与人每类任务唯一，并可按周期的开放与提醒时间查询', () => {
    expect(schema).toMatch(/model PerfEvaluationTask[\s\S]*@@unique\(\[participantId, type\]\)/);
    expect(schema).toMatch(/@@index\(\[cycleId, type, startAt\]\)/);
    expect(schema).toMatch(/@@index\(\[cycleId, type, reminderDeadlineAt\]\)/);
  });

  it('复合外键阻止任务跨周期挂载参与人', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("participant_id", "cycle_id") REFERENCES "performance"."perf_participants"("id", "cycle_id")',
    );
  });

  it('数据库触发器保证 opened_at 首次写入后不可清空或改写', () => {
    expect(migration).toContain('protect_perf_task_opened_at');
    expect(migration).toContain(
      'NEW."opened_at" IS DISTINCT FROM OLD."opened_at"',
    );
  });
});
