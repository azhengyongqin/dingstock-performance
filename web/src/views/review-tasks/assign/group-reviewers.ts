/**
 * 评审员关系词表与按关系分组（CONTEXT.md「评审员关系」）：
 * 固定五类，分组顺序按视角权重：直属上级 → 组织负责人 → 项目负责人 → 同部门同事 → 跨部门协作方。
 */

export const RELATION_LABEL: Record<string, string> = {
  LEADER: '直属上级',
  ORG_OWNER: '组织负责人',
  PROJECT_OWNER: '项目负责人',
  PEER: '同部门同事',
  CROSS_DEPT: '跨部门协作方'
}

/** 分组顺序 = RELATION_LABEL 的键序（视角权重） */
const RELATION_ORDER = Object.keys(RELATION_LABEL)

export type ReviewerGroup<T extends { relation: string }> = {
  relation: string
  label: string
  entries: T[]
}

/**
 * 按关系分组；默认剔除空分组，includeEmpty 时五类分组全部保留（空组 entries 为空数组）。
 * 未知关系兜底排在已知分组之后、标签回退为原值，且只在有成员时出现。
 */
export const groupReviewersByRelation = <T extends { relation: string }>(
  entries: T[],
  options?: { includeEmpty?: boolean }
): ReviewerGroup<T>[] => {
  const byRelation = new Map<string, T[]>()

  for (const entry of entries) {
    const list = byRelation.get(entry.relation) ?? []

    list.push(entry)
    byRelation.set(entry.relation, list)
  }

  const relations = [
    ...RELATION_ORDER.filter(relation => options?.includeEmpty || byRelation.has(relation)),
    ...[...byRelation.keys()].filter(relation => !RELATION_ORDER.includes(relation))
  ]

  return relations.map(relation => ({
    relation,
    label: RELATION_LABEL[relation] ?? relation,
    entries: byRelation.get(relation) ?? []
  }))
}
