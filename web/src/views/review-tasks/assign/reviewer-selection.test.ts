import { describe, expect, it } from 'vitest'

import { reviewerFromMemberOption } from './reviewer-selection'

describe('reviewerFromMemberOption（飞书人员选择结果适配）', () => {
  it('从飞书 Selector 的 entity 中读取姓名和头像，避免首次添加仅显示 open_id', () => {
    expect(
      reviewerFromMemberOption({
        id: 'ou_216b190da89a53a1d84a0e25886f8c41',
        entity: {
          name: '王小明',
          avatarUrl: 'https://example.com/avatar.png'
        }
      })
    ).toEqual({
      openId: 'ou_216b190da89a53a1d84a0e25886f8c41',
      name: '王小明',
      avatarUrl: 'https://example.com/avatar.png'
    })
  })

})
