// View Imports
import CycleEdit from '@/views/cycles/edit'

export const metadata = {
  title: '编辑周期 - 盯潮绩效'
}

// 薄壳页面：真实 UI 在 src/views/cycles/edit
// Next.js 16 中 params 为 Promise，需要 await
const CycleEditPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  return <CycleEdit cycleId={id} />
}

export default CycleEditPage
