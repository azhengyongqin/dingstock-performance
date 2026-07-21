/** 飞书面谈日程端口：以应用身份（tenant_access_token / APP_ID）创建、改期、取消。 */
export const INTERVIEW_CALENDAR_PORT = Symbol('INTERVIEW_CALENDAR_PORT');

export type InterviewCalendarEventRef = {
  calendarId: string;
  eventId: string;
};

export type CreateInterviewCalendarEventInput = {
  summary: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  attendeeOpenIds: string[];
};

export type UpdateInterviewCalendarEventInput = {
  calendarId: string;
  eventId: string;
  startAt: Date;
  endAt: Date;
  attendeeOpenIds?: string[];
};

export type CancelInterviewCalendarEventInput = {
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
