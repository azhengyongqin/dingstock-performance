import { describe, expect, it } from 'vitest'

import { getFormTemplateActions, normalizeDimensionKind } from './form-template-utils'

describe('getFormTemplateActions', () => {
  it('仅允许 Admin 编辑和发布草稿版本', () => {
    expect(getFormTemplateActions('DRAFT', true)).toEqual({
      canEdit: true,
      canPublish: true,
      canCreateDraft: false,
      canArchive: false
    })

    expect(getFormTemplateActions('DRAFT', false)).toEqual({
      canEdit: false,
      canPublish: false,
      canCreateDraft: false,
      canArchive: false
    })
  })
})

describe('normalizeDimensionKind', () => {
  it('切换到非计分维度时清除权重与核心标记', () => {
    expect(
      normalizeDimensionKind(
        {
          kind: 'REGULAR',
          audience: 'REVIEWER',
          name: '协作沟通',
          weight: '35',
          isCore: true,
          sortOrder: 0,
          items: []
        },
        'TEXT'
      )
    ).toEqual(expect.objectContaining({ kind: 'TEXT', weight: null, isCore: false }))
  })
})
