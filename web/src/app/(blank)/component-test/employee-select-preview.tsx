'use client'

/**
 * EmployeeSelect 实验台：方案 C（可搜索 Select）+ 触发器仅头像姓名。
 */

import { useState } from 'react'

import EmployeeSelect, { type EmployeeSelectOption } from '@/components/shared/EmployeeSelect'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

const SAMPLE_OPTIONS: EmployeeSelectOption[] = [
  {
    id: '1',
    name: '张三',
    openId: 'ou_zhangsan',
    jobTitle: '产品经理',
    description: '产品部'
  },
  {
    id: '2',
    name: '李四',
    openId: 'ou_lisi',
    jobTitle: '前端工程师',
    description: '研发部'
  },
  {
    id: '3',
    name: '王五',
    openId: 'ou_wangwu',
    jobTitle: 'HRBP',
    description: '人力部'
  },
  {
    id: '4',
    name: '欧阳娜娜',
    openId: 'ou_ouyang',
    jobTitle: '设计师',
    description: '设计部'
  },
  {
    id: '5',
    name: 'Zheng Lei',
    openId: 'ou_zheng',
    jobTitle: 'Engineering Manager',
    description: '研发部'
  }
]

const EmployeeSelectPreview = () => {
  const [value, setValue] = useState<string | null>(null)
  const [lockedValue] = useState('2')

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>可搜索 Select</CardTitle>
          <CardDescription>
            下拉内 SearchInput（拼音）；选项 = 标准头像 + 姓名 + 职位；触发器仅头像 + 姓名。
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-2'>
          <Label>员工</Label>
          <EmployeeSelect
            options={SAMPLE_OPTIONS}
            value={value}
            onValueChange={setValue}
            placeholder='选择要预约的员工'
            emptyText='暂无可选员工'
          />
          <p className='text-muted-foreground text-xs'>当前值：{value ?? '（未选）'}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>锁定态</CardTitle>
          <CardDescription>深链预填等场景：仅展示头像 + 姓名，不可更换。</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-2'>
          <Label>员工</Label>
          <EmployeeSelect
            options={SAMPLE_OPTIONS}
            value={lockedValue}
            onValueChange={() => undefined}
            locked
            lockedHint='结果已推送及之后可预约'
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default EmployeeSelectPreview
