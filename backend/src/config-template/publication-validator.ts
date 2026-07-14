import Decimal from 'decimal.js';
import type { FormTemplateDimensionContract } from '../form-template/form-template.contract';
import {
  PERFORMANCE_LEVELS,
  REMINDER_FREQUENCIES,
  REVIEWER_RELATIONS,
  SCHEDULE_STAGES,
  type ConfigTemplatePublicationIssue,
  type ConfigTemplateVersionContract,
} from './config-template.contract';

const RATING_RULE_TYPES = new Set([
  'CORE_RATING_FORCE',
  'CORE_RATING_CAP',
  'ANY_RATING_CAP',
]);
const SCORE_RULE_TYPES = new Set([
  'CORE_SCORE_FORCE',
  'CORE_SCORE_CAP',
  'ANY_SCORE_CAP',
]);

function decimalOf(value: unknown): Decimal | null {
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function hasAtMostTwoDecimalPlaces(value: Decimal) {
  return value.decimalPlaces() <= 2;
}

function issue(
  issues: ConfigTemplatePublicationIssue[],
  code: string,
  path: string,
  message: string,
) {
  issues.push({ code, path, message });
}

function validateStageModes(
  input: ConfigTemplateVersionContract,
  issues: ConfigTemplatePublicationIssue[],
) {
  const modes = input.stageModes as Record<string, unknown>;
  const allowed: Record<string, readonly string[]> = {
    SELF: ['DIRECT_RATING'],
    PEER: ['WEIGHTED_RATING', 'WEIGHTED_SCORE'],
    MANAGER: ['WEIGHTED_RATING', 'WEIGHTED_SCORE'],
    AI: ['DIRECT_RATING'],
  };
  for (const [stage, values] of Object.entries(allowed)) {
    if (!values.includes(String(modes?.[stage]))) {
      issue(
        issues,
        'STAGE_MODE_INVALID',
        `stageModes.${stage}`,
        `${stage} 阶段结果模式不合法`,
      );
    }
  }
}

function validateRatings(
  input: ConfigTemplateVersionContract,
  issues: ConfigTemplatePublicationIssue[],
) {
  if (input.ratings.length !== PERFORMANCE_LEVELS.length) {
    issue(
      issues,
      'RATING_SCALE_INVALID',
      'ratings',
      '评级必须且只能包含 S/A/B/C 四档',
    );
  }

  PERFORMANCE_LEVELS.forEach((symbol, index) => {
    const rating = input.ratings[index];
    if (!rating || rating.symbol !== symbol) {
      issue(
        issues,
        'RATING_SYMBOL_ORDER_INVALID',
        `ratings[${index}].symbol`,
        `评级第 ${index + 1} 档必须为 ${symbol}`,
      );
    }
  });

  const parsed = input.ratings.map((rating, index) => {
    const min = decimalOf(rating.minScore);
    const max = decimalOf(rating.maxScore);
    const mapping = decimalOf(rating.mappingScore);
    if (!rating.name?.trim()) {
      issue(
        issues,
        'RATING_NAME_REQUIRED',
        `ratings[${index}].name`,
        '评级名称不能为空',
      );
    }
    if (!min || !max || !mapping) {
      issue(
        issues,
        'RATING_NUMBER_INVALID',
        `ratings[${index}]`,
        '评级区间和映射分必须是有效十进制数',
      );
      return { rating, min, max, mapping };
    }
    if (![min, max, mapping].every(hasAtMostTwoDecimalPlaces)) {
      issue(
        issues,
        'RATING_PRECISION_INVALID',
        `ratings[${index}]`,
        '评级数值最多保留两位小数',
      );
    }
    if (min.lt(0) || max.gt(100) || !min.lt(max)) {
      issue(
        issues,
        'RATING_RANGE_INVALID',
        `ratings[${index}]`,
        '评级区间必须位于 0～100 且下限小于上限',
      );
    }
    const inRange =
      mapping.gte(min) &&
      (mapping.lt(max) ||
        (rating.symbol === 'S' && max.eq(100) && mapping.lte(max)));
    if (!inRange) {
      issue(
        issues,
        'RATING_MAPPING_OUT_OF_RANGE',
        `ratings[${index}].mappingScore`,
        '评级映射分必须落在自身区间内',
      );
    }
    if (typeof rating.commentRequired !== 'boolean') {
      issue(
        issues,
        'RATING_COMMENT_REQUIRED_INVALID',
        `ratings[${index}].commentRequired`,
        '评语必填配置必须是布尔值',
      );
    }
    return { rating, min, max, mapping };
  });

  if (parsed.length === 4 && parsed.every(({ min, max }) => min && max)) {
    const [s, a, b, c] = parsed as Array<{
      min: Decimal;
      max: Decimal;
    }>;
    if (
      !c.min.eq(0) ||
      !c.max.eq(b.min) ||
      !b.max.eq(a.min) ||
      !a.max.eq(s.min) ||
      !s.max.eq(100)
    ) {
      issue(
        issues,
        'RATING_RANGE_NOT_CONTINUOUS',
        'ratings',
        '评级区间必须连续且无重叠地覆盖 0～100',
      );
    }
  }
}

function validateConstraints(
  input: ConfigTemplateVersionContract,
  issues: ConfigTemplatePublicationIssue[],
) {
  const profiles = [
    [
      'WEIGHTED_RATING',
      input.constraintProfiles.WEIGHTED_RATING,
      RATING_RULE_TYPES,
    ],
    [
      'WEIGHTED_SCORE',
      input.constraintProfiles.WEIGHTED_SCORE,
      SCORE_RULE_TYPES,
    ],
  ] as const;
  for (const [profile, rules, allowed] of profiles) {
    const seenTypes = new Set<string>();
    const seenIds = new Set<string>();
    rules.forEach((rule, index) => {
      const path = `constraintProfiles.${profile}[${index}]`;
      if (typeof rule.id !== 'string' || rule.id.trim() === '') {
        issue(
          issues,
          'CONSTRAINT_ID_REQUIRED',
          `${path}.id`,
          '约束必须包含非空稳定标识',
        );
      } else if (seenIds.has(rule.id)) {
        issue(
          issues,
          'CONSTRAINT_ID_DUPLICATE',
          `${path}.id`,
          '同一计算模式内的约束标识不能重复',
        );
      }
      if (typeof rule.id === 'string') seenIds.add(rule.id);
      if (!allowed.has(rule.type)) {
        issue(
          issues,
          'CONSTRAINT_TYPE_INVALID',
          `${path}.type`,
          `${profile} 包含不兼容的约束类型`,
        );
      }
      if (seenTypes.has(rule.type)) {
        issue(
          issues,
          'CONSTRAINT_TYPE_DUPLICATE',
          `${path}.type`,
          '同一约束类型只能配置一次',
        );
      }
      seenTypes.add(rule.type);
      if (typeof rule.enabled !== 'boolean') {
        issue(
          issues,
          'CONSTRAINT_ENABLED_INVALID',
          `${path}.enabled`,
          '约束启用状态必须是布尔值',
        );
      }
      if (!PERFORMANCE_LEVELS.includes(rule.targetLevel)) {
        issue(
          issues,
          'CONSTRAINT_TARGET_INVALID',
          `${path}.targetLevel`,
          '约束目标等级必须为 S/A/B/C',
        );
      }
      if (
        'triggerRating' in rule &&
        !PERFORMANCE_LEVELS.includes(rule.triggerRating)
      ) {
        issue(
          issues,
          'CONSTRAINT_TRIGGER_INVALID',
          `${path}.triggerRating`,
          '触发评级必须为 S/A/B/C',
        );
      }
      if ('threshold' in rule) {
        const threshold = decimalOf(rule.threshold);
        if (!threshold || threshold.lt(0) || threshold.gt(100)) {
          issue(
            issues,
            'CONSTRAINT_THRESHOLD_INVALID',
            `${path}.threshold`,
            '评分阈值必须位于 0～100',
          );
        } else if (!hasAtMostTwoDecimalPlaces(threshold)) {
          issue(
            issues,
            'CONSTRAINT_THRESHOLD_PRECISION_INVALID',
            `${path}.threshold`,
            '评分阈值最多保留两位小数',
          );
        }
      }
    });
  }
}

function validateRelationWeights(
  input: ConfigTemplateVersionContract,
  issues: ConfigTemplatePublicationIssue[],
) {
  let total = new Decimal(0);
  const weights = input.reviewerRelationWeights as unknown as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(weights ?? {})) {
    if (!REVIEWER_RELATIONS.includes(key as never)) {
      issue(
        issues,
        'RELATION_WEIGHT_KEY_INVALID',
        `reviewerRelationWeights.${key}`,
        '关系权重只允许固定四类关系键',
      );
    }
  }
  for (const relation of REVIEWER_RELATIONS) {
    const value = decimalOf(weights?.[relation]);
    if (!value || value.lte(0) || value.gt(100)) {
      issue(
        issues,
        'RELATION_WEIGHT_INVALID',
        `reviewerRelationWeights.${relation}`,
        '关系权重必须大于 0 且不超过 100',
      );
      continue;
    }
    if (!hasAtMostTwoDecimalPlaces(value)) {
      issue(
        issues,
        'RELATION_WEIGHT_PRECISION_INVALID',
        `reviewerRelationWeights.${relation}`,
        '关系权重最多保留两位小数',
      );
    }
    total = total.plus(value);
  }
  if (!total.eq(100)) {
    issue(
      issues,
      'RELATION_WEIGHT_TOTAL_INVALID',
      'reviewerRelationWeights',
      '四类关系权重必须严格合计 100%',
    );
  }
}

