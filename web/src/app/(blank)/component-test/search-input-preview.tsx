'use client'

/**
 * SearchInput 组件实验台：统一可清除搜索框 + 拼音匹配演示。
 */

import { useMemo, useState } from 'react'

import SearchInput, { SEARCH_INPUT_PINYIN_PLACEHOLDER } from '@/components/shared/SearchInput'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { matchesPinyinSearch } from '@/lib/pinyin-search'

const SAMPLE_NAMES = ['张三', '李四', '王五', 'Zheng Lei', '欧阳娜娜', '陈一凡']

const SearchInputPreview = () => {
  const [query, setQuery] = useState('')
  const [orgStyleQuery, setOrgStyleQuery] = useState('')

  const matched = useMemo(
    () => SAMPLE_NAMES.filter(name => matchesPinyinSearch(name, query)),
    [query]
  )

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>SearchInput</CardTitle>
          <CardDescription>
            与组织人员多选弹窗同源的统一搜索框：搜索图标、可清除、配合 `matchesPinyinSearch` 支持拼音/首字母。
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <SearchInput value={query} onChange={setQuery} placeholder={SEARCH_INPUT_PINYIN_PLACEHOLDER} />
          <ul className='text-muted-foreground space-y-1 text-sm'>
            {matched.length === 0 ? (
              <li>无匹配</li>
            ) : (
              matched.map(name => (
                <li key={name} className='text-foreground'>
                  {name}
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>组织多选同款占位</CardTitle>
          <CardDescription>占位文案可按场景覆盖，UI 与弹窗内搜索框一致。</CardDescription>
        </CardHeader>
        <CardContent>
          <SearchInput
            value={orgStyleQuery}
            onChange={setOrgStyleQuery}
            placeholder='搜索联系人、部门和我管理的群组'
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default SearchInputPreview
