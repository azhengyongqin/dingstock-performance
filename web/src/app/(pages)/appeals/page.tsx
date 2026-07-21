import { Suspense } from 'react'

// View Imports
import Appeals from '@/views/appeals'

export const metadata = {
  title: '申诉处理 - 盯潮绩效'
}

// 薄壳页面：真实 UI 在 src/views/appeals；深链 ?appealId= 需 Suspense
const AppealsPage = () => {
  return (
    <Suspense>
      <Appeals />
    </Suspense>
  )
}

export default AppealsPage
