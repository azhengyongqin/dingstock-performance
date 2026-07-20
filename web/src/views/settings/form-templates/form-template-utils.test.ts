import { describe, expect, it } from 'vitest'

import {
  collectFormIssueMarkers,
  getFormTemplateActions,
  issueDestinationForPath,
  normalizeDimensionType
} from './form-template-utils'

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

describe('normalizeDimensionType', () => {
  it('切换到非计分维度时清除计分方式、占比、核心和条件必填', () => {
    expect(
      normalizeDimensionType(
        {
          type: 'SCORING',
          scoringMethod: 'RATING',
          audience: 'REVIEWER',
          name: '协作沟通',
          weight: '35',
          isCore: true,
          sortOrder: 0,
          fields: [
            {
              type: 'LONG_TEXT',
              title: '说明',
              requiredRule: 'CONDITIONAL',
              requiredLevels: ['C'],
              sortOrder: 0
            }
          ]
        },
        'NON_SCORING'
      )
    ).toEqual(
      expect.objectContaining({
        type: 'NON_SCORING',
        scoringMethod: null,
        weight: null,
        isCore: false,
        fields: [expect.objectContaining({ requiredRule: 'OPTIONAL', requiredLevels: [] })]
      })
    )
  })
})

describe('issueDestinationForPath', () => {
  it('按子表单类型定位导航', () => {
    expect(issueDestinationForPath('subforms.SELF.dimensions[1].fields')).toBe('SELF')
    expect(issueDestinationForPath(undefined)).toBe('basic')
  })
})

describe('collectFormIssueMarkers', () => {
  it('聚合导航与维度/表单字段落点', () => {
    const markers = collectFormIssueMarkers([
      {
        code: 'NON_SCORING_DIMENSION_CONFIG_INVALID',
        path: 'subforms.SELF.dimensions[1].scoringMethod',
        message: '非计分维度不能设置计分方式'
      },
      {
        code: 'FIELD_CONFIG_INVALID',
        path: 'subforms.PEER.dimensions[0].fields[2].config',
        message: '单选的组件配置不合法'
      }
    ])

    expect(markers.get('SELF')?.dimensions.get(1)?.properties.has('scoringMethod')).toBe(true)
    expect(markers.get('PEER')?.dimensions.get(0)?.fields.get(2)?.has('config')).toBe(true)
  })
})
