import { describe, expect, it } from 'vitest'

import { groupReviewersByRelation } from './group-reviewers'

const reviewer = (reviewerOpenId: string, relation: string) => ({ reviewerOpenId, relation })

describe('groupReviewersByRelation（按关系单视角分组）', () => {
  it('只按四类 360°计算关系排序分组，不提供直属 Leader 分组', () => {
    const groups = groupReviewersByRelation([
      reviewer('ou_peer', 'PEER'),
      reviewer('ou_cross', 'CROSS_DEPT'),
      reviewer('ou_leader', 'LEADER'),
      reviewer('ou_po', 'PROJECT_OWNER'),
      reviewer('ou_org', 'ORG_OWNER')
    ])

    expect(groups.map(group => group.relation)).toEqual(['ORG_OWNER', 'PROJECT_OWNER', 'PEER', 'CROSS_DEPT'])
    expect(groups.map(group => group.label)).toEqual(['组织负责人', '项目负责人', '同部门同事', '跨部门协作方'])
  })

  it('空分组不出现在结果中，组内保持加入顺序', () => {
    const groups = groupReviewersByRelation([reviewer('ou_b', 'PEER'), reviewer('ou_a', 'PEER')])

    expect(groups).toHaveLength(1)
    expect(groups[0].relation).toBe('PEER')
    expect(groups[0].entries.map(entry => entry.reviewerOpenId)).toEqual(['ou_b', 'ou_a'])
  })

  it('includeEmpty 时四类计算关系全部出现（空组 entries 为空数组）', () => {
    const groups = groupReviewersByRelation([reviewer('ou_peer', 'PEER')], { includeEmpty: true })

    expect(groups.map(group => group.relation)).toEqual(['ORG_OWNER', 'PROJECT_OWNER', 'PEER', 'CROSS_DEPT'])
    expect(groups.find(group => group.relation === 'PEER')?.entries).toHaveLength(1)
  })

  it('直属 Leader 与未知关系都不会进入可编辑分组', () => {
    const groups = groupReviewersByRelation([reviewer('ou_x', 'UNKNOWN_REL'), reviewer('ou_leader', 'LEADER')])

    expect(groups).toEqual([])
  })
})
