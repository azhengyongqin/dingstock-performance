'use client'

import { useEffect, useRef, type ReactNode } from 'react'

import { TabsList } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type ScrollableTabsListProps = {
  children: ReactNode
  className?: string
  listClassName?: string
}

/** 隐藏滚动条，仅在溢出时由程序把选中 Tab 滚入可视区 */
const SCROLLBAR_HIDDEN =
  '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'

function scrollActiveTabIntoView(scroller: HTMLElement, behavior: ScrollBehavior) {
  const active =
    scroller.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-active]') ??
    scroller.querySelector<HTMLElement>('[data-slot="tabs-trigger"][aria-selected="true"]')

  if (!active) return

  const scrollerRect = scroller.getBoundingClientRect()
  const tabRect = active.getBoundingClientRect()
  const edgePad = 8

  const fullyVisible =
    tabRect.left >= scrollerRect.left + edgePad && tabRect.right <= scrollerRect.right - edgePad

  if (fullyVisible) return

  // 尽量让选中项居中，避免只露出一半
  const nextLeft =
    scroller.scrollLeft + (tabRect.left - scrollerRect.left) - (scroller.clientWidth - tabRect.width) / 2

  const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth)

  scroller.scrollTo({
    left: Math.max(0, Math.min(nextLeft, maxLeft)),
    behavior
  })
}

/**
 * 评估参考区等窄栏场景的横向 Tab 列表：
 * 无滚动条；选中或容器变窄时自动滚到合适位置。
 */
const ScrollableTabsList = ({ children, className, listClassName }: ScrollableTabsListProps) => {
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scroller = scrollerRef.current

    if (!scroller) return

    scrollActiveTabIntoView(scroller, 'auto')

    const mutationObserver = new MutationObserver(() => {
      scrollActiveTabIntoView(scroller, 'smooth')
    })

    mutationObserver.observe(scroller, {
      attributes: true,
      attributeFilter: ['data-active', 'aria-selected'],
      subtree: true
    })

    // 左右分栏拖拽变窄时，保持当前选中 Tab 仍可见
    const resizeObserver = new ResizeObserver(() => {
      scrollActiveTabIntoView(scroller, 'auto')
    })

    resizeObserver.observe(scroller)

    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <div
      ref={scrollerRef}
      className={cn('min-w-0 shrink-0 overflow-x-auto border-y px-3 pt-2', SCROLLBAR_HIDDEN, className)}
    >
      <TabsList variant='line' className={cn('h-10 w-max flex-nowrap', listClassName)}>
        {children}
      </TabsList>
    </div>
  )
}

export default ScrollableTabsList
