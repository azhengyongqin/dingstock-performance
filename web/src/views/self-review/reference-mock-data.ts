// 左侧参考区（OKR / 复盘 / 日志）占位数据；接飞书 OKR / 复盘 / 日志接口后替换。

export type ReferenceOkrKr = {
  id: string
  label: string
  content: string
  weight: number
  mentions?: string[]
}

export type ReferenceOkrObjective = {
  id: string
  label: string
  title: string
  progress: number
  totalWeight: number
  keyResults: ReferenceOkrKr[]
}

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

export const REFERENCE_OKR: ReferenceOkrObjective[] = [
  {
    id: 'o1',
    label: 'O1',
    title: '创新方向调研',
    progress: 72,
    totalWeight: 100,
    keyResults: [
      {
        id: 'kr1',
        label: 'KR1',
        content: '截止 12月中旬与合作伙伴进行产品培训',
        weight: 60,
        mentions: ['李健', '张锐']
      },
      {
        id: 'kr2',
        label: 'KR2',
        content: '完成竞品能力矩阵与差异化机会清单',
        weight: 20
      },
      {
        id: 'kr3',
        label: 'KR3',
        content: '输出下一季度创新试点方案并评审通过',
        weight: 20
      }
    ]
  },
  {
    id: 'o2',
    label: 'O2',
    title: '客户成功体系搭建',
    progress: 45,
    totalWeight: 100,
    keyResults: [
      {
        id: 'kr4',
        label: 'KR1',
        content: '完成重点客户健康度看板与预警规则',
        weight: 50,
        mentions: ['王芳']
      },
      {
        id: 'kr5',
        label: 'KR2',
        content: '沉淀 3 份可复用的客户成功 Playbook',
        weight: 50
      }
    ]
  }
]

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
