// Next Imports
import Link from 'next/link'

// Third-party Imports
import { ArrowRightIcon, BellIcon, LinkIcon, SlidersHorizontalIcon } from 'lucide-react'

// Component Imports
import PageHeader from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import RoleGrantManager from './role-grants'

// ===== 配置分区（静态骨架） =====

const SETTING_SECTIONS = [
  {
    icon: LinkIcon,
    title: '飞书集成',
    description: '应用凭证（App ID / Secret）、组织架构同步、消息机器人配置',
    items: ['应用凭证状态：已配置', '组织架构同步：每日 02:00 自动同步', '消息机器人：已启用'],
    href: '/settings/organization',
    linkLabel: '前往组织架构'
  },
  {
    icon: SlidersHorizontalIcon,
    title: '评估参数',
    description: '评估规则与评估维度的默认配置以「配置模板」维护，创建周期时一键复用',
    items: ['默认模板：标准半年度评估模板', '默认评级：S[90,100] / A[80,90) / B[60,80) / C[0,60)', '评语必填评级：S / C'],
    href: '/settings/templates',
    linkLabel: '前往模板管理'
  },
  {
    icon: BellIcon,
    title: '通知设置',
    description: '飞书提醒模板、发送时机与逾期升级策略',
    items: ['阶段开启提醒：开启', '截止前提醒：截止前 3 天 / 1 天', '逾期升级：抄送直属上级'],
    href: '/audit-logs',
    linkLabel: '查看通知日志'
  }
]

/**
 * 系统配置：角色授权管理（已接后端）+ 飞书集成 / 评估参数 / 通知设置 三个配置分区卡片（静态展示）。
 */
const SystemSettings = () => {
  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='系统配置' description='角色授权与绩效系统全局配置' />

      {/* 角色授权管理：ADMIN 可授予/撤销 HR、超级管理员 */}
      <RoleGrantManager />

      <div className='grid gap-6 lg:grid-cols-3'>
        {SETTING_SECTIONS.map(section => (
          <Card key={section.title} className='flex flex-col'>
            <CardHeader>
              <div className='flex items-center gap-3'>
                <div className='bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg'>
                  <section.icon className='size-5' />
                </div>
                <CardTitle>{section.title}</CardTitle>
              </div>
              <CardDescription className='mt-2'>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-1 flex-col justify-between gap-4'>
              <ul className='flex flex-col gap-2'>
                {section.items.map(item => (
                  <li key={item} className='flex items-center gap-2 text-sm'>
                    <Badge variant='outline' className='shrink-0'>
                      默认
                    </Badge>
                    <span className='text-muted-foreground'>{item}</span>
                  </li>
                ))}
              </ul>
              <Button variant='ghost' size='sm' className='self-start' render={<Link href={section.href} />} nativeButton={false}>
                {section.linkLabel}
                <ArrowRightIcon />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default SystemSettings
