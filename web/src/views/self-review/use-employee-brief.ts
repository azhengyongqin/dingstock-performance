'use client'

// 按 open_id 拉取通讯录简要信息，供自评页左侧个人信息区展示。
import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { avatarUrlOf, type LarkUserBrief } from '@/lib/perf-api'

export type EmployeeBrief = {
  openId: string
  name: string
  jobTitle?: string | null
  avatarUrl?: string
}

export const useEmployeeBrief = (openId: string): { brief: EmployeeBrief | null; loading: boolean } => {
  const [brief, setBrief] = useState<EmployeeBrief | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    void apiFetch<LarkUserBrief>(`/contact/users/${encodeURIComponent(openId)}`)
      .then(user => {
        if (cancelled) return
        setBrief({
          openId,
          name: user.name ?? openId,
          jobTitle: user.job_title,
          avatarUrl: avatarUrlOf(user)
        })
      })
      .catch(() => {
        if (cancelled) return
        setBrief({ openId, name: openId })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [openId])

  return { brief, loading }
}
