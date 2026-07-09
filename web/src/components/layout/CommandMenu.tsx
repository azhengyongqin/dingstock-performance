'use client'

// React Imports
import { Fragment, useCallback, useEffect, useState } from 'react'

// Next Imports
import { useRouter } from 'next/navigation'

// Third-party Imports
import {
  BarChart3Icon,
  CalendarRangeIcon,
  FilePenIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  SearchIcon
} from 'lucide-react'

// Component Imports
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'

// Data Imports
import { searchData } from '@/assets/data/search'

/**
 * 全局命令面板（⌘K / Ctrl+K / "/" 唤起）。
 * 搜索数据来源：src/assets/data/search.ts，与导航配置保持一致。
 */
const CommandMenu = () => {
  // States
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Hooks
  const router = useRouter()

  const runCommand = useCallback((command: () => unknown) => {
    setOpen(false)
    command()
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
        if (
          (e.target instanceof HTMLElement && e.target.isContentEditable) ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        ) {
          return
        }

        e.preventDefault()
        setOpen(open => !open)
      }
    }

    document.addEventListener('keydown', down)

    return () => document.removeEventListener('keydown', down)
  }, [])

  // 命令面板中渲染的搜索分组
  const searchGroups = searchData

  return (
    <>
      <Button
        variant='ghost'
        className='hidden px-2.5 font-normal hover:bg-transparent sm:block dark:hover:bg-transparent'
        onClick={() => setOpen(true)}
      >
        <div className='text-muted-foreground hidden items-center gap-1.5 text-sm sm:flex'>
          <SearchIcon />
          <span>输入关键字搜索...</span>
          <Kbd>⌘K</Kbd>
        </div>
      </Button>
      <Button variant='ghost' size='icon' className='sm:hidden' onClick={() => setOpen(true)}>
        <SearchIcon />
        <span className='sr-only'>搜索</span>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command
          className='**[[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-10 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group]]:px-2 **:[[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 **:[[cmdk-input-wrapper]_svg]:h-5 **:[[cmdk-input-wrapper]_svg]:w-5 **:[[cmdk-input]]:h-12 **:[[cmdk-item]]:px-2 **:[[cmdk-item]]:py-3'
          filter={(value, search, keywords) => {
            search = search.toLowerCase()
            value = value.toLowerCase()

            // 名称完全匹配（最高优先级）
            if (value === search) return 2

            // 名称部分匹配（中优先级）
            if (value.includes(search)) return 1.5

            // 标签/关键词匹配（最低优先级）
            if (keywords && keywords.length > 0) {
              if (keywords.some(keyword => keyword.toLowerCase() === search)) return 1.25

              const extendedValue = value + ' ' + keywords.join(' ').toLowerCase()

              if (extendedValue.includes(search)) return 1
            }

            return 0
          }}
        >
          <CommandInput placeholder='搜索页面或功能...' value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>未找到匹配结果</CommandEmpty>
            {search ? (
              searchGroups.map((searchGroup, index) => (
                <Fragment key={index}>
                  <CommandGroup heading={searchGroup.title}>
                    {searchGroup.data.map((item, i) => (
                      <CommandItem
                        key={i}
                        keywords={item.tags}
                        onSelect={() =>
                          runCommand(() => {
                            if (item.openInNewTab) {
                              window.open(item.href, '_blank', 'noopener,noreferrer')
                            } else {
                              router.push(item.href)
                            }
                          })
                        }
                      >
                        <item.icon />
                        <span>{item.name}</span>
                        {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {index !== searchGroups.length - 1 && <CommandSeparator />}
                </Fragment>
              ))
            ) : (
              <CommandGroup heading='快捷入口'>
                <CommandItem onSelect={() => runCommand(() => router.push('/workbench'))}>
                  <LayoutDashboardIcon />
                  <span>工作台</span>
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => router.push('/cycles'))}>
                  <CalendarRangeIcon />
                  <span>周期列表 - 绩效周期</span>
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => router.push('/self-review'))}>
                  <FilePenIcon />
                  <span>员工自评 - 我的绩效</span>
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => router.push('/review-tasks'))}>
                  <ListTodoIcon />
                  <span>任务列表 - 评审任务</span>
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => router.push('/dashboard'))}>
                  <BarChart3Icon />
                  <span>绩效看板 - 数据看板</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

export default CommandMenu