function validateWeightedSubform(
  dimensions: readonly FormTemplateDimensionContract[],
  expectedType: 'RATING' | 'SCORE',
  path: string,
  issues: ConfigTemplatePublicationIssue[],
) {
  const regular = dimensions.filter(
    (dimension) => dimension.kind === 'REGULAR',
  );
  if (regular.length === 0) {
    issue(
      issues,
      'REGULAR_DIMENSION_REQUIRED',
      path,
      '加权子表单至少需要一个常规维度',
    );
    return;
  }
  if (regular.filter((dimension) => dimension.isCore).length !== 1) {
    issue(
      issues,
      'CORE_DIMENSION_COUNT_INVALID',
      path,
      '加权子表单必须且只能有一个核心维度',
    );
  }
  let total = new Decimal(0);
  regular.forEach((dimension, index) => {
    const weight = decimalOf(dimension.weight);
    if (
      !weight ||
      weight.lte(0) ||
      weight.gt(100) ||
      !hasAtMostTwoDecimalPlaces(weight)
    ) {
      issue(
        issues,
        'DIMENSION_WEIGHT_INVALID',
        `${path}.dimensions[${index}].weight`,
        '常规维度权重必须大于 0、不超过 100 且最多两位小数',
      );
    } else {
      total = total.plus(weight);
    }
    const scoringItems = dimension.items.filter((item) =>
      ['RATING', 'SCORE'].includes(item.type),
    );
    if (scoringItems.length !== 1 || scoringItems[0]?.type !== expectedType) {
      issue(
        issues,
        'SCORING_ITEM_INCOMPATIBLE',
        `${path}.dimensions[${index}].items`,
        `每个常规维度必须恰好包含一个 ${expectedType} 计分项`,
      );
    }
  });
  if (!total.eq(100)) {
    issue(
      issues,
      'DIMENSION_WEIGHT_TOTAL_INVALID',
      path,
      '常规维度权重必须严格合计 100%',
    );
  }
}

