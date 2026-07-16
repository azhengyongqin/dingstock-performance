// 左侧参考区的复盘 / 日志占位数据；OKR 已接入飞书真实同步数据。

export type ReferenceReviewEntry = {
  id: string
  period: string
  title: string
  summary: string
  updatedAt: string
}

export type ReferenceLogEntry = {
  id: string
  weekLabel: string
  title: string
  snippet: string
  date: string
}

export const REFERENCE_REVIEWS: ReferenceReviewEntry[] = [
  {
    id: 'r1',
    period: '2026-05',
    title: '5 月复盘',
    summary: '创新方向调研完成第一轮访谈；客户成功看板进入内测。',
    updatedAt: '2026-05-31'
  },
  {
    id: 'r2',
    period: '2026-04',
    title: '4 月复盘',
    summary: '明确半年度 OKR 权重分配，对齐合作伙伴培训节奏。',
    updatedAt: '2026-04-30'
  }
]

export const REFERENCE_LOGS: ReferenceLogEntry[] = [
  {
    id: 'l1',
    weekLabel: '第 24 周',
    title: '合作伙伴培训筹备',
    snippet: '确认培训大纲与演示账号；同步李健准备案例材料。',
    date: '2026-06-13'
  },
  {
    id: 'l2',
    weekLabel: '第 23 周',
    title: '竞品矩阵更新',
    snippet: '补充 2 家竞品能力对比，标记可跟进的差异化点。',
    date: '2026-06-06'
  },
  {
    id: 'l3',
    weekLabel: '第 22 周',
    title: '客户健康度指标对齐',
    snippet: '与数据侧对齐核心指标口径，确认预警阈值初稿。',
    date: '2026-05-30'
  }
]
