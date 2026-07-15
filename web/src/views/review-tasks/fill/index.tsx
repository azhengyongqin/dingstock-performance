'use client'

import { useSearchParams } from 'next/navigation'

import ManagerReviewFill from './manager-review-fill'
import PeerReviewFill from './peer-review-fill'

/**
 * 评估填写路由分发：两类任务都已迁移到统一动态表单接口。
 * 身份和对象权限由后端依据 assignment / 当前 Leader 快照判断，URL 只携带对象 id。
 */
const ReviewFill = () => {
  const searchParams = useSearchParams()
  const isManager = searchParams.get('type') === 'MANAGER_REVIEW'

  if (isManager) {
    return <ManagerReviewFill participantId={Number(searchParams.get('participant_id'))} />
  }

  return <PeerReviewFill assignmentId={Number(searchParams.get('assignment_id'))} />
}

export default ReviewFill