function validateBindings(
  input: ConfigTemplateVersionContract,
  issues: ConfigTemplatePublicationIssue[],
) {
  for (const prefix of ['D', 'M'] as const) {
    const bindings = input.formBindings.filter(
      (binding) => binding.jobLevelPrefix === prefix,
    );
    if (bindings.length !== 1) {
      issue(
        issues,
        bindings.length === 0
          ? 'FORM_BINDING_REQUIRED'
          : 'FORM_BINDING_DUPLICATE',
        `formBindings.${prefix}`,
        `${prefix} 职级必须且只能绑定一个表单版本`,
      );
    }
  }
  input.formBindings.forEach((binding, index) => {
    const path = `formBindings[${index}]`;
    if (binding.status !== 'PUBLISHED') {
      issue(
        issues,
        'FORM_VERSION_NOT_PUBLISHED',
        `${path}.status`,
        '配置模板只能绑定当时已发布的表单版本',
      );
    }
    if (!['D', 'M'].includes(binding.jobLevelPrefix)) {
      issue(
        issues,
        'FORM_BINDING_PREFIX_INVALID',
        `${path}.jobLevelPrefix`,
        '表单版本职级前缀必须为 D 或 M',
      );
    }
    const self = binding.subforms.find((subform) => subform.type === 'SELF');
    const peer = binding.subforms.find((subform) => subform.type === 'PEER');
    const manager = binding.subforms.find(
      (subform) => subform.type === 'MANAGER',
    );
    if (!self) {
      issue(
        issues,
        'BOUND_SUBFORM_REQUIRED',
        `${path}.subforms.SELF`,
        '绑定表单缺少 SELF 子表单',
      );
    } else {
      const regular = self.dimensions.filter(
        (dimension) => dimension.kind === 'REGULAR',
      );
      if (regular.length === 0) {
        issue(
          issues,
          'SELF_REGULAR_DIMENSION_REQUIRED',
          `${path}.subforms.SELF`,
          'SELF 子表单至少需要一个常规评级维度',
        );
      }
      regular.forEach((dimension, dimensionIndex) => {
        const scoringItems = dimension.items.filter((item) =>
          ['RATING', 'SCORE'].includes(item.type),
        );
        if (scoringItems.length !== 1 || scoringItems[0]?.type !== 'RATING') {
          issue(
            issues,
            'SELF_SCORING_ITEM_INCOMPATIBLE',
            `${path}.subforms.SELF.dimensions[${dimensionIndex}].items`,
            'SELF 常规维度必须使用唯一 RATING 计分项',
          );
        }
      });
    }
    if (!peer) {
      issue(
        issues,
        'BOUND_SUBFORM_REQUIRED',
        `${path}.subforms.PEER`,
        '绑定表单缺少 PEER 子表单',
      );
    } else {
      validateWeightedSubform(
        peer.dimensions,
        input.stageModes.PEER === 'WEIGHTED_SCORE' ? 'SCORE' : 'RATING',
        `${path}.subforms.PEER`,
        issues,
      );
    }
    if (!manager) {
      issue(
        issues,
        'BOUND_SUBFORM_REQUIRED',
        `${path}.subforms.MANAGER`,
        '绑定表单缺少 MANAGER 子表单',
      );
    } else {
      validateWeightedSubform(
        manager.dimensions,
        input.stageModes.MANAGER === 'WEIGHTED_RATING' ? 'RATING' : 'SCORE',
        `${path}.subforms.MANAGER`,
        issues,
      );
    }
  });
}

