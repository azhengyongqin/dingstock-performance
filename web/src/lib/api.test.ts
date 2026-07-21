import { describe, expect, it } from 'vitest'

import { getAuthLoginPath, isAuthPagePath } from './api'

describe('认证页面路径', () => {
  it('识别根路径部署的认证页面', () => {
    expect(isAuthPagePath('/auth/login', '')).toBe(true)
    expect(getAuthLoginPath('')).toBe('/auth/login')
  })

  it('识别 performance basePath 下的认证页面和登录地址', () => {
    expect(isAuthPagePath('/performance/auth/login', '/performance')).toBe(true)
    expect(isAuthPagePath('/performance/workbench', '/performance')).toBe(false)
    expect(getAuthLoginPath('/performance')).toBe('/performance/auth/login')
  })
})
