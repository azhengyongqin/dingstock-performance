import type { ConfigTemplateVersionContract } from './config-template.contract';

/**
 * 创建标准配置模板草稿。
 *
 * 权威文档没有给出默认日程天数，因此用 0/0 明确保持不可发布，要求 Admin 在发布前完成日程配置。
 */
export function buildDefaultConfigTemplate(
  formBindings: ConfigTemplateVersionContract['formBindings'] = [],
): ConfigTemplateVersionContract {
  return {
    name: '标准半年度绩效配置',
    description: '标准 S/A/B/C 评级、统一维度计算和 360°关系权重',
    ratings: [
      {
        symbol: 'S',
        name: '卓越',
        description: '工作结果、成长速度等方面有重大突破和创新',
        minScore: '90',
        maxScore: '100',
        mappingScore: '95',
      },
      {
        symbol: 'A',
        name: '优秀',
        description: '整体表现超出预期',
        minScore: '80',
        maxScore: '90',
        mappingScore: '85',
      },
      {
        symbol: 'B',
        name: '良好',
        description: '整体表现符合预期',
        minScore: '60',
        maxScore: '80',
        mappingScore: '70',
      },
      {
        symbol: 'C',
        name: '不符预期',
        description: '绩效目标、工作态度或价值观表现不符合预期',
        minScore: '0',
        maxScore: '60',
        mappingScore: '50',
      },
    ],
    reviewerRelationWeights: {
      ORG_OWNER: '30',
      PROJECT_OWNER: '30',
      PEER: '25',
      CROSS_DEPT: '15',
    },
    formBindings,
    schedulePreset: {
      allowStageOverlap: true,
      stages: [
        {
          stage: 'SELF',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 0,
        },
        {
          stage: 'PEER',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 0,
        },
        {
          stage: 'MANAGER',
          startOffsetMinutes: 0,
          reminderDeadlineOffsetMinutes: 0,
        },
      ],
    },
    notificationRules: {
      stages: (['SELF', 'PEER', 'MANAGER'] as const).map((stage) => ({
        stage,
        taskOpened: {
          enabled: true,
          recipient: 'ASSIGNEE',
          ccLeader: stage !== 'MANAGER',
          ccHr: false,
        },
        reminder: {
          enabled: true,
          recipient: 'ASSIGNEE',
          ccLeader: stage !== 'MANAGER',
          ccHr: false,
          frequency: { type: 'ONCE_AT_DEADLINE' },
        },
      })),
    },
  };
}
