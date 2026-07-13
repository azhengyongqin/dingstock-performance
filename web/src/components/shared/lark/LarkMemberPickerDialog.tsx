'use client'

// React Imports
import { useState } from 'react'

// Third-party Imports
import { Loader2Icon, UserRoundXIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

// Component Imports
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import LarkMemberSelector, { type LarkSelectorOption } from './LarkMemberSelector'
import UserAvatar from './UserAvatar'

/** 弹窗内一名成员的展示信息（通用，业务方自行映射） */
export type LarkPickerMember = {
  openId: string
  name?: string

  /** 二级文案（部门/岗位等） */
  description?: string
  avatarUrl?: string

  /** 名字旁的徽标文案（如「管理员」） */
  badge?: string

  /** 是否允许移除，默认允许；管理员等锁定成员传 false */
  removable?: boolean
}

/** 将飞书 Selector 的选中结果适配为弹窗成员：姓名、头像优先取 entity 内字段 */
export const memberFromSelectorOption = (option: LarkSelectorOption): LarkPickerMember | null => {
  if (!option.id) return null

  return {
    openId: option.id,
    name: option.entity?.name ?? option.name ?? option.label,
    avatarUrl: option.entity?.avatarUrl ?? option.avatarUrl
  }
}

export type LarkMemberPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  searchPlaceholder?: string

  /** 底部「已选中成员」列表 */
  members: LarkPickerMember[]

  /** 底部列表上方的说明文案 */
  membersLabel?: string

  /** 确认本次新增（支持 async，等待期间按钮转圈）；确认成功后清空待添加区 */
  onConfirm: (added: LarkPickerMember[]) => void | Promise<void>

  /** 移除一名已选中成员；不传则列表纯展示、不出现移除按钮 */
  onRemoveMember?: (member: LarkPickerMember) => void

  /** 移除按钮文案（如「移除权限」），默认「移除」 */
  removeLabel?: string
}

/**
 * 通用人员选择弹窗（参考飞书「协作者管理」交互）：
 * 顶部搜索（LarkMemberSelector）→ 本次新增的待确认区（取消/确认）→ 已选中成员列表。
 * 组件只管选择交互，成员的持久化由业务方在 onConfirm / onRemoveMember 中完成。
 */
const LarkMemberPickerDialog = ({
  open,
  onOpenChange,
  title = '人员选择',
  searchPlaceholder = '添加人员，可搜索员工',
  members,
  membersLabel = '已选中的人员',
  onConfirm,
  onRemoveMember,
  removeLabel = '移除'
}: LarkMemberPickerDialogProps) => {
  /** 本次搜索新增、尚未确认的成员 */
  const [pending, setPending] = useState<LarkPickerMember[]>([])
  const [confirming, setConfirming] = useState(false)

  const handleSelect = (option: LarkSelectorOption) => {
    const member = memberFromSelectorOption(option)

    if (!member) return

    if (members.some(item => item.openId === member.openId)) {
      toast.info('该成员已在列表中')

      return
    }

    setPending(prev => (prev.some(item => item.openId === member.openId) ? prev : [...prev, member]))
  }

  const handleConfirm = async () => {
    if (pending.length === 0) return

    setConfirming(true)

    try {
      await onConfirm(pending)
      setPending([])
    } finally {
      setConfirming(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) setPending([])
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* 固定高度：待确认区出现/成员增减都不改变弹窗尺寸，列表在内部滚动 */}
      <DialogContent className='flex h-[min(85vh,40rem)] flex-col sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 flex-col gap-4'>
          <LarkMemberSelector className='w-full' placeholder={searchPlaceholder} onSelect={handleSelect} />

          {/* 本次新增的待确认区：有内容时出现，取消/确认后收起 */}
          {pending.length > 0 && (
            <div className='flex flex-col gap-3'>
              <div className='flex min-h-24 flex-wrap content-start gap-2 rounded-lg border p-3'>
                {pending.map(member => (
                  <div key={member.openId} className='bg-muted flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2'>
                    <UserAvatar openId={member.openId} name={member.name} avatarUrl={member.avatarUrl} size='sm' />
                    <span className='text-sm'>{member.name ?? member.openId}</span>
                    <button
                      type='button'
                      aria-label={`移除 ${member.name ?? member.openId}`}
                      className='text-muted-foreground hover:text-destructive'
                      onClick={() => setPending(prev => prev.filter(item => item.openId !== member.openId))}
                    >
                      <XIcon className='size-3.5' />
                    </button>
                  </div>
                ))}
              </div>
              <div className='flex justify-end gap-2'>
                <Button variant='outline' disabled={confirming} onClick={() => setPending([])}>
                  取消
                </Button>
                <Button disabled={confirming} onClick={() => void handleConfirm()}>
                  {confirming && <Loader2Icon className='size-4 animate-spin' />}
                  确认
                </Button>
              </div>
            </div>
          )}

          {/* 已选中成员列表：占据剩余高度，内部滚动 */}
          <div className='flex min-h-0 flex-1 flex-col gap-1'>
            <span className='text-sm'>{membersLabel}</span>
            <div className='min-h-0 flex-1 overflow-y-auto'>
              {members.length === 0 ? (
                <div className='text-muted-foreground py-8 text-center text-sm'>暂无成员</div>
              ) : (
                members.map(member => (
                  <div key={member.openId} className='flex items-center justify-between py-2'>
                    <div className='flex items-center gap-3'>
                      <UserAvatar openId={member.openId} name={member.name} avatarUrl={member.avatarUrl} />
                      <div className='flex flex-col'>
                        <div className='flex items-center gap-1.5'>
                          <span className='text-sm font-medium'>{member.name ?? member.openId}</span>
                          {member.badge && <Badge variant='secondary'>{member.badge}</Badge>}
                        </div>
                        {member.description && (
                          <span className='text-muted-foreground text-xs'>{member.description}</span>
                        )}
                      </div>
                    </div>
                    {onRemoveMember && member.removable !== false && (
                      <Button
                        variant='ghost'
                        size='sm'
                        className='text-muted-foreground'
                        onClick={() => onRemoveMember(member)}
                      >
                        <UserRoundXIcon className='size-4' />
                        {removeLabel}
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default LarkMemberPickerDialog
