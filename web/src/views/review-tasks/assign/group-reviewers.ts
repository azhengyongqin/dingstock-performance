/**
 * 评审员关系词表与按关系分组（CONTEXT.md「评审员关系」）：
 * 360°只使用四类计算关系；直属 Leader 由 MANAGER 阶段承载，不进入本分组。
 */

export const REVIEWER_RELATIONS = ['ORG_OWNER', 'PROJECT_OWNER', 'PEER', 'CROSS_DEPT'] as const

export type ReviewerRelation = (typeof REVIEWER_RELATIONS)[number]

export const RELATION_LABEL: Record<ReviewerRelation, string> = {
  ORG_OWNER: '组织负责人',
  PROJECT_OWNER: '项目负责人',
  PEER: '同部门同事',
  CROSS_DEPT: '跨部门协作方'
}

/** 分组顺序 = RELATION_LABEL 的键序（视角权重） */
const RELATION_ORDER: readonly ReviewerRelation[] = REVIEWER_RELATIONS

export type ReviewerGroup<T extends { relation: string }> = {
  relation: ReviewerRelation
  label: string
  entries: T[]
}

/**
 * 按关系分组；默认剔除空分组，includeEmpty 时四类分组全部保留（空组 entries 为空数组）。
 * 历史 LEADER 或未知关系不会进入可编辑名单，避免被重新保存为当前有效指派。
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

  const relations = RELATION_ORDER.filter(relation => options?.includeEmpty || byRelation.has(relation))

  return relations.map(relation => ({
    relation,
    label: RELATION_LABEL[relation],
    entries: byRelation.get(relation) ?? []
  }))
}
