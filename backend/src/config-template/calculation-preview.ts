import {
  calculateStageResult,
  StageCalculationError,
  type StageResult,
} from '../calculation/stage-result-calculator';
import {
  PERFORMANCE_LEVELS,
  REVIEWER_RELATIONS,
  type ConfigStage,
  type ConfigStageMode,
  type ConfigTemplatePublicationIssue,
  type ConfigTemplateVersionContract,
  type ReviewerRelation,
} from './config-template.contract';
import { validateConfigTemplatePublication } from './publication-validator';

export type CalculationPreviewRelationInput = {
  relation: ReviewerRelation | 'LEADER';
  rawValues: readonly string[];
};

export type CalculationPreviewDimensionInput = {
  id: string;
  name: string;
  weight: string;
  isCore: boolean;
  relations: readonly CalculationPreviewRelationInput[];
};

export type ConfigCalculationPreviewInput = {
  config: ConfigTemplateVersionContract;
  stage: ConfigStage;
  jobLevelPrefix: 'D' | 'M';
  directLevel?: 'S' | 'A' | 'B' | 'C';
  dimensions?: readonly CalculationPreviewDimensionInput[];
};

export type ConfigCalculationPreview =
  | {
      status: 'UNAVAILABLE';
      issues: readonly ConfigTemplatePublicationIssue[];
    }
  | {
      status: 'READY';
      stage: ConfigStage;
      jobLevelPrefix: 'D' | 'M';
      mode: ConfigStageMode;
      formTemplateVersionId?: number;
      result:
        { type: 'DIRECT_RATING'; level: 'S' | 'A' | 'B' | 'C' } | StageResult;
    };

function previewIssue(
  code: string,
  path: string,
  message: string,
): ConfigTemplatePublicationIssue {
  return { code, path, message };
}

/**
 * 预览只负责把配置模板输入适配为统一计算引擎契约；所有权重、舍入和约束计算均由 Ticket 01 引擎完成。
 */
export function previewConfigCalculation(
  input: ConfigCalculationPreviewInput,
): ConfigCalculationPreview {
  const publicationIssues = validateConfigTemplatePublication(input.config);
  if (publicationIssues.length > 0) {
    return { status: 'UNAVAILABLE', issues: publicationIssues };
  }

  const mode = input.config.stageModes[input.stage];
  const binding = input.config.formBindings.find(
    (candidate) => candidate.jobLevelPrefix === input.jobLevelPrefix,
  );
  if (!binding) {
    return {
      status: 'UNAVAILABLE',
      issues: [
        previewIssue(
          'PREVIEW_FORM_BINDING_MISSING',
          'jobLevelPrefix',
          `职级前缀 ${input.jobLevelPrefix} 没有可用表单绑定`,
        ),
      ],
    };
  }

  if (mode === 'DIRECT_RATING') {
    if (!input.directLevel || !PERFORMANCE_LEVELS.includes(input.directLevel)) {
      return {
        status: 'UNAVAILABLE',
        issues: [
          previewIssue(
            'PREVIEW_DIRECT_LEVEL_REQUIRED',
            'directLevel',
            '直接评级预览必须提供 S/A/B/C 等级',
          ),
        ],
      };
    }
    return {
      status: 'READY',
      stage: input.stage,
      jobLevelPrefix: input.jobLevelPrefix,
      mode,
      ...(input.stage === 'SELF'
        ? { formTemplateVersionId: binding.formTemplateVersionId }
        : {}),
      result: { type: 'DIRECT_RATING', level: input.directLevel },
    };
  }

  const dimensions = input.dimensions ?? [];
  const relationIssues: ConfigTemplatePublicationIssue[] = [];
  const relationWeights = input.config.reviewerRelationWeights;
  const engineDimensions = dimensions.map((dimension, dimensionIndex) => ({
    id: dimension.id,
    name: dimension.name,
    weight: dimension.weight,
    isCore: dimension.isCore,
    relations: dimension.relations.flatMap((relation, relationIndex) => {
      const relationPath = `dimensions[${dimensionIndex}].relations[${relationIndex}]`;
      const allowed =
        input.stage === 'PEER'
          ? REVIEWER_RELATIONS.includes(relation.relation as ReviewerRelation)
          : relation.relation === 'LEADER';
      if (!allowed) {
        relationIssues.push(
          previewIssue(
            'PREVIEW_RELATION_INVALID',
            `${relationPath}.relation`,
            input.stage === 'PEER'
              ? 'PEER 预览只接受四类 360°关系'
              : 'MANAGER 预览只接受 LEADER 关系',
          ),
        );
        return [];
      }
      if (relation.rawValues.length === 0) {
        relationIssues.push(
          previewIssue(
            'PREVIEW_RELATION_VALUES_REQUIRED',
            `${relationPath}.rawValues`,
            '有效预览关系至少需要一个原始填写值',
          ),
        );
        return [];
      }
      const weight =
        input.stage === 'MANAGER'
          ? '100'
          : relationWeights[relation.relation as ReviewerRelation];
      return [
        {
          type: relation.relation,
          weight,
          items: relation.rawValues.map((rawValue, valueIndex) => ({
            itemId: `${dimension.id}-scoring-item`,
            submissionId: `${dimension.id}-${relation.relation}-${valueIndex + 1}`,
            rawValue,
          })),
        },
      ];
    }),
  }));

  if (relationIssues.length > 0) {
    return { status: 'UNAVAILABLE', issues: relationIssues };
  }

  const profile = input.config.constraintProfiles[mode];
  const constraints = profile
    .filter((rule) => rule.enabled)
    .map((rule) =>
      'triggerRating' in rule
        ? {
            id: rule.id,
            type: rule.type,
            triggerRating: rule.triggerRating,
            targetLevel: rule.targetLevel,
          }
        : {
            id: rule.id,
            type: rule.type,
            threshold: rule.threshold,
            targetLevel: rule.targetLevel,
          },
    );

  try {
    const result = calculateStageResult({
      mode,
      ratings: input.config.ratings.map((rating) => ({
        symbol: rating.symbol,
        minScore: rating.minScore,
        maxScore: rating.maxScore,
        mappingScore: rating.mappingScore,
      })),
      dimensions: engineDimensions,
      constraints,
      confirmedRedLine: null,
    });
    return {
      status: 'READY',
      stage: input.stage,
      jobLevelPrefix: input.jobLevelPrefix,
      mode,
      formTemplateVersionId: binding.formTemplateVersionId,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '计算预览输入无效';
    return {
      status: 'UNAVAILABLE',
      issues: [
        previewIssue(
          error instanceof StageCalculationError
            ? `PREVIEW_${error.code}`
            : 'PREVIEW_CALCULATION_FAILED',
          'dimensions',
          message,
        ),
      ],
    };
  }
}
