import { describe, expect, it } from 'vitest'

import type { PerfFormTemplateVersionSummary } from '@/lib/perf-api'

import {
  buildReminderFrequency,
  filterPublishedFormCandidates,
  getConfigTemplateActions,
  issueSectionForPath,
  mergeConfigTemplateIssues,
  replaceFormBindingForPrefix,
  resolveBindingSubforms,
  summarizeReviewerRelationWeights
} from './config-template-utils'

describe('getConfigTemplateActions', () => {
  it('只有 Admin 能维护草稿和已发布版本', () => {
    expect(getConfigTemplateActions('DRAFT', true)).toEqual({
      canEdit: true,
      canValidate: true,
      canPublish: true,
      canCreateDraft: false,
      canArchive: false
    })
    expect(getConfigTemplateActions('PUBLISHED', true)).toEqual({
      canEdit: false,
      canValidate: false,
      canPublish: false,
      canCreateDraft: true,
      canArchive: true
    })
    expect(getConfigTemplateActions('DRAFT', false).canEdit).toBe(false)
  })
})

describe('summarizeReviewerRelationWeights', () => {
  it('使用两位小数精确判断四类关系权重是否合计 100%', () => {
    expect(
      summarizeReviewerRelationWeights({ ORG_OWNER: '30', PROJECT_OWNER: '30', PEER: '25', CROSS_DEPT: '15' })
    ).toEqual({ total: '100.00', difference: '0.00', valid: true })

    expect(
      summarizeReviewerRelationWeights({ ORG_OWNER: '33.33', PROJECT_OWNER: '33.33', PEER: '16.67', CROSS_DEPT: '16.66' })
    ).toEqual({ total: '99.99', difference: '0.01', valid: false })

    expect(
      summarizeReviewerRelationWeights({ ORG_OWNER: '100', PROJECT_OWNER: '0', PEER: '0', CROSS_DEPT: '0' })
    ).toEqual({ total: '100.00', difference: '0.00', valid: false })
  })
})

describe('filterPublishedFormCandidates', () => {
  it('D/M 绑定槽只展示相同前缀的已发布表单版本', () => {
    const candidates = [
      { id: 1, jobLevelPrefix: 'D', status: 'PUBLISHED' },
      { id: 2, jobLevelPrefix: 'M', status: 'PUBLISHED' },
      { id: 3, jobLevelPrefix: 'D', status: 'DRAFT' }
    ] as PerfFormTemplateVersionSummary[]

    expect(filterPublishedFormCandidates(candidates, 'D').map(item => item.id)).toEqual([1])
  })
})

describe('issueSectionForPath', () => {
  it('把发布问题定位到对应编辑区', () => {
    expect(issueSectionForPath('reviewerRelationWeights.PEER')).toBe('relations')
    expect(issueSectionForPath('formTemplateVersionIds[0]')).toBe('bindings')
    expect(issueSectionForPath(undefined)).toBe('basic')
  })
})

describe('replaceFormBindingForPrefix', () => {
  it('当前 D 绑定被归档后，改选新版本会清除同前缀全部旧 ID', () => {
    const candidates = [
      { id: 101, jobLevelPrefix: 'D', status: 'PUBLISHED' },
      { id: 102, jobLevelPrefix: 'M', status: 'PUBLISHED' }
    ] as PerfFormTemplateVersionSummary[]

    expect(
      replaceFormBindingForPrefix({
        currentIds: [90, 91, 102],
        bindings: [
          { formTemplateVersionId: 90, jobLevelPrefix: 'D', status: 'ARCHIVED' },
          { formTemplateVersionId: 91, jobLevelPrefix: 'D', status: 'ARCHIVED' },
          { formTemplateVersionId: 102, jobLevelPrefix: 'M', status: 'PUBLISHED' }
        ],
        candidates,
        prefix: 'D',
        nextId: 101
      })
    ).toEqual([102, 101])
  })
})

describe('resolveBindingSubforms', () => {
  it('优先使用保留数据库维度 ID 的展开表单版本', () => {
    const binding = {
      subforms: [{ type: 'PEER', dimensions: [{ name: '归一化维度', items: [] }] }],
      formTemplateVersion: {
        subforms: [{ type: 'PEER', dimensions: [{ id: 501, name: '数据库维度', items: [] }] }]
      }
    }

    expect(resolveBindingSubforms(binding as never)?.[0].dimensions[0].id).toBe(501)
  })
})

describe('buildReminderFrequency', () => {
  it('切回一次或每天提醒时会移除 intervalDays', () => {
    expect(buildReminderFrequency('ONCE_AT_DEADLINE', 3)).toEqual({ type: 'ONCE_AT_DEADLINE' })
    expect(buildReminderFrequency('DAILY_AFTER_DEADLINE', 3)).toEqual({ type: 'DAILY_AFTER_DEADLINE' })
    expect(buildReminderFrequency('EVERY_N_DAYS_AFTER_DEADLINE', 3)).toEqual({
      type: 'EVERY_N_DAYS_AFTER_DEADLINE',
      intervalDays: 3
    })
  })
})

describe('mergeConfigTemplateIssues', () => {
  it('空 publicationIssues 不会遮蔽归档不可用原因，并按内容去重', () => {
    expect(
      mergeConfigTemplateIssues({
        publicationIssues: [],
        unavailableReasons: [
          { code: 'CONFIG_VERSION_ARCHIVED', path: 'status', message: '配置模板版本已归档' },
          { code: 'CONFIG_VERSION_ARCHIVED', path: 'status', message: '配置模板版本已归档' }
        ]
      })
    ).toEqual([{ code: 'CONFIG_VERSION_ARCHIVED', path: 'status', message: '配置模板版本已归档' }])
  })
})
