import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

function displayText(value: unknown, fallback: string) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

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
    case 'evaluation_task_opened':
      return `【评估任务已开放】${cycleName} 的评估任务现已开放，请前往绩效系统填写。`;
    case 'evaluation_task_reminder':
      return `【评估填写提醒】${cycleName} 的评估填写提醒时间已到。任务仍可继续填写，请尽快完成。`;
    case 'manager_responsibility_transferred_in': {
      const employee = displayText(payload.employeeOpenId, '该员工');
      const postCalibration = payload.postCalibration === true;
      return postCalibration
        ? `【考核职责转入】${cycleName} 中员工 ${employee} 的绩效责任已转由你负责。该员工已完成首次校准，原评估与校准保持锁定；你可查看敏感明细并在需要时追加重新校准。`
        : `【考核职责转入】${cycleName} 中员工 ${employee} 的上级评估已转由你负责。原 Leader 的有效提交继续生效，你可查看并在正式重新提交后接管当前答卷。`;
    }
    case 'manager_responsibility_transferred_out': {
      const employee = displayText(payload.employeeOpenId, '该员工');
      return `【考核职责转出】${cycleName} 中员工 ${employee} 已从你的责任范围移出。你将不能继续查看敏感明细、修改上级评估或参与后续校准。`;
    }
    case 'cycle_start_failed': {
      const issues = Array.isArray(payload.issues)
        ? payload.issues
            .map((issue) => {
              if (!issue || typeof issue !== 'object') {
                return displayText(issue, '启动检查未通过');
              }
              const item = issue as { path?: unknown; message?: unknown };
              const path = item.path
                ? `${displayText(item.path, '配置项')}：`
                : '';
              return `${path}${displayText(item.message, '启动检查未通过')}`;
            })
            .join('；')
        : displayText(payload.issues, '启动检查未通过');
      return `【绩效周期启动失败】${cycleName} 未能按计划启动，周期仍保持待启动。具体问题：${issues}`;
    }
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
  /** 飞书通知发送开关（lark.notification.enabled）：关闭时通知只落库不外发 */
  private readonly sendEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly larkService: LarkService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.sendEnabled =
      configService.get<boolean>('lark.notification.enabled') ?? true;
    if (!this.sendEnabled) {
      this.logger.warn(
        '飞书通知发送已关闭（lark.notification.enabled=false），通知将只落库不外发',
      );
    }
  }

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
    // 发送开关关闭时不外发：记录保持 PENDING，开关打开后可继续发送
    if (!this.sendEnabled) return;

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
