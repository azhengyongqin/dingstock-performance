import {
  FORM_TEMPLATE_JOB_LEVEL_PREFIXES,
  type FormTemplateJobLevelPrefix,
} from './form-template.contract';

export type FormTemplatePrefixCandidate = {
  id: number;
  jobLevelPrefix: FormTemplateJobLevelPrefix;
};

export type FormTemplatePrefixCoverageIssue = {
  code: 'PREFIX_MISSING' | 'PREFIX_DUPLICATE';
  prefix: FormTemplateJobLevelPrefix;
  versionIds: number[];
  message: string;
};

export type FormTemplatePrefixCoverage = {
  complete: boolean;
  matches: Record<FormTemplateJobLevelPrefix, number[]>;
  issues: FormTemplatePrefixCoverageIssue[];
};

/** 分析一组候选表单版本是否让当前系统职级 D/M 均唯一匹配。 */
export function analyzeFormTemplatePrefixCoverage(
  candidates: readonly FormTemplatePrefixCandidate[],
): FormTemplatePrefixCoverage {
  const matches = Object.fromEntries(
    FORM_TEMPLATE_JOB_LEVEL_PREFIXES.map((prefix) => [
      prefix,
      candidates
        .filter((candidate) => candidate.jobLevelPrefix === prefix)
        .map((candidate) => candidate.id),
    ]),
  ) as Record<FormTemplateJobLevelPrefix, number[]>;

  const issues: FormTemplatePrefixCoverageIssue[] = [];
  for (const prefix of FORM_TEMPLATE_JOB_LEVEL_PREFIXES) {
    const versionIds = matches[prefix];
    if (versionIds.length > 1) {
      issues.push({
        code: 'PREFIX_DUPLICATE',
        prefix,
        versionIds,
        message: `职级前缀 ${prefix} 同时匹配多个表单版本`,
      });
    } else if (versionIds.length === 0) {
      issues.push({
        code: 'PREFIX_MISSING',
        prefix,
        versionIds,
        message: `职级前缀 ${prefix} 缺少表单版本覆盖`,
      });
    }
  }

  return { complete: issues.length === 0, matches, issues };
}
