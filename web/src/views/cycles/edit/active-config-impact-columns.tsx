import type { ColumnDef } from '@tanstack/react-table'

import type { ActivePerfCycleConfigImpact } from '@/lib/perf-api'

type StageChange = ActivePerfCycleConfigImpact['stageChanges'][number]
type CalculationDimensionChange = ActivePerfCycleConfigImpact['calculationDimensionChanges'][number]

/** 影响预览列独立维护，Dialog 只负责编排确认流程。 */
export const activeConfigImpactColumns: ColumnDef<StageChange>[] = [
  { accessorKey: 'employeeOpenId', header: '参与人' },
  { accessorKey: 'stage', header: '阶段' },
  {
    id: 'before',
    header: '变更前',
    cell: ({ row }) => {
      const before = row.original.before

      return before ? `${before.compositeScore ?? '-'} / ${before.stageLevel ?? '-'}` : '无结果'
    }
  },
  {
    id: 'after',
    header: '变更后',
    cell: ({ row }) => `${row.original.after.compositeScore ?? '-'} / ${row.original.after.stageLevel ?? '-'}`
  },
  {
    id: 'details',
    header: '维度 / 约束前后差异',
    cell: ({ row }) => {
      const { before, after } = row.original

      const beforeDimensions =
        before?.dimensions.map(item => `${item.name} ${item.score}/${item.level}`).join('；') || '无维度'

      const afterDimensions =
        after.dimensions.map(item => `${item.name} ${item.score}/${item.level}`).join('；') || '无维度'

      const beforeConstraints = JSON.stringify(before?.matchedConstraints ?? [])
      const afterConstraints = JSON.stringify(after.matchedConstraints)

      return `${beforeDimensions}（约束 ${beforeConstraints}） → ${afterDimensions}（约束 ${afterConstraints}）`
    }
  }
]

export const activeConfigCalculationDimensionColumns: ColumnDef<CalculationDimensionChange>[] = [
  { accessorKey: 'employeeOpenId', header: '参与人' },
  { accessorKey: 'stage', header: '阶段' },
  { accessorKey: 'status', header: '提交状态' },
  { accessorKey: 'dimensionKey', header: '评估维度' },
  {
    id: 'mappingChange',
    header: '计算分前后差异',
    cell: ({ row }) => `${row.original.before ?? '-'} → ${row.original.after}`
  }
]
