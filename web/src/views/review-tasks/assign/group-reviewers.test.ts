import { describe, expect, it } from 'vitest'

import { groupReviewersByRelation } from './group-reviewers'

const reviewer = (reviewerOpenId: string, relation: string) => ({ reviewerOpenId, relation })

describe('groupReviewersByRelation（按关系单视角分组）', () => {
  it('按视角权重排序分组：直属上级 → 组织负责人 → 项目负责人 → 同部门同事 → 跨部门协作方', () => {
    const groups = groupReviewersByRelation([
      reviewer('ou_peer', 'PEER'),
      reviewer('ou_cross', 'CROSS_DEPT'),
      reviewer('ou_leader', 'LEADER'),
      reviewer('ou_po', 'PROJECT_OWNER'),
      reviewer('ou_org', 'ORG_OWNER')
    ])

    expect(groups.map(group => group.relation)).toEqual([
      'LEADER',
      'ORG_OWNER',
      'PROJECT_OWNER',
      'PEER',
      'CROSS_DEPT'
    ])
    expect(groups.map(group => group.label)).toEqual([
      '直属上级',
      '组织负责人',
      '项目负责人',
      '同部门同事',
      '跨部门协作方'
    ])
  })

  it('空分组不出现在结果中，组内保持加入顺序', () => {
    const groups = groupReviewersByRelation([
      reviewer('ou_b', 'PEER'),
      reviewer('ou_a', 'PEER')
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].relation).toBe('PEER')
    expect(groups[0].entries.map(entry => entry.reviewerOpenId)).toEqual(['ou_b', 'ou_a'])
  })

  it('includeEmpty 时五类分组全部出现（空组 entries 为空数组），未知关系仍只在有成员时出现', () => {
    const groups = groupReviewersByRelation([reviewer('ou_peer', 'PEER')], { includeEmpty: true })

    expect(groups.map(group => group.relation)).toEqual([
      'LEADER',
      'ORG_OWNER',
      'PROJECT_OWNER',
      'PEER',
      'CROSS_DEPT'
    ])
    expect(groups.find(group => group.relation === 'PEER')?.entries).toHaveLength(1)
    expect(groups.find(group => group.relation === 'LEADER')?.entries).toEqual([])
  })

  it('未知关系值兜底排在已知分组之后，标签回退为原值', () => {
    const groups = groupReviewersByRelation([
      reviewer('ou_x', 'UNKNOWN_REL'),
      reviewer('ou_leader', 'LEADER')
    ])

    expect(groups.map(group => group.relation)).toEqual(['LEADER', 'UNKNOWN_REL'])
    expect(groups[1].label).toBe('UNKNOWN_REL')
  })
})
