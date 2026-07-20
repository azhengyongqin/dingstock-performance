import type {
  FormTemplateSubformContract,
  FormTemplateJobLevelPrefix,
  FormTemplateVersionStatus,
} from '../form-template/form-template.contract';
import type {
  PerformanceLevel,
  RatingConstraintRule,
  ScoreConstraintRule,
} from '../calculation/stage-result-calculator';

export const CONFIG_STAGES = ['SELF', 'PEER', 'MANAGER', 'AI'] as const;
export type ConfigStage = (typeof CONFIG_STAGES)[number];

export const SCHEDULE_STAGES = ['SELF', 'PEER', 'MANAGER'] as const;
export type ScheduleStage = (typeof SCHEDULE_STAGES)[number];

export const PERFORMANCE_LEVELS = ['S', 'A', 'B', 'C'] as const;

export const REVIEWER_RELATIONS = [
  'ORG_OWNER',
  'PROJECT_OWNER',
  'PEER',
  'CROSS_DEPT',
] as const;
export type ReviewerRelation = (typeof REVIEWER_RELATIONS)[number];

export const REMINDER_FREQUENCIES = [
  'ONCE_AT_DEADLINE',
  'DAILY_AFTER_DEADLINE',
  'EVERY_N_DAYS_AFTER_DEADLINE',
] as const;
export type ReminderFrequencyType = (typeof REMINDER_FREQUENCIES)[number];

export type ConfigRatingDefinition = {
  symbol: PerformanceLevel;
  name: string;
  description?: string | null;
  minScore: string;
  maxScore: string;
  mappingScore: string;
};

export type ConfigRatingConstraintRule = RatingConstraintRule & {
  enabled: boolean;
};

export type ConfigScoreConstraintRule = ScoreConstraintRule & {
  enabled: boolean;
};

export type ConfigConstraintProfiles = {
  WEIGHTED_RATING: readonly ConfigRatingConstraintRule[];
  WEIGHTED_SCORE: readonly ConfigScoreConstraintRule[];
};

export type ReviewerRelationWeight = {
  /** 百分比统一用十进制字符串传输，避免 JSON number 引入二进制浮点误差。 */
  ORG_OWNER: string;
  PROJECT_OWNER: string;
  PEER: string;
  CROSS_DEPT: string;
};

export type ConfigFormBinding = {
  formTemplateVersionId: number;
  status: FormTemplateVersionStatus;
  jobLevelPrefix: FormTemplateJobLevelPrefix;
  subforms: readonly FormTemplateSubformContract[];
};

export type ScheduleStagePreset = {
  stage: ScheduleStage;
  startOffsetMinutes: number;
  reminderDeadlineOffsetMinutes: number;
};

export type SchedulePreset = {
  allowStageOverlap: boolean;
  stages: readonly ScheduleStagePreset[];
};

export type NotificationTargetRule = {
  enabled: boolean;
  recipient: 'ASSIGNEE';
  ccLeader: boolean;
  ccHr: boolean;
};

export type ReminderFrequency =
  | { type: 'ONCE_AT_DEADLINE' }
  | { type: 'DAILY_AFTER_DEADLINE' }
  | { type: 'EVERY_N_DAYS_AFTER_DEADLINE'; intervalDays: number };

export type NotificationStageRule = {
  stage: ScheduleStage;
  taskOpened: NotificationTargetRule;
  reminder: NotificationTargetRule & { frequency: ReminderFrequency };
};

export type NotificationRules = {
  stages: readonly NotificationStageRule[];
};

export type ConfigTemplateVersionContract = {
  name: string;
  description?: string | null;
  ratings: readonly ConfigRatingDefinition[];
  reviewerRelationWeights: ReviewerRelationWeight;
  formBindings: readonly ConfigFormBinding[];
  schedulePreset: SchedulePreset;
  notificationRules: NotificationRules;
};

export type ConfigTemplatePublicationIssue = {
  code: string;
  path: string;
  message: string;
};
