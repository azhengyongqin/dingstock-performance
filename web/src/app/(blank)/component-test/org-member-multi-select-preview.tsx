'use client'

/**
 * LarkOrgMemberMultiSelectDialog 组件实验台：飞书双栏钻取（已定方案 A）。
 */

import { useState } from 'react'

import { toast } from 'sonner'

import {
  LarkOrgMemberMultiSelectDialog,
  type OrgMultiSelectItem,
  type OrgMultiSelectUser
} from '@/components/shared/lark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const OrgMemberMultiSelectPreview = () => {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<OrgMultiSelectItem[]>([])
  const [expandedUsers, setExpandedUsers] = useState<OrgMultiSelectUser[]>([])

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>组织人员多选弹窗</CardTitle>
          <CardDescription>
            支持拼音/首字母模糊搜索与主题色高亮；确认时除原始已选外，还会回传
            `expandOrgMultiSelectToUsers` 展开后的全量用户列表。
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          <Button type='button' onClick={() => setOpen(true)}>
            打开组织多选弹窗
          </Button>
          <LarkOrgMemberMultiSelectDialog
            open={open}
            onOpenChange={setOpen}
            initialSelected={selected}
            onConfirm={(items, users) => {
              setSelected(items)
              setExpandedUsers(users)
              toast.success(`已确认 ${items.length} 项，展开 ${users.length} 人`)
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>确认结果</CardTitle>
          <CardDescription>上：原始已选 JSON；下：展开后的全量用户列表</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          <div>
            <p className='text-muted-foreground mb-1 text-xs'>selected（人/部门混选）</p>
            <pre className='bg-muted max-h-40 overflow-auto rounded-md p-3 text-[11px] leading-relaxed'>
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
          <div>
            <p className='text-muted-foreground mb-1 text-xs'>
              expandedUsers（{expandedUsers.length} 人，含部门子树成员）
            </p>
            <pre className='bg-muted max-h-48 overflow-auto rounded-md p-3 text-[11px] leading-relaxed'>
              {JSON.stringify(expandedUsers, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default OrgMemberMultiSelectPreview
