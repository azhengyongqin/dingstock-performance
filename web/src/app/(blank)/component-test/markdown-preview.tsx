'use client'

import { useMemo, useState } from 'react'

import {
  DEFAULT_MARKDOWN_EDITOR_FEATURES,
  MarkdownEditor,
  type MarkdownEditorFeatures,
  type ResolvedMarkdownEditorFeatures
} from '@/components/shared/markdown'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'

type FeatureToggle = {
  key: keyof ResolvedMarkdownEditorFeatures
  label: string
  description: string
}

const FEATURE_TOGGLES: FeatureToggle[] = [
  { key: 'toolbar', label: '顶部工具栏', description: '固定工具栏：撤销/重做、块类型、格式、链接、颜色、媒体' },
  { key: 'askAi', label: 'Ask AI', description: '选区浮动菜单中的 AI 助手入口' },
  { key: 'slashCommand', label: '斜杠菜单', description: '输入 / 唤起完整内容块命令' },
  { key: 'nodeSelector', label: '块类型切换', description: '选区菜单中的标题/列表等块类型' },
  { key: 'link', label: '链接', description: '选区菜单中的链接编辑' },
  { key: 'textFormatting', label: '文本格式', description: '加粗 / 斜体 / 下划线 / 删除线 / 行内代码' },
  { key: 'color', label: '文字颜色与高亮', description: '选区菜单中的颜色与高亮' },
  { key: 'math', label: '公式', description: '选区菜单中的 LaTeX 公式转换' },
  { key: 'mediaEmbed', label: '媒体嵌入', description: '斜杠菜单中的 YouTube / Twitter 嵌入' },
  { key: 'dragHandle', label: '块拖拽', description: '段落左侧拖拽手柄' },
  { key: 'imageUpload', label: '图片选择上传', description: '斜杠菜单「上传图片」与隐藏文件选择' },
  { key: 'imagePaste', label: '粘贴图片', description: '从剪贴板粘贴图片并上传' },
  { key: 'imageDrop', label: '拖入图片', description: '将图片文件拖入编辑器' },
  { key: 'imageResize', label: '图片缩放', description: '选中图片后的缩放把手' },
  {
    key: 'pasteMarkdown',
    label: '粘贴 Markdown',
    description: '粘贴 Markdown 源码时解析为富文本；复制时输出 Markdown'
  },
  { key: 'wordCount', label: '词数统计', description: '编辑器右上角实时词数' }
]

const SAMPLE_MARKDOWN =
  '## 本周期总结\n\n完成了 **关键目标**，并沉淀以下成果：\n\n- 交付绩效评审流程\n- 优化跨团队协作\n\n> 下一周期继续提升交付效率。'

/** 共享 Markdown 能力示例：功能开关 + 编辑态 / 只读渲染对照。 */
const MarkdownPreview = () => {
  const [content, setContent] = useState(SAMPLE_MARKDOWN)
  const [disabled, setDisabled] = useState(false)
  const [invalid, setInvalid] = useState(false)

  const [features, setFeatures] = useState<ResolvedMarkdownEditorFeatures>({
    ...DEFAULT_MARKDOWN_EDITOR_FEATURES
  })

  const featureProps = useMemo<MarkdownEditorFeatures>(() => features, [features])

  const setFeature = (key: keyof ResolvedMarkdownEditorFeatures, enabled: boolean) => {
    setFeatures(prev => ({ ...prev, [key]: enabled }))
  }

  const enableAll = () => setFeatures({ ...DEFAULT_MARKDOWN_EDITOR_FEATURES })

  const disableAll = () =>
    setFeatures(
      Object.fromEntries(
        Object.keys(DEFAULT_MARKDOWN_EDITOR_FEATURES).map(key => [key, false])
      ) as ResolvedMarkdownEditorFeatures
    )

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
          <div className='space-y-1.5'>
            <CardTitle>功能开关</CardTitle>
            <CardDescription>
              切换后编辑器会按新配置重建；关闭只隐藏交互入口，已有增强内容仍可渲染。
            </CardDescription>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button type='button' size='sm' variant='outline' onClick={enableAll}>
              全部开启
            </Button>
            <Button type='button' size='sm' variant='outline' onClick={disableAll}>
              全部关闭
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <FieldGroup className='gap-3'>
            <div className='grid gap-3 md:grid-cols-2'>
              <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                <span>
                  <span className='block font-medium'>禁用（只读）</span>
                  <span className='text-muted-foreground text-xs'>走 MarkdownContent，不挂载编辑器</span>
                </span>
                <Switch checked={disabled} onCheckedChange={checked => setDisabled(Boolean(checked))} />
              </label>
              <label className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
                <span>
                  <span className='block font-medium'>校验失败态</span>
                  <span className='text-muted-foreground text-xs'>边框 / focus ring 使用 destructive</span>
                </span>
                <Switch
                  checked={invalid}
                  disabled={disabled}
                  onCheckedChange={checked => setInvalid(Boolean(checked))}
                />
              </label>
            </div>

            <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
              {FEATURE_TOGGLES.map(item => (
                <label
                  key={item.key}
                  className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'
                >
                  <span>
                    <span className='block font-medium'>{item.label}</span>
                    <span className='text-muted-foreground text-xs'>{item.description}</span>
                  </span>
                  <Switch
                    checked={features[item.key]}
                    disabled={disabled}
                    onCheckedChange={checked => setFeature(item.key, Boolean(checked))}
                  />
                </label>
              ))}
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className='grid gap-4 xl:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Novel 源码编辑态</CardTitle>
            <CardDescription>
              支持 Ask AI、完整斜杠菜单、文本格式/颜色/公式、媒体嵌入、块拖拽和图片选择/粘贴/拖入/缩放。
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <MarkdownEditor
              ariaLabel='Markdown 示例编辑器'
              value={content}
              onChange={setContent}
              disabled={disabled}
              invalid={invalid}
              features={featureProps}
            />
            <Field>
              <FieldLabel>当前开关摘要</FieldLabel>
              <FieldDescription>
                {disabled
                  ? 'disabled=true（只读渲染）'
                  : FEATURE_TOGGLES.filter(item => features[item.key])
                      .map(item => item.label)
                      .join(' · ') || '无交互能力开启'}
                {invalid ? ' · invalid' : ''}
              </FieldDescription>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>总结只读态</CardTitle>
            <CardDescription>使用纯 Markdown 渲染组件，不显示工具栏或可编辑区域。</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <MarkdownEditor ariaLabel='Markdown 只读示例' value={content} onChange={() => {}} disabled />
            <pre className='bg-muted max-h-48 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap'>{content}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default MarkdownPreview
