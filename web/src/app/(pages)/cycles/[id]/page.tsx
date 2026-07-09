// View Imports
import CycleDetail from '@/views/cycles/detail'

export const metadata = {
  title: '周期详情 - 盯潮绩效'
}

// 薄壳页面：真实 UI 在 src/views/cycles/detail
// Next.js 16 中 params 为 Promise，需要 await
const CycleDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  return <CycleDetail cycleId={id} />
}

export default CycleDetailPage
