import { StageCalculationError } from '../calculation/stage-result-calculator';
import {
  calculateUnifiedStageResult,
  type UnifiedScoringMethod,
  type UnifiedStageResult,
} from '../calculation/unified-stage-result-calculator';
import {
  PERFORMANCE_LEVELS,
  REVIEWER_RELATIONS,
  type ConfigStage,
  type ConfigTemplatePublicationIssue,
  type ConfigTemplateVersionContract,
  type ReviewerRelation,
} from './config-template.contract';
import { validateConfigTemplatePublication } from './publication-validator';

export type CalculationPreviewRelationInput = {
  relation: ReviewerRelation | 'LEADER' | 'DIRECT';
  rawValues: readonly string[];
};

export type CalculationPreviewDimensionInput = {
  id: string;
  name: string;
  scoringMethod: UnifiedScoringMethod;
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
      formTemplateVersionId?: number;
      result:
        | { type: 'AI_DIRECT_RATING'; level: 'S' | 'A' | 'B' | 'C' }
        | UnifiedStageResult;
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

  // AI 建议仍直接产生等级，但它不是人工阶段，也不对管理员暴露“阶段模式”。
  if (input.stage === 'AI') {
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
      result: { type: 'AI_DIRECT_RATING', level: input.directLevel },
    };
  }

  const dimensions = input.dimensions ?? [];
  const relationIssues: ConfigTemplatePublicationIssue[] = [];
  const relationWeights = input.config.reviewerRelationWeights;
  const engineDimensions = dimensions.map((dimension, dimensionIndex) => ({
    id: dimension.id,
    name: dimension.name,
    scoringMethod: dimension.scoringMethod,
    weight: dimension.weight,
    isCore: dimension.isCore,
    relations: dimension.relations.flatMap((relation, relationIndex) => {
      const relationPath = `dimensions[${dimensionIndex}].relations[${relationIndex}]`;
      const allowed =
        input.stage === 'PEER'
          ? REVIEWER_RELATIONS.includes(relation.relation as ReviewerRelation)
          : input.stage === 'SELF'
            ? relation.relation === 'DIRECT'
            : relation.relation === 'LEADER';
      if (!allowed) {
        relationIssues.push(
          previewIssue(
            'PREVIEW_RELATION_INVALID',
            `${relationPath}.relation`,
            input.stage === 'PEER'
              ? 'PEER 预览只接受四类 360°关系'
              : input.stage === 'SELF'
                ? 'SELF 预览只接受员工本人直接填写关系'
                : 'MANAGER 预览只接受直属 Leader 填写关系',
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
        input.stage === 'PEER'
          ? relationWeights[relation.relation as ReviewerRelation]
          : '100';
      return [
        {
          type: relation.relation,
          weight,
          items: relation.rawValues.map((rawValue, valueIndex) => ({
            submissionId: `${dimension.id}-${relation.relation}-${valueIndex + 1}`,
            ...(dimension.scoringMethod === 'RATING'
              ? { rawLevel: rawValue as 'S' | 'A' | 'B' | 'C' }
              : { rawScore: rawValue }),
          })),
        },
      ];
    }),
  }));

  if (relationIssues.length > 0) {
    return { status: 'UNAVAILABLE', issues: relationIssues };
  }

  try {
    const result = calculateUnifiedStageResult({
      ratings: input.config.ratings.map((rating) => ({
        symbol: rating.symbol,
        minScore: rating.minScore,
        maxScore: rating.maxScore,
        mappingScore: rating.mappingScore,
      })),
      dimensions: engineDimensions,
      confirmedRedLine: null,
    });
    return {
      status: 'READY',
      stage: input.stage,
      jobLevelPrefix: input.jobLevelPrefix,
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
