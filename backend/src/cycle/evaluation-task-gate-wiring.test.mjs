import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';

const selfReviewSource = readFileSync(
  new URL('../review/self-review.service.ts', import.meta.url),
  'utf8',
);
const reviewSource = readFileSync(
  new URL('../review/review.service.ts', import.meta.url),
  'utf8',
);

describe('人工评估写入统一任务门槛 wiring', () => {
  it('SELF 保存和提交都调用 SELF 硬开放门槛，查询同时返回任务事实', () => {
    const selfGateCalls = selfReviewSource.match(
      /ensureWritable\([\s\S]{0,120}PerfEvaluationTaskType\.SELF/g,
    );
    expect(selfGateCalls).toHaveLength(2);
    expect(selfReviewSource).toContain(
      'task: participant.evaluationTasks[0] ?? null',
    );
    expect(selfReviewSource).toMatch(
      /if \(!task\?\.openedAt\)[\s\S]{0,260}dimensions: \[\][\s\S]{0,100}evaluationRule: null/,
    );
    expect(selfReviewSource).toMatch(
      /\$transaction\(\[[\s\S]{0,700}perfSelfReview\.update[\s\S]{0,700}perfEvaluationTask\.update/,
    );
  });

  it('PEER 与 MANAGER 的保存和提交均调用各自门槛，任务列表返回时间事实', () => {
    const peerGateCalls = reviewSource.match(
      /ensureWritable\([\s\S]{0,120}PerfEvaluationTaskType\.PEER/g,
    );
    const managerGateCalls = reviewSource.match(
      /ensureWritable\([\s\S]{0,120}PerfEvaluationTaskType\.MANAGER/g,
    );
    expect(peerGateCalls).toHaveLength(2);
    expect(managerGateCalls).toHaveLength(2);
    expect(reviewSource).toContain('reminderDeadlineAt: true');
    expect(reviewSource).toContain('openedAt: true');
    expect(reviewSource).toMatch(
      /if \(!task\?\.openedAt\)[\s\S]{0,500}dimensions: \[\][\s\S]{0,120}evaluationRule: null/,
    );
    expect(reviewSource).toMatch(
      /\$transaction\(async \(tx\)[\s\S]{0,1400}tx\.perfReview\.update[\s\S]{0,1400}tx\.perfEvaluationTask\.update/,
    );
    expect(reviewSource).toMatch(
      /\$transaction\(\[[\s\S]{0,700}perfManagerReview\.update[\s\S]{0,700}perfEvaluationTask\.update/,
    );
  });
});
