import { describe, expect, it } from 'vitest'

import { migrateFieldConfig } from './form-template-constants'

describe('migrateFieldConfig', () => {
  it('多行文本切换为 Markdown 时保留全部兼容配置', () => {
    expect(
      migrateFieldConfig('MARKDOWN', {
        minLength: 10,
        maxLength: 500,
        defaultValue: '## 模板'
      })
    ).toEqual({
      config: { minLength: 10, maxLength: 500, defaultValue: '## 模板' },
      removedIncompatible: false
    })
  })

  it('多选切换为单选时保留选项并标记已清理选择数量限制', () => {
    expect(
      migrateFieldConfig('SINGLE_SELECT', {
        options: [{ value: 'A', label: '选项 A' }],
        minSelections: 1,
        maxSelections: 1
      })
    ).toEqual({
      config: { options: [{ value: 'A', label: '选项 A' }] },
      removedIncompatible: true
    })
  })
})
