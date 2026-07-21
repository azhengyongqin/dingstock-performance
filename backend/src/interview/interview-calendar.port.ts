/** 飞书面谈日程端口：以操作者 user_access_token 代建/改期/取消。 */
export const INTERVIEW_CALENDAR_PORT = Symbol('INTERVIEW_CALENDAR_PORT');

export type InterviewCalendarEventRef = {
  calendarId: string;
  eventId: string;
};

export type CreateInterviewCalendarEventInput = {
  userAccessToken: string;
  summary: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  attendeeOpenIds: string[];
};

export type UpdateInterviewCalendarEventInput = {
  userAccessToken: string;
  calendarId: string;
  eventId: string;
  startAt: Date;
  endAt: Date;
  attendeeOpenIds?: string[];
};

export type CancelInterviewCalendarEventInput = {
  userAccessToken: string;
  calendarId: string;
  eventId: string;
};

export interface InterviewCalendarPort {
  createEvent(
    input: CreateInterviewCalendarEventInput,
  ): Promise<InterviewCalendarEventRef>;
  updateEvent(input: UpdateInterviewCalendarEventInput): Promise<void>;
  cancelEvent(input: CancelInterviewCalendarEventInput): Promise<void>;
}
