'use client'

import { useEffect, useRef } from 'react'

import { CheckIcon, LinkIcon, Trash2Icon } from 'lucide-react'
import { useEditor } from 'novel'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const getUrlFromString = (value: string) => {
  try {
    return new URL(value).toString()
  } catch {
    try {
      if (value.includes('.') && !value.includes(' ')) return new URL(`https://${value}`).toString()
    } catch {
      return null
    }
  }

  return null
}

type LinkSelectorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 从 Novel 源码 LinkSelector 移植，输入控件替换为项目 shadcn Input。 */
export const LinkSelector = ({ open, onOpenChange }: LinkSelectorProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const { editor } = useEditor()

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!editor) return null

  const currentHref = editor.getAttributes('link').href as string | undefined

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button type='button' size='sm' variant='ghost' className='rounded-none' />}>
        <LinkIcon className={cn('size-4', editor.isActive('link') && 'text-primary')} />
        <span>链接</span>
      </PopoverTrigger>
      <PopoverContent align='start' sideOffset={8} className='w-72 gap-0 p-1'>
        <form
          className='flex items-center gap-1'
          onSubmit={event => {
            event.preventDefault()

            const formData = new FormData(event.currentTarget)
            const url = getUrlFromString(String(formData.get('href') ?? ''))

            if (!url) return

            editor.chain().focus().setLink({ href: url }).run()
            onOpenChange(false)
          }}
        >
          <Input
            ref={inputRef}
            name='href'
            aria-label='链接地址'
            placeholder='粘贴链接地址'
            defaultValue={currentHref ?? ''}
            className='h-8 flex-1'
          />
          {currentHref ? (
            <Button
              type='button'
              size='icon-sm'
              variant='destructive'
              aria-label='移除链接'
              onClick={() => {
                editor.chain().focus().unsetLink().run()
                onOpenChange(false)
              }}
            >
              <Trash2Icon className='size-4' />
            </Button>
          ) : (
            <Button type='submit' size='icon-sm' aria-label='确认链接'>
              <CheckIcon className='size-4' />
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}
