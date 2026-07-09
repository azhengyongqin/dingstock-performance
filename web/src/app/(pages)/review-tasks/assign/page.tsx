// React Imports
import { Suspense } from 'react'

// View Imports
import ReviewerAssign from '@/views/review-tasks/assign'

export const metadata = {
  title: '评审人指派 - 盯潮绩效'
}

// 薄壳页面：真实 UI 在 src/views/review-tasks/assign
// 视图内使用 useSearchParams 读取 participant_id，需包 Suspense
const ReviewerAssignPage = () => {
  return (
    <Suspense>
      <ReviewerAssign />
    </Suspense>
  )
}

export default ReviewerAssignPage
