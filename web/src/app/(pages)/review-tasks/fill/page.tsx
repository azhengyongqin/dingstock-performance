// React Imports
import { Suspense } from 'react'

// View Imports
import ReviewFill from '@/views/review-tasks/fill'

export const metadata = {
  title: '评估填写 - 盯潮绩效'
}

// 薄壳页面：真实 UI 在 src/views/review-tasks/fill
// 视图内使用 useSearchParams 读取 participant_id/type，需包 Suspense
const ReviewFillPage = () => {
  return (
    <Suspense>
      <ReviewFill />
    </Suspense>
  )
}

export default ReviewFillPage