function validateSchedule(
  input: ConfigTemplateVersionContract,
  issues: ConfigTemplatePublicationIssue[],
) {
  if (typeof input.schedulePreset.allowStageOverlap !== 'boolean') {
    issue(
      issues,
      'SCHEDULE_OVERLAP_INVALID',
      'schedulePreset.allowStageOverlap',
      '阶段重叠配置必须是布尔值',
    );
  }
  const counts = new Map<string, number>();
  input.schedulePreset.stages.forEach((row, index) => {
    counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
    const path = `schedulePreset.stages[${index}]`;
    if (!SCHEDULE_STAGES.includes(row.stage)) {
      issue(
        issues,
        'SCHEDULE_STAGE_INVALID',
        `${path}.stage`,
        '日程只允许 SELF、PEER、MANAGER 三类人工任务',
      );
    }
    if (
      !Number.isInteger(row.startOffsetMinutes) ||
      row.startOffsetMinutes < 0
    ) {
      issue(
        issues,
        'SCHEDULE_START_OFFSET_INVALID',
        `${path}.startOffsetMinutes`,
        '开始偏移必须是非负整数分钟',
      );
    }
    if (
      !Number.isInteger(row.reminderDeadlineOffsetMinutes) ||
      row.reminderDeadlineOffsetMinutes < 0
    ) {
      issue(
        issues,
        'SCHEDULE_REMINDER_OFFSET_INVALID',
        `${path}.reminderDeadlineOffsetMinutes`,
        '提醒偏移必须是非负整数分钟',
      );
    }
    if (row.reminderDeadlineOffsetMinutes <= row.startOffsetMinutes) {
      issue(
        issues,
        'SCHEDULE_REMINDER_NOT_AFTER_START',
        `${path}.reminderDeadlineOffsetMinutes`,
        '填写提醒时间必须晚于任务开始时间',
      );
    }
  });
  for (const stage of SCHEDULE_STAGES) {
    const count = counts.get(stage) ?? 0;
    if (count !== 1) {
      issue(
        issues,
        count === 0 ? 'SCHEDULE_STAGE_REQUIRED' : 'SCHEDULE_STAGE_DUPLICATE',
        `schedulePreset.stages.${stage}`,
        `${stage} 日程必须且只能配置一次`,
      );
    }
  }
}

