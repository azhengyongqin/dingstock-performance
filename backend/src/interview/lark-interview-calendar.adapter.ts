import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as lark from '@larksuiteoapi/node-sdk';
import { LARK_CLIENT } from '../shared/lark/lark.constants';
import type {
  CancelInterviewCalendarEventInput,
  CreateInterviewCalendarEventInput,
  InterviewCalendarEventRef,
  InterviewCalendarPort,
  UpdateInterviewCalendarEventInput,
} from './interview-calendar.port';

/**
 * 以应用身份（LARK_APP_ID 对应 tenant_access_token）在应用主日历上创建/改期/取消面谈日程。
 * 不依赖操作者 user_access_token，避免本地/开发登录无用户令牌时预约失败。
 */
@Injectable()
export class LarkInterviewCalendarAdapter implements InterviewCalendarPort {
  private cachedCalendarId: string | null = null;

  constructor(
    @Inject(LARK_CLIENT) private readonly client: lark.Client,
    private readonly configService: ConfigService,
  ) {}

  async createEvent(
    input: CreateInterviewCalendarEventInput,
  ): Promise<InterviewCalendarEventRef> {
    const calendarId = await this.resolveAppCalendarId();
    const createRes = await this.client.calendar.v4.calendarEvent.create({
      path: { calendar_id: calendarId },
      params: { user_id_type: 'open_id' },
      data: {
        summary: input.summary,
        description: input.description,
        start_time: {
          timestamp: String(Math.floor(input.startAt.getTime() / 1000)),
        },
        end_time: {
          timestamp: String(Math.floor(input.endAt.getTime() / 1000)),
        },
        attendee_ability: 'can_see_others',
        free_busy_status: 'busy',
      },
    });

    if (createRes.code !== 0 || !createRes.data?.event?.event_id) {
      throw new ServiceUnavailableException(
        `创建飞书日程失败：${createRes.msg ?? 'unknown error'}`,
      );
    }

    const eventId = createRes.data.event.event_id;
    const attendees = input.attendeeOpenIds.map((openId) => ({
      type: 'user' as const,
      user_id: openId,
    }));

    if (attendees.length > 0) {
      const attendeeRes =
        await this.client.calendar.v4.calendarEventAttendee.create({
          path: { calendar_id: calendarId, event_id: eventId },
          params: { user_id_type: 'open_id' },
          data: { attendees, need_notification: true },
        });
      if (attendeeRes.code !== 0) {
        // 参会人失败则回滚空日程，避免幽灵会议
        await this.client.calendar.v4.calendarEvent.delete({
          path: { calendar_id: calendarId, event_id: eventId },
          params: { need_notification: 'false' },
        });
        throw new ServiceUnavailableException(
          `添加飞书日程参会人失败：${attendeeRes.msg ?? 'unknown error'}`,
        );
      }
    }

    return { calendarId, eventId };
  }

  async updateEvent(input: UpdateInterviewCalendarEventInput): Promise<void> {
    const res = await this.client.calendar.v4.calendarEvent.patch({
      path: {
        calendar_id: input.calendarId,
        event_id: input.eventId,
      },
      params: { user_id_type: 'open_id' },
      data: {
        start_time: {
          timestamp: String(Math.floor(input.startAt.getTime() / 1000)),
        },
        end_time: {
          timestamp: String(Math.floor(input.endAt.getTime() / 1000)),
        },
      },
    });
    if (res.code !== 0) {
      throw new ServiceUnavailableException(
        `更新飞书日程失败：${res.msg ?? 'unknown error'}`,
      );
    }
  }

  async cancelEvent(input: CancelInterviewCalendarEventInput): Promise<void> {
    const res = await this.client.calendar.v4.calendarEvent.delete({
      path: {
        calendar_id: input.calendarId,
        event_id: input.eventId,
      },
      params: { need_notification: 'true' },
    });
    if (res.code !== 0) {
      throw new ServiceUnavailableException(
        `取消飞书日程失败：${res.msg ?? 'unknown error'}`,
      );
    }
  }

  /** 优先配置日历；否则查询应用主日历（需开启机器人能力与日历权限）。 */
  private async resolveAppCalendarId(): Promise<string> {
    if (this.cachedCalendarId) return this.cachedCalendarId;

    const configured = this.configService.get<string>(
      'lark.interviewCalendarId',
    );
    if (configured?.trim()) {
      this.cachedCalendarId = configured.trim();
      return this.cachedCalendarId;
    }

    const primaryRes = await this.client.calendar.v4.calendar.primary({
      params: { user_id_type: 'open_id' },
    });
    const calendarId =
      primaryRes.data?.calendars?.[0]?.calendar?.calendar_id ?? null;
    if (primaryRes.code !== 0 || !calendarId) {
      throw new ServiceUnavailableException(
        `获取应用主日历失败：${primaryRes.msg ?? 'unknown error'}（请确认应用已开启机器人能力与日历权限）`,
      );
    }

    this.cachedCalendarId = calendarId;
    return calendarId;
  }
}
