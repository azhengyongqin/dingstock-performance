'use client'

/**
 * 统一搜索框：左侧搜索图标 + 可清除输入。
 * 与组织人员多选弹窗同源 UI；拼音匹配请配合 `@/lib/pinyin-search` 使用。
 */

import { useRef, type ComponentProps, type Ref } from 'react'

import { SearchIcon, XIcon } from 'lucide-react'

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

export type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
  /** 清除后是否自动聚焦，默认 true */
  focusOnClear?: boolean
  inputRef?: Ref<HTMLInputElement>
} & Omit<ComponentProps<typeof InputGroupInput>, 'value' | 'onChange' | 'type' | 'ref'>

const SearchInput = ({
  value,
  onChange,
  placeholder = '搜索…',
  className,
  id,
  disabled,
  focusOnClear = true,
  inputRef,
  ...inputProps
}: SearchInputProps) => {
  const localRef = useRef<HTMLInputElement>(null)

  const setRefs = (node: HTMLInputElement | null) => {
    localRef.current = node

    if (typeof inputRef === 'function') {
      inputRef(node)
    } else if (inputRef) {
      inputRef.current = node
    }
  }

  const clear = () => {
    onChange('')
    if (focusOnClear) localRef.current?.focus()
  }

  return (
    <InputGroup className={cn(className)}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        {...inputProps}
        ref={setRefs}
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
      />
      {value.length > 0 && !disabled && (
        <InputGroupAddon align='inline-end'>
          <InputGroupButton size='icon-xs' variant='ghost' aria-label='清除搜索' onClick={clear}>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

export default SearchInput
