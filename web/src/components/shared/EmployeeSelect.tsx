'use client'

/**
 * 通用员工 Select：下拉内 SearchInput（拼音）+ 标准头像/姓名/职位；
 * 触发器仅展示头像 + 姓名；locked 时只读展示。
 */

import { useMemo, useState } from 'react'

import SearchInput, { SEARCH_INPUT_PINYIN_PLACEHOLDER } from '@/components/shared/SearchInput'
import { UserAvatar } from '@/components/shared/lark'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { matchesPinyinSearch } from '@/lib/pinyin-search'
import { cn } from '@/lib/utils'

export type EmployeeSelectOption = {
  id: string
  name: string
  openId?: string
  avatarUrl?: string
  jobTitle?: string | null

  /** 额外副文案（如部门），与 jobTitle 组合展示于下拉项 */
  description?: string | null
  disabled?: boolean
}

export type EmployeeSelectProps = {
  options: EmployeeSelectOption[]
  value?: string | null
  onValueChange: (value: string | null) => void
  placeholder?: string
  searchPlaceholder?: string

  /** 选项列表为空时的提示 */
  emptyText?: string

  /** 搜索无匹配时的提示 */
  noMatchText?: string

  /** 锁定后仅展示选中员工，不可更换 */
  locked?: boolean
  disabled?: boolean
  className?: string

  /** 锁定/选中但 options 尚未就绪时的兜底展示 */
  selectedFallback?: Partial<Pick<EmployeeSelectOption, 'name' | 'openId' | 'avatarUrl' | 'jobTitle' | 'description'>>

  /** 锁定态副文案（无职位时的说明） */
  lockedHint?: string
}

const subtitleOf = (option: Pick<EmployeeSelectOption, 'jobTitle' | 'description'> | null | undefined) => {
  if (!option) return ''

  return [option.jobTitle, option.description].filter(Boolean).join(' · ')
}

const EmployeeSelect = ({
  options,
  value,
  onValueChange,
  placeholder = '选择员工',
  searchPlaceholder = SEARCH_INPUT_PINYIN_PLACEHOLDER,
  emptyText = '暂无可选员工',
  noMatchText = '未找到匹配的员工',
  locked = false,
  disabled = false,
  className,
  selectedFallback,
  lockedHint
}: EmployeeSelectProps) => {
  const [query, setQuery] = useState('')

  const selected = useMemo(() => {
    if (!value) return null

    return options.find(option => option.id === value) ?? null
  }, [options, value])

  const display =
    selected ??
    (value && selectedFallback
      ? { id: value, name: selectedFallback.name ?? value, ...selectedFallback }
      : null)

  const filtered = useMemo(() => {
    const keyword = query.trim()

    if (!keyword) return options

    return options.filter(option => {
      const haystack = [option.name, option.jobTitle, option.description].filter(Boolean).join(' ')

      return matchesPinyinSearch(option.name, keyword) || matchesPinyinSearch(haystack, keyword)
    })
  }, [options, query])

  if (locked) {
    return (
      <div className={cn('bg-muted/40 flex items-center gap-2.5 rounded-lg border px-3 py-2', className)}>
        <UserAvatar
          openId={display?.openId}
          name={display?.name}
          avatarUrl={display?.avatarUrl}
          size='sm'
        />
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>{display?.name ?? '未选择员工'}</p>
          {lockedHint ? <p className='text-muted-foreground text-xs'>{lockedHint}</p> : null}
        </div>
      </div>
    )
  }

  const empty = options.length === 0

  return (
    <Select
      value={value ?? undefined}
      onValueChange={next => {
        onValueChange(next ?? null)
        setQuery('')
      }}
      onOpenChange={open => {
        if (!open) setQuery('')
      }}
      disabled={disabled || empty}
    >
      <SelectTrigger className={cn('h-9 w-full', className)}>
        {display ? (
          <span className='flex min-w-0 flex-1 items-center gap-2 text-left'>
            <UserAvatar
              openId={display.openId}
              name={display.name}
              avatarUrl={display.avatarUrl}
              size='sm'
              withProfileCard={false}
            />
            <span className='truncate'>{display.name}</span>
          </span>
        ) : (
          <SelectValue placeholder={empty ? emptyText : placeholder} />
        )}
      </SelectTrigger>
      <SelectContent className='min-w-(--anchor-width) p-0' alignItemWithTrigger={false}>
        <div
          className='bg-popover sticky top-0 z-10 border-b p-2'
          onPointerDown={event => {
            // 阻止指针事件关闭弹层，便于在下拉内输入搜索
            event.preventDefault()
          }}
        >
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={searchPlaceholder}
            disabled={disabled}
            className='border-input/30 bg-input/30 h-8! rounded-lg! shadow-none!'
            onKeyDown={event => {
              // 避免按键冒泡到 Select typeahead，导致搜索态被清掉或列表不更新
              event.stopPropagation()
            }}
          />
        </div>
        <div className='max-h-56 overflow-y-auto p-1'>
          {filtered.length === 0 ? (
            <p className='text-muted-foreground px-2 py-6 text-center text-sm'>{noMatchText}</p>
          ) : (
            filtered.map(option => {
              const subtitle = subtitleOf(option)

              return (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  disabled={option.disabled}
                  className='items-center py-2 pr-8'
                >
                  <span className='flex items-center gap-2.5'>
                    <UserAvatar
                      openId={option.openId}
                      name={option.name}
                      avatarUrl={option.avatarUrl}
                      size='default'
                      withProfileCard={false}
                    />
                    <span className='flex min-w-0 flex-col gap-0.5'>
                      <span className='truncate font-medium'>{option.name}</span>
                      {subtitle ? (
                        <span className='text-muted-foreground truncate text-xs font-normal'>{subtitle}</span>
                      ) : null}
                    </span>
                  </span>
                </SelectItem>
              )
            })
          )}
        </div>
      </SelectContent>
    </Select>
  )
}

export default EmployeeSelect
