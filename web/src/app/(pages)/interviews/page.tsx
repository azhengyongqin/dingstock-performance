import { Suspense } from 'react'

// View Imports
import Interviews from '@/views/interviews'

export const metadata = {
  title: '绩效面谈 - 盯潮绩效'
}

// 薄壳页面：真实 UI 在 src/views/interviews；深链 query 需 Suspense
const InterviewsPage = () => {
  return (
    <Suspense>
      <Interviews />
    </Suspense>
  )
}

export default InterviewsPage
