'use client'

import type { ReactNode } from 'react'
import { PanelLeftIcon, PanelTopIcon } from 'lucide-react'

import { UserAvatar } from '@/components/shared/lark'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 对齐侧栏；宽高双向插值（避免 scale+overflow 导致小→大被裁切） */
const SIZE_MOTION = 'duration-200 ease-linear'
/** 与 ui/avatar：lg=size-10(40) / sm=size-6(24) 一致 */
const AVATAR_LG_PX = 40
const AVATAR_SM_PX = 24

type ReferencePanelIdentityProps = {
  collapsed: boolean
  sideBySide: boolean
  openId?: string
  name: string
  avatarUrl?: string
  className?: string
}

/**
 * 外框在 24↔40 间过渡，头像铺满外框——放大/缩小同一路径。
 * 侧轨收起：纵向排列并居中，姓名竖排显示（避免横向 gap 把头像挤偏）。
 */
export const ReferencePanelIdentity = ({
  collapsed,
  sideBySide,
  openId,
  name,
  avatarUrl,
  className
}: ReferencePanelIdentityProps) => {
  const sideRail = collapsed && sideBySide
  const avatarPx = collapsed ? AVATAR_SM_PX : AVATAR_LG_PX

  return (
    <div
      className={cn(
        'flex min-w-0',
        sideRail ? 'flex-col items-center gap-3' : 'items-center gap-3',
        className
      )}
    >
      <div
        className={cn(
          'relative mx-auto shrink-0 transition-[width,height]',
          SIZE_MOTION,
          // 让内部 Trigger / Avatar 始终铺满过渡中的外框
          '**:data-[slot=avatar]:size-full! [&_button]:size-full'
        )}
        style={{ width: avatarPx, height: avatarPx }}
      >
        <UserAvatar openId={openId} name={name} avatarUrl={avatarUrl} size='lg' />
      </div>
      <p
        className={cn(
          'font-semibold',
          sideRail
            ? 'text-muted-foreground max-h-40 overflow-hidden text-[10px] leading-none tracking-widest'
            : cn(
                'min-w-0 flex-1 truncate transition-[font-size,line-height]',
                SIZE_MOTION
              )
        )}
        style={
          sideRail
            ? { writingMode: 'vertical-rl' }
            : {
                // 字号阶梯 B：身份 20 / 收起 14
                fontSize: collapsed ? '0.875rem' : '1.25rem',
                lineHeight: collapsed ? '1.25rem' : '1.75rem'
              }
        }
      >
        {name}
      </p>
    </div>
  )
}

/** 与侧栏 SidebarTrigger 同系的面板图标 */
const PanelToggleIcon = ({ sideBySide }: { sideBySide: boolean }) =>
  sideBySide ? <PanelLeftIcon /> : <PanelTopIcon />

type ReferencePanelCollapseButtonProps = {
  sideBySide: boolean
  onCollapse: () => void
}

/** 展开态收起按钮：图标对齐侧栏 Toggle（PanelLeft / PanelTop） */
export const ReferencePanelCollapseButton = ({ sideBySide, onCollapse }: ReferencePanelCollapseButtonProps) => (
  <Button
    type='button'
    size='icon'
    variant='ghost'
    className='shrink-0'
    aria-label='收起参考区'
    onClick={onCollapse}
  >
    <PanelToggleIcon sideBySide={sideBySide} />
    <span className='sr-only'>收起参考区</span>
  </Button>
)

type ReferencePanelMotionRootProps = {
  collapsed: boolean
  sideBySide: boolean
  openId?: string
  name: string
  avatarUrl?: string
  onCollapsedChange: (collapsed: boolean) => void
  children: ReactNode
}

/**
 * 统一页头：Identity 固定为第一个子节点（侧轨用 order 把按钮提到上方），
 * 避免展开时节点重挂导致小→大过渡中断。
 */
export const ReferencePanelMotionRoot = ({
  collapsed,
  sideBySide,
  openId,
  name,
  avatarUrl,
  onCollapsedChange,
  children
}: ReferencePanelMotionRootProps) => (
  <div className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
    <div
      className={cn(
        'flex',
        collapsed && sideBySide && 'h-full w-full flex-col items-center gap-3 py-4',
        collapsed && !sideBySide && 'h-full w-full items-center gap-3 px-4',
        !collapsed && 'shrink-0 items-center gap-3 px-4 py-4'
      )}
    >
      <ReferencePanelIdentity
        collapsed={collapsed}
        sideBySide={sideBySide}
        openId={openId}
        name={name}
        avatarUrl={avatarUrl}
        className={cn(
          // 侧轨收起：居中，视觉顺序在按钮下方（DOM 仍为第一子节点）
          collapsed && sideBySide && 'order-2 self-center',
          !(collapsed && sideBySide) && 'min-w-0 flex-1'
        )}
      />

      {collapsed ? (
        <Button
          type='button'
          size='icon'
          variant='ghost'
          className={cn('shrink-0', sideBySide && 'order-1 self-center')}
          aria-label='展开参考区'
          onClick={() => onCollapsedChange(false)}
        >
          <PanelToggleIcon sideBySide={sideBySide} />
          <span className='sr-only'>展开参考区</span>
        </Button>
      ) : (
        <ReferencePanelCollapseButton sideBySide={sideBySide} onCollapse={() => onCollapsedChange(true)} />
      )}
    </div>

    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', collapsed && 'hidden')}>
      {children}
    </div>
  </div>
)
