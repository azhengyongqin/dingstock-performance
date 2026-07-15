import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    './migrations/20260714234000_add_notification_events/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test('通知事件用唯一业务键且发送记录唯一引用来源事件', () => {
  assert.match(schema, /dedupeKey\s+String\s+@unique/);
  assert.match(schema, /sourceEventId\s+Int\?\s+@unique/);
  assert.match(migration, /perf_notification_events_dedupe_key_key/);
  assert.match(migration, /perf_notifications_source_event_id_key/);
});

test('任务通知事件在数据库校验事件形状和任务周期阶段一致性', () => {
  assert.match(migration, /perf_notification_events_shape_check/);
  assert.match(
    migration,
    /"type" = 'TASK_OPENED'[\s\S]+"stage" <> 'AI'[\s\S]+"opened_at" IS NOT NULL[\s\S]+"deadline_at" IS NULL/,
  );
  assert.match(
    migration,
    /"type" = 'TASK_REMINDER_DUE'[\s\S]+"stage" <> 'AI'[\s\S]+"opened_at" IS NULL[\s\S]+"deadline_at" IS NOT NULL/,
  );
  assert.match(migration, /validate_notification_event_task_reference/);
  assert.match(
    migration,
    /task_cycle_id <> NEW\."cycle_id" OR task_type <> NEW\."stage"/,
  );
});

test('启动失败事件不允许伪装成任务事件', () => {
  assert.match(
    migration,
    /"type" = 'CYCLE_START_FAILED'[\s\S]+"task_id" IS NULL[\s\S]+"stage" IS NULL/,
  );
});
