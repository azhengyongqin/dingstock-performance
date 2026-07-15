import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AiReportService } from './ai-report.service';
import { AI_REPORT_GENERATOR, type AiReportGenerator } from './ai-report.types';

const GENERATION_TIMEOUT_MS = 5 * 60_000;
const MAX_TASKS_PER_TICK = 5;

/** 轻量 DB 队列 worker：定时恢复超时任务，并按修订领取、生成、回写。 */
@Injectable()
export class AiReportProcessor {
  private readonly logger = new Logger(AiReportProcessor.name);

  constructor(
    private readonly aiReportService: AiReportService,
    @Inject(AI_REPORT_GENERATOR)
    private readonly generator: AiReportGenerator,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { waitForCompletion: true })
  async processTick() {
    await this.aiReportService.recoverTimedOut(GENERATION_TIMEOUT_MS);
    if (!this.generator.isEnabled()) return;

    for (let index = 0; index < MAX_TASKS_PER_TICK; index += 1) {
      const job = await this.aiReportService.claimNext();
      if (!job) return;
      try {
        const output = await this.generator.generate(job.input);
        await this.aiReportService.complete(job.id, job.revision, output);
      } catch (error) {
        try {
          await this.aiReportService.fail(job.id, job.revision, error);
        } catch (staleError) {
          // 人工输入在模型调用期间变化属于正常竞争：旧结果丢弃，新修订继续等待。
          this.logger.debug(
            `AI 任务 ${job.id} 已过期：${this.errorMessage(staleError)}`,
          );
        }
      }
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
