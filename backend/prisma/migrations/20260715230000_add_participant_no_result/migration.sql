-- Ticket 12：缺失必需自评时，以独立参与者终态收口且不伪造绩效结果。
ALTER TYPE "performance"."PerfParticipantStatus" ADD VALUE 'NO_RESULT';
