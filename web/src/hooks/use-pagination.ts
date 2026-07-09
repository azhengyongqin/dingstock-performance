/**
 * 分页页码计算 Hook（取自模板 Data Table 方案）：
 * 根据当前页/总页数计算需要展示的页码集合，以及左右省略号的显隐。
 */

type UsePaginationProps = {
  currentPage: number // 当前页码（从 1 开始）

  /** 总页数 */
  totalPages: number

  /** 期望展示的页码按钮数量 */
  paginationItemsToDisplay: number
}

type UsePaginationReturn = {
  pages: number[] // 需要渲染的页码列表

  /** 是否展示左侧省略号 */
  showLeftEllipsis: boolean

  /** 是否展示右侧省略号 */
  showRightEllipsis: boolean
}

export function usePagination({
  currentPage,
  totalPages,
  paginationItemsToDisplay
}: UsePaginationProps): UsePaginationReturn {
  function calculatePaginationRange(): number[] {
    if (totalPages <= paginationItemsToDisplay) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }

    const halfDisplay = Math.floor(paginationItemsToDisplay / 2)

    const initialRange = {
      start: currentPage - halfDisplay,
      end: currentPage + halfDisplay
    }

    const adjustedRange = {
      start: Math.max(1, initialRange.start),
      end: Math.min(totalPages, initialRange.end)
    }

    if (adjustedRange.start === 1) {
      adjustedRange.end = Math.min(paginationItemsToDisplay, totalPages)
    }

    if (adjustedRange.end === totalPages) {
      adjustedRange.start = Math.max(1, totalPages - paginationItemsToDisplay + 1)
    }

    return Array.from({ length: adjustedRange.end - adjustedRange.start + 1 }, (_, i) => adjustedRange.start + i)
  }

  const pages = calculatePaginationRange()

  // 根据实际展示的页码判断省略号显隐
  const showLeftEllipsis = pages.length > 0 && pages[0] > 2

  const showRightEllipsis = pages.length > 0 && pages[pages.length - 1] < totalPages - 1

  return {
    pages,
    showLeftEllipsis,
    showRightEllipsis
  }
}