function validateNotificationTarget(
  target: Record<string, unknown>,
  path: string,
  issues: ConfigTemplatePublicationIssue[],
  allowedExtraKeys: readonly string[] = [],
) {
  const allowedKeys = new Set([
    'enabled',
    'recipient',
    'ccLeader',
    'ccHr',
    ...allowedExtraKeys,
  ]);
  for (const key of Object.keys(target)) {
    if (!allowedKeys.has(key)) {
      issue(
        issues,
        'NOTIFICATION_FIELD_INVALID',
        `${path}.${key}`,
        '通知规则包含未受控字段',
      );
    }
  }
  if (target.recipient !== 'ASSIGNEE') {
    issue(
      issues,
      'NOTIFICATION_RECIPIENT_INVALID',
      `${path}.recipient`,
      '通知接收人固定为任务执行人',
    );
  }
  for (const key of ['enabled', 'ccLeader', 'ccHr']) {
    if (typeof target[key] !== 'boolean') {
      issue(
        issues,
        'NOTIFICATION_BOOLEAN_INVALID',
        `${path}.${key}`,
        `${key} 必须是布尔值`,
      );
    }
  }
}

function validateNotifications(
  input: ConfigTemplateVersionContract,
  issues: ConfigTemplatePublicationIssue[],
) {
  const counts = new Map<string, number>();
  input.notificationRules.stages.forEach((row, index) => {
    counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
    const path = `notificationRules.stages[${index}]`;
    if (!SCHEDULE_STAGES.includes(row.stage)) {
      issue(
        issues,
        'NOTIFICATION_STAGE_INVALID',
        `${path}.stage`,
        '通知只允许 SELF、PEER、MANAGER 三类人工任务',
      );
    }
    validateNotificationTarget(row.taskOpened, `${path}.taskOpened`, issues);
    validateNotificationTarget(row.reminder, `${path}.reminder`, issues, [
      'frequency',
    ]);
    const frequency = row.reminder.frequency as {
      type?: unknown;
      intervalDays?: unknown;
    };
    if (!REMINDER_FREQUENCIES.includes(frequency?.type as never)) {
      issue(
        issues,
        'NOTIFICATION_FREQUENCY_INVALID',
        `${path}.reminder.frequency.type`,
        '提醒频率不在受控范围内',
      );
    }
    if (
      frequency?.type === 'EVERY_N_DAYS_AFTER_DEADLINE' &&
      (!Number.isInteger(frequency.intervalDays) ||
        Number(frequency.intervalDays) <= 0)
    ) {
      issue(
        issues,
        'NOTIFICATION_INTERVAL_INVALID',
        `${path}.reminder.frequency.intervalDays`,
        '自定义提醒间隔必须是正整数天',
      );
    }
    if (
      frequency?.type !== 'EVERY_N_DAYS_AFTER_DEADLINE' &&
      frequency?.intervalDays !== undefined
    ) {
      issue(
        issues,
        'NOTIFICATION_INTERVAL_NOT_ALLOWED',
        `${path}.reminder.frequency.intervalDays`,
        '当前提醒频率不允许配置自定义间隔',
      );
    }
  });
  for (const stage of SCHEDULE_STAGES) {
    const count = counts.get(stage) ?? 0;
    if (count !== 1) {
      issue(
        issues,
        count === 0
          ? 'NOTIFICATION_STAGE_REQUIRED'
          : 'NOTIFICATION_STAGE_DUPLICATE',
        `notificationRules.stages.${stage}`,
        `${stage} 通知规则必须且只能配置一次`,
      );
    }
  }
}

/** 发布校验公开入口：不短路，一次返回全部配置与绑定问题。 */
export function validateConfigTemplatePublication(
  input: ConfigTemplateVersionContract,
): ConfigTemplatePublicationIssue[] {
  const issues: ConfigTemplatePublicationIssue[] = [];
  validateStageModes(input, issues);
  validateRatings(input, issues);
  validateConstraints(input, issues);
  validateRelationWeights(input, issues);
  validateBindings(input, issues);
  validateSchedule(input, issues);
  validateNotifications(input, issues);
  return issues;
}
