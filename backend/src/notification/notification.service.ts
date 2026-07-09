import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import {
  PerfNotificationChannel,
  PerfNotificationStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../shared/database/prisma.service';
import { LarkService } from '../shared/lark/lark.service';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';

const MAX_RETRY = 3;
const SEND_LOCK_KEY = 'perf:notification:send:lock';

/** 通知模板 → 文本内容（产品 §9.10；一期用文本消息，卡片模板二期升级） */
function renderText(
  template: string,
  payload: Record<string, unknown>,
): string {
  const cycleName = (payload.cycleName as string) ?? '当前绩效周期';
  switch (template) {
    case 'cycle_start':
      return `【绩效评审启动】${cycleName} 已启动，请前往绩效系统完成自评。`;
    case 'review_task_assigned':
      return `【评审任务】你有新的 360° 评审任务，请前往绩效系统查看并完成打分。`;
    case 'self_review_remind':
      return `【自评提醒】${cycleName} 自评截止在即，请尽快提交工作总结与自评。`;
    case 'review_remind':
      return `【打分催办】你还有未完成的评审任务，请尽快完成打分。`;
    case 'result_pushed':
      return `【结果确认】你的绩效结果已发布，请前往绩效系统查看并确认。`;
    case 'appeal_resolved':
      return `【申诉处理】你的绩效申诉已处理完成，请前往绩效系统查看结论并再次确认结果。`;
    default:
      return `【绩效系统】你有一条新的绩效相关通知，请前往绩效系统查看。`;
  }
}

/**
 * 通知发送（研发文档 §8.5）：
 * 业务模块只负责落 PENDING 记录；本服务 cron 扫描发送、指数退避重试、上限置 FAILED。
 * 幂等：发送循环由 Redis 锁保证单实例执行。
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly larkService: LarkService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 手动催办：按模板给一批人落通知记录 */
  async remind(
    receiverOpenIds: string[],
    template: string,
    payload: Record<string, unknown>,
  ) {
    const result = await this.prisma.perfNotification.createMany({
      data: receiverOpenIds.map((receiverOpenId) => ({
        receiverOpenId,
        channel: PerfNotificationChannel.BOT_DM,
        template,
        payload: payload as Prisma.InputJsonValue,
      })),
    });
    // 立即触发一轮发送，无需等 cron
    void this.sendPendingBatch();
    return { created: result.count };
  }

  async list(filters: {
    receiverOpenId?: string;
    status?: PerfNotificationStatus;
  }) {
    const items = await this.prisma.perfNotification.findMany({
      where: {
        receiverOpenId: filters.receiverOpenId || undefined,
        status: filters.status || undefined,
      },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return { items, total: items.length };
  }

  /** 每分钟扫描待发送/重试中的通知 */
  @Cron(CronExpression.EVERY_MINUTE)
  async sendPendingBatch() {
    // Redis 锁：多实例/并发触发下保证单执行者
    const locked = await this.redis.set(SEND_LOCK_KEY, '1', 'EX', 55, 'NX');
    if (!locked) return;

    try {
      const pending = await this.prisma.perfNotification.findMany({
        where: {
          status: {
            in: [
              PerfNotificationStatus.PENDING,
              PerfNotificationStatus.RETRYING,
            ],
          },
        },
        orderBy: { id: 'asc' },
        take: 50,
      });
      for (const notification of pending) {
        await this.sendOne(notification.id);
      }
    } finally {
      await this.redis.del(SEND_LOCK_KEY);
    }
  }

  private async sendOne(id: number) {
    const notification = await this.prisma.perfNotification.findUnique({
      where: { id },
    });
    if (
      !notification ||
      (notification.status !== PerfNotificationStatus.PENDING &&
        notification.status !== PerfNotificationStatus.RETRYING)
    ) {
      return;
    }

    try {
      const payload = (notification.payload ?? {}) as Record<string, unknown>;
      const text = renderText(notification.template, payload);
      await this.larkService.getClient().im.v1.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: notification.receiverOpenId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
      await this.prisma.perfNotification.update({
        where: { id },
        data: {
          status: PerfNotificationStatus.SUCCESS,
          sentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      const retryCount = notification.retryCount + 1;
      const failed = retryCount >= MAX_RETRY;
      this.logger.warn(
        `通知发送失败 #${id}（第 ${retryCount} 次）：${(error as Error).message ?? error}`,
      );
      await this.prisma.perfNotification.update({
        where: { id },
        data: {
          status: failed
            ? PerfNotificationStatus.FAILED
            : PerfNotificationStatus.RETRYING,
          retryCount,
          errorMessage: String((error as Error).message ?? error),
        },
      });
    }
  }

  /** 手动补发失败通知 */
  async resend(id: number) {
    await this.prisma.perfNotification.update({
      where: { id },
      data: { status: PerfNotificationStatus.PENDING, retryCount: 0 },
    });
    void this.sendPendingBatch();
    return { ok: true };
  }
}
