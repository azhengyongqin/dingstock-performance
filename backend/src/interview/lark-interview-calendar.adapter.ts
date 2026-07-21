import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import { LARK_CLIENT } from '../shared/lark/lark.constants';
import type {
  CancelInterviewCalendarEventInput,
  CreateInterviewCalendarEventInput,
  InterviewCalendarEventRef,
  InterviewCalendarPort,
  UpdateInterviewCalendarEventInput,
} from './interview-calendar.port';

/** 以操作者 user_access_token 在主日历上创建/改期/取消绩效面谈日程。 */
@Injectable()
export class LarkInterviewCalendarAdapter implements InterviewCalendarPort {
  constructor(@Inject(LARK_CLIENT) private readonly client: lark.Client) {}

  async createEvent(
    input: CreateInterviewCalendarEventInput,
  ): Promise<InterviewCalendarEventRef> {
    const calendarId = 'primary';
    const createRes = await this.client.calendar.v4.calendarEvent.create(
      {
        path: { calendar_id: calendarId },
        params: { user_id_type: 'open_id' },
        data: {
          summary: input.summary,
          description: input.description,
          start_time: { timestamp: String(Math.floor(input.startAt.getTime() / 1000)) },
          end_time: { timestamp: String(Math.floor(input.endAt.getTime() / 1000)) },
          attendee_ability: 'can_see_others',
          free_busy_status: 'busy',
        },
      },
      lark.withUserAccessToken(input.userAccessToken),
    );

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
        await this.client.calendar.v4.calendarEventAttendee.create(
          {
            path: { calendar_id: calendarId, event_id: eventId },
            params: { user_id_type: 'open_id' },
            data: { attendees, need_notification: true },
          },
          lark.withUserAccessToken(input.userAccessToken),
        );
      if (attendeeRes.code !== 0) {
        // 参会人失败则回滚空日程，避免幽灵会议
        await this.client.calendar.v4.calendarEvent.delete(
          {
            path: { calendar_id: calendarId, event_id: eventId },
            params: { need_notification: 'false' },
          },
          lark.withUserAccessToken(input.userAccessToken),
        );
        throw new ServiceUnavailableException(
          `添加飞书日程参会人失败：${attendeeRes.msg ?? 'unknown error'}`,
        );
      }
    }

    return { calendarId, eventId };
  }

  async updateEvent(input: UpdateInterviewCalendarEventInput): Promise<void> {
    const res = await this.client.calendar.v4.calendarEvent.patch(
      {
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
      },
      lark.withUserAccessToken(input.userAccessToken),
    );
    if (res.code !== 0) {
      throw new ServiceUnavailableException(
        `更新飞书日程失败：${res.msg ?? 'unknown error'}`,
      );
    }
  }

  async cancelEvent(input: CancelInterviewCalendarEventInput): Promise<void> {
    const res = await this.client.calendar.v4.calendarEvent.delete(
      {
        path: {
          calendar_id: input.calendarId,
          event_id: input.eventId,
        },
        params: { need_notification: 'true' },
      },
      lark.withUserAccessToken(input.userAccessToken),
    );
    if (res.code !== 0) {
      throw new ServiceUnavailableException(
        `取消飞书日程失败：${res.msg ?? 'unknown error'}`,
      );
    }
  }
}
