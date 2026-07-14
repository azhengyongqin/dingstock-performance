import { DEFAULT_FORM_TEMPLATES } from '../form-template/default-form-templates';
import type { ConfigTemplateVersionContract } from './config-template.contract';
import { buildDefaultConfigTemplate } from './default-config-template';
import { validateConfigTemplatePublication } from './publication-validator';

function validConfig(): ConfigTemplateVersionContract {
  const bindings = DEFAULT_FORM_TEMPLATES.map((template, index) => ({
    formTemplateVersionId: index + 1,
    status: 'PUBLISHED' as const,
    jobLevelPrefix: template.jobLevelPrefix,
    subforms: template.subforms,
  }));
  const value = buildDefaultConfigTemplate(bindings);
  return {
    ...value,
    schedulePreset: {
      allowStageOverlap: true,
      stages: [
        {
          stage: 'SELF',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 1440,
        },
        {
          stage: 'PEER',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 2880,
        },
        {
          stage: 'MANAGER',
          startOffsetMinutes: 1440,
          reminderDeadlineOffsetMinutes: 4320,
        },
      ],
    },
  };
}

function codes(value: ConfigTemplateVersionContract) {
  return validateConfigTemplatePublication(value).map((item) => item.code);
}

describe('validateConfigTemplatePublication', () => {
  it('接受完整默认规则、D/M 已发布绑定和合法相对日程', () => {
    expect(validateConfigTemplatePublication(validConfig())).toEqual([]);
  });

  it('默认草稿同时报告 D/M 绑定缺失和三阶段日程未完成', () => {
    const result = validateConfigTemplatePublication(
      buildDefaultConfigTemplate(),
    );

    expect(
      result.filter((item) => item.code === 'FORM_BINDING_REQUIRED'),
    ).toHaveLength(2);
    expect(
      result.filter(
        (item) => item.code === 'SCHEDULE_REMINDER_NOT_AFTER_START',
      ),
    ).toHaveLength(3);
  });

  it('一次返回所有非法阶段模式，不在首个问题处短路', () => {
    const value = validConfig() as unknown as {
      stageModes: Record<string, string>;
    };
    value.stageModes = {
      SELF: 'WEIGHTED_SCORE',
      PEER: 'DIRECT_RATING',
      MANAGER: 'DIRECT_RATING',
      AI: 'WEIGHTED_RATING',
    };

    expect(
      codes(value as unknown as ConfigTemplateVersionContract).filter(
        (code) => code === 'STAGE_MODE_INVALID',
      ),
    ).toHaveLength(4);
  });

  it('拒绝修改 S/A/B/C 固定顺序并报告评级数量问题', () => {
    const value = validConfig();
    (value as unknown as { ratings: unknown[] }).ratings = [
      value.ratings[1],
      value.ratings[0],
      value.ratings[2],
    ];
    const result = codes(value);

    expect(result).toContain('RATING_SCALE_INVALID');
    expect(result).toContain('RATING_SYMBOL_ORDER_INVALID');
  });

  it('拒绝评级区间空隙、超过两位小数和映射分落在右侧相邻档', () => {
    const value = validConfig();
    const ratings = value.ratings.map((rating) => ({ ...rating }));
    ratings[1].minScore = '80.001';
    ratings[1].mappingScore = '90';
    (value as unknown as { ratings: typeof ratings }).ratings = ratings;
    const result = codes(value);

    expect(result).toEqual(
      expect.arrayContaining([
        'RATING_PRECISION_INVALID',
        'RATING_MAPPING_OUT_OF_RANGE',
        'RATING_RANGE_NOT_CONTINUOUS',
      ]),
    );
  });

  it('允许最高档 S 的映射分取右闭边界 100', () => {
    const value = validConfig();
    const ratings = value.ratings.map((rating) => ({ ...rating }));
    ratings[0].mappingScore = '100';
    (value as unknown as { ratings: typeof ratings }).ratings = ratings;

    expect(codes(value)).not.toContain('RATING_MAPPING_OUT_OF_RANGE');
  });

  it('用精确十进制拒绝非法关系权重范围、精度和非 100 总和', () => {
    const value = validConfig();
    (
      value as { reviewerRelationWeights: Record<string, string> }
    ).reviewerRelationWeights = {
      ORG_OWNER: '0',
      PROJECT_OWNER: '30.001',
      PEER: '25',
      CROSS_DEPT: '15',
    };
    const result = codes(value);

    expect(result).toEqual(
      expect.arrayContaining([
        'RELATION_WEIGHT_INVALID',
        'RELATION_WEIGHT_PRECISION_INVALID',
        'RELATION_WEIGHT_TOTAL_INVALID',
      ]),
    );
  });

  it('关系权重固定四键，不接受额外关系字段', () => {
    const value = validConfig();
    (
      value as unknown as {
        reviewerRelationWeights: Record<string, string>;
      }
    ).reviewerRelationWeights = {
      ...value.reviewerRelationWeights,
      LEADER: '10',
    };

    expect(codes(value)).toContain('RELATION_WEIGHT_KEY_INVALID');
  });

  it('要求 D/M 各绑定且只绑定一个当时已发布版本', () => {
    const value = validConfig();
    const d = { ...value.formBindings[0], status: 'ARCHIVED' as const };
    (value as { formBindings: typeof value.formBindings }).formBindings = [
      d,
      d,
    ];
    const result = codes(value);

    expect(result).toEqual(
      expect.arrayContaining([
        'FORM_BINDING_DUPLICATE',
        'FORM_BINDING_REQUIRED',
        'FORM_VERSION_NOT_PUBLISHED',
      ]),
    );
  });

  it('逐个前缀校验 PEER/MANAGER 计分题型与阶段模式兼容', () => {
    const value = validConfig();
    const bindings = structuredClone(value.formBindings);
    const dPeer = bindings[0].subforms.find((item) => item.type === 'PEER')!;
    const dManager = bindings[0].subforms.find(
      (item) => item.type === 'MANAGER',
    )!;
    (dPeer.dimensions[0].items[0] as { type: string }).type = 'SCORE';
    (dManager.dimensions[0].items[0] as { type: string }).type = 'RATING';
    (value as { formBindings: typeof bindings }).formBindings = bindings;

    expect(
      codes(value).filter((code) => code === 'SCORING_ITEM_INCOMPATIBLE'),
    ).toHaveLength(2);
  });

  it('重新校验加权子表单核心维度数量和维度权重总和', () => {
    const value = validConfig();
    const bindings = structuredClone(value.formBindings);
    const peer = bindings[0].subforms.find((item) => item.type === 'PEER')!;
    peer.dimensions.forEach((dimension) => {
      (dimension as { isCore: boolean }).isCore = false;
    });
    (peer.dimensions[0] as { weight: number }).weight = 34;
    (value as { formBindings: typeof bindings }).formBindings = bindings;
    const result = codes(value);

    expect(result).toEqual(
      expect.arrayContaining([
        'CORE_DIMENSION_COUNT_INVALID',
        'DIMENSION_WEIGHT_TOTAL_INVALID',
      ]),
    );
  });

  it('拒绝未知、重复、跨模式和超过两位小数的约束', () => {
    const value = validConfig();
    const ratingRules = value.constraintProfiles.WEIGHTED_RATING.map(
      (rule) => ({ ...rule }),
    );
    (ratingRules[1] as { type: string }).type = 'CORE_RATING_FORCE';
    const scoreRules = value.constraintProfiles.WEIGHTED_SCORE.map((rule) => ({
      ...rule,
    }));
    scoreRules[0] = { ...scoreRules[0], threshold: '60.001' };
    (scoreRules[1] as { type: string }).type = 'CORE_RATING_CAP';
    (value as { constraintProfiles: unknown }).constraintProfiles = {
      WEIGHTED_RATING: ratingRules,
      WEIGHTED_SCORE: scoreRules,
    };
    const result = codes(value);

    expect(result).toEqual(
      expect.arrayContaining([
        'CONSTRAINT_TYPE_DUPLICATE',
        'CONSTRAINT_THRESHOLD_PRECISION_INVALID',
        'CONSTRAINT_TYPE_INVALID',
      ]),
    );
  });

  it('要求同一计算模式内的约束使用非空且唯一的稳定标识', () => {
    const value = validConfig();
    const rules = value.constraintProfiles.WEIGHTED_RATING.map((rule) => ({
      ...rule,
    }));
    rules[0].id = '';
    rules[2].id = rules[1].id;
    (value as { constraintProfiles: unknown }).constraintProfiles = {
      ...value.constraintProfiles,
      WEIGHTED_RATING: rules,
    };

    expect(codes(value)).toEqual(
      expect.arrayContaining([
        'CONSTRAINT_ID_REQUIRED',
        'CONSTRAINT_ID_DUPLICATE',
      ]),
    );
  });

  it('日程仅接受三阶段各一条非负整数且提醒晚于开始', () => {
    const value = validConfig();
    (value as { schedulePreset: unknown }).schedulePreset = {
      allowStageOverlap: true,
      stages: [
        {
          stage: 'SELF',
          startOffsetMinutes: -1,
          reminderDeadlineOffsetMinutes: 0,
        },
        {
          stage: 'SELF',
          startOffsetMinutes: 0.5,
          reminderDeadlineOffsetMinutes: 0,
        },
      ],
    };
    const result = codes(value);

    expect(result).toEqual(
      expect.arrayContaining([
        'SCHEDULE_START_OFFSET_INVALID',
        'SCHEDULE_REMINDER_NOT_AFTER_START',
        'SCHEDULE_STAGE_DUPLICATE',
        'SCHEDULE_STAGE_REQUIRED',
      ]),
    );
  });

  it('通知接收人固定为 ASSIGNEE 且自定义提醒间隔必须为正整数', () => {
    const value = validConfig();
    const rules = structuredClone(value.notificationRules);
    (rules.stages[0].taskOpened as { recipient: string }).recipient = 'OPEN_ID';
    (rules.stages[0].reminder as { frequency: unknown }).frequency = {
      type: 'EVERY_N_DAYS_AFTER_DEADLINE',
      intervalDays: 0,
    };
    (value as { notificationRules: typeof rules }).notificationRules = rules;
    const result = codes(value);

    expect(result).toEqual(
      expect.arrayContaining([
        'NOTIFICATION_RECIPIENT_INVALID',
        'NOTIFICATION_INTERVAL_INVALID',
      ]),
    );
  });

  it('通知规则不接受自由模板 key 等未受控字段', () => {
    const value = validConfig();
    const rules = structuredClone(value.notificationRules);
    (
      rules.stages[0].taskOpened as unknown as Record<string, unknown>
    ).templateKey = 'free-form-template';
    (value as { notificationRules: typeof rules }).notificationRules = rules;

    expect(codes(value)).toContain('NOTIFICATION_FIELD_INVALID');
  });
});
