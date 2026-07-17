import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownContent, MarkdownEditor } from '.'
import { uploadImageWithNovelFallback } from './novel/image-upload'

describe('MarkdownContent', () => {
  it('正确渲染 GFM 标题、强调、列表、表格和链接', () => {
    render(
      <MarkdownContent
        content={
          '## 绩效总结\n\n完成 **关键项目**：\n\n- 交付 A\n- 交付 B\n\n| 项目 | 状态 |\n| --- | --- |\n| A | 完成 |\n\n![结果图](https://example.com/result.png)\n\n[查看详情](https://example.com)'
        }
      />
    )

    expect(screen.getByRole('heading', { name: '绩效总结', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('关键项目').tagName).toBe('STRONG')
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '结果图' })).toHaveAttribute('src', 'https://example.com/result.png')
    const link = screen.getByRole('link', { name: '查看详情' })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link).not.toHaveAttribute('node')
  })

  it('不把原始 HTML 创建为可执行节点', () => {
    const { container } = render(
      <MarkdownContent
        content={'正常内容<script>alert(1)</script><iframe src="https://evil.example.com/embed/attack"></iframe>'}
      />
    )

    expect(screen.getByText('正常内容')).toBeInTheDocument()
    expect(screen.queryByText(/alert\(1\)/)).not.toBeInTheDocument()
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect(container.querySelector('iframe')).not.toBeInTheDocument()
  })

  it('安全渲染 Novel 增强格式、缩放图片和 YouTube 媒体', () => {
    const { container } = render(
      <MarkdownContent
        content={
          '<p><u>下划线</u> <span style="color: #9333ea">紫色</span> <mark data-color="#fdebeb" style="background-color: #fdebeb">高亮</mark> <span data-type="math">E=mc^2</span></p><img src="https://example.com/chart.png" alt="图表" width="320" height="180"><div data-youtube-video><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="640" height="480"></iframe></div><div data-twitter src="https://x.com/novel/status/123456789"></div>'
        }
      />
    )

    expect(container.querySelector('u')).toHaveTextContent('下划线')
    expect(container.querySelector('span')).toHaveStyle({ color: '#9333ea' })
    expect(container.querySelector('mark')).toHaveTextContent('高亮')
    expect(container.querySelector('.katex')).toHaveTextContent('E=mc2')
    expect(screen.getByRole('img', { name: '图表' })).toHaveAttribute('width', '320')
    expect(container.querySelector('iframe')).toHaveAttribute('src', 'https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(screen.getByRole('link', { name: '查看 X（Twitter）帖子' })).toHaveAttribute(
      'href',
      'https://x.com/novel/status/123456789'
    )
  })
})

describe('MarkdownEditor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('输入斜杠后可通过 Novel 命令菜单插入内容块', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<MarkdownEditor ariaLabel='Novel 编辑器' value='' onChange={onChange} />)

    const editor = await screen.findByRole('textbox', { name: 'Novel 编辑器' })

    await user.click(editor)
    await user.type(editor, '/')
    await user.click(await screen.findByRole('option', { name: /二级标题/ }))
    await user.type(editor, '阶段总结')

    expect(screen.getByRole('heading', { name: '阶段总结', level: 2 })).toBeInTheDocument()
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('## 阶段总结'))
  })

  it('源码版斜杠菜单提供本地图片上传入口', async () => {
    const user = userEvent.setup()

    render(<MarkdownEditor ariaLabel='源码版编辑器' value='' onChange={() => {}} />)

    const editor = await screen.findByRole('textbox', { name: '源码版编辑器' })

    await user.click(editor)
    await user.type(editor, '/')

    expect(await screen.findByRole('option', { name: /上传图片/ })).toBeInTheDocument()
  })

  it('完整源码版斜杠菜单提供图片和媒体嵌入能力', async () => {
    const user = userEvent.setup()

    render(<MarkdownEditor ariaLabel='完整源码编辑器' value='' onChange={() => {}} />)

    const editor = await screen.findByRole('textbox', { name: '完整源码编辑器' })

    await user.click(editor)
    await user.type(editor, '/')

    expect(await screen.findByRole('option', { name: /上传图片/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /YouTube/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Twitter/ })).toBeInTheDocument()
  })

  it('完整源码版可恢复下划线、文字颜色和高亮格式', async () => {
    const { container } = render(
      <MarkdownEditor
        ariaLabel='完整格式编辑器'
        value={
          '<p><u>需关注</u> <span style="color: #9333ea">紫色文字</span> <mark data-color="#fdebeb" style="background-color: #fdebeb">风险</mark></p>'
        }
        onChange={() => {}}
      />
    )

    await screen.findByRole('textbox', { name: '完整格式编辑器' })

    expect(container.querySelector('u')).toHaveTextContent('需关注')
    expect(container.querySelector('span[style*="color"]')).toHaveTextContent('紫色文字')
    expect(container.querySelector('mark')).toHaveTextContent('风险')
  })

  it('富文本修改后继续保留下划线、文字颜色和高亮格式', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <MarkdownEditor
        ariaLabel='增强格式编辑器'
        value={
          '<p><u>需关注</u> <span style="color: #9333ea">紫色文字</span> <mark data-color="#fdebeb" style="background-color: #fdebeb">风险</mark></p>'
        }
        onChange={onChange}
      />
    )

    const editor = await screen.findByRole('textbox', { name: '增强格式编辑器' })

    await user.click(editor)
    await user.type(editor, '补充')
    await waitFor(() => expect(onChange).toHaveBeenCalled())

    const markdown = onChange.mock.calls.at(-1)?.[0] as string

    expect(markdown).toMatch(/<u>[^<]*需关注<\/u>/u)
    expect(markdown).toMatch(/<span[^>]+color:\s*(?:#9333ea|rgb\(147, 51, 234\))[^>]*>紫色文字<\/span>/u)
    expect(markdown).toMatch(/<mark[^>]+data-color="#fdebeb"[^>]*>风险/u)
  })

  it('完整源码版显示实时词数', async () => {
    render(<MarkdownEditor ariaLabel='词数编辑器' value='hello world' onChange={() => {}} />)

    await screen.findByRole('textbox', { name: '词数编辑器' })

    expect(await screen.findByRole('status')).toHaveTextContent('2 个词')
  })

  it('可通过完整源码菜单嵌入 YouTube 视频', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<MarkdownEditor ariaLabel='媒体编辑器' value='' onChange={onChange} />)

    const editor = await screen.findByRole('textbox', { name: '媒体编辑器' })

    await user.click(editor)
    await user.type(editor, '/')
    await user.click(await screen.findByRole('option', { name: /YouTube/ }))
    await user.type(screen.getByRole('textbox', { name: '媒体地址' }), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: '确认嵌入' }))

    await waitFor(() => expect(container.querySelector('div[data-youtube-video] iframe')).toBeInTheDocument())
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('youtube.com/embed/dQw4w9WgXcQ'))
  })

  it('通过源码版斜杠菜单选择图片并回写为 Markdown 图片语法', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const uploadImage = vi.fn(async () => 'https://example.com/result.png')
    const imageFile = new File(['result'], 'result.png', { type: 'image/png' })

    const { container } = render(
      <MarkdownEditor ariaLabel='图片编辑器' value='' onChange={onChange} uploadImage={uploadImage} />
    )

    const editor = await screen.findByRole('textbox', { name: '图片编辑器' })

    await user.click(editor)
    await user.type(editor, '/')
    await user.click(await screen.findByRole('option', { name: /上传图片/ }))
    await user.upload(screen.getByLabelText('选择图片文件'), imageFile)

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain('![](https://example.com/result.png)'))
    expect(uploadImage).toHaveBeenCalledWith(imageFile)
    expect(container.querySelector('img[src="https://example.com/result.png"]')).toBeInTheDocument()
  })

  it('粘贴剪贴板图片后上传并回写为 Markdown 图片语法', async () => {
    const onChange = vi.fn()

    // 缓存命中、测试桩等上传实现可能立即完成，也必须等 Novel 的占位节点先落地。
    const uploadImage = vi.fn(async () => 'https://example.com/pasted-screenshot.png')

    const screenshot = new File(['screenshot'], 'screenshot.png', { type: 'image/png' })

    render(<MarkdownEditor ariaLabel='粘贴图片编辑器' value='' onChange={onChange} uploadImage={uploadImage} />)

    const editor = await screen.findByRole('textbox', { name: '粘贴图片编辑器' })

    fireEvent.paste(editor, {
      clipboardData: {
        files: [screenshot],
        types: ['Files'],
        getData: () => ''
      }
    })

    await waitFor(() => expect(uploadImage).toHaveBeenCalledWith(screenshot))
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('![](https://example.com/pasted-screenshot.png)')
    )
  })

  it('未配置上传服务时把粘贴图片以内嵌 Data URL 保存', async () => {
    const onChange = vi.fn()
    const screenshot = new File(['screenshot'], 'screenshot.png', { type: 'image/png' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Missing BLOB_READ_WRITE_TOKEN', { status: 401 })))

    render(<MarkdownEditor ariaLabel='本地图片编辑器' value='' onChange={onChange} />)

    const editor = await screen.findByRole('textbox', { name: '本地图片编辑器' })

    fireEvent.paste(editor, {
      clipboardData: {
        files: [screenshot],
        types: ['Files'],
        getData: () => ''
      }
    })

    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('![](data:image/png;base64,c2NyZWVuc2hvdA==)')
    )
  })

  it('配置 Blob 服务后默认通过同源上传端点保存图片地址', async () => {
    const onChange = vi.fn()
    const screenshot = new File(['screenshot'], '绩效截图.png', { type: 'image/png' })

    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ url: 'https://blob.example.com/performance.png' }, { status: 200 })
    )

    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/performance')
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'test-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    })
    render(<MarkdownEditor ariaLabel='Blob 图片编辑器' value='' onChange={onChange} />)

    const editor = await screen.findByRole('textbox', { name: 'Blob 图片编辑器' })

    fireEvent.paste(editor, {
      clipboardData: {
        files: [screenshot],
        types: ['Files'],
        getData: () => ''
      }
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/performance/api/upload', expect.any(Object)))

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit

    expect(new Headers(requestInit.headers).get('Authorization')).toBe('Bearer test-token')
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('![](https://blob.example.com/performance.png)')
    )
  })

  it('Blob 服务异常时明确失败而不是静默写入 Base64', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Blob unavailable', { status: 500 })))

    await expect(
      uploadImageWithNovelFallback(new File(['screenshot'], 'screenshot.png', { type: 'image/png' }))
    ).rejects.toMatchObject({ status: 500 })
  })

  it('连续粘贴多张图片时不会因旧编辑器事务丢失图片', async () => {
    const onChange = vi.fn()
    const uploadImage = vi.fn(async (file: File) => `https://example.com/${file.name}`)

    render(<MarkdownEditor ariaLabel='连续粘贴编辑器' value='' onChange={onChange} uploadImage={uploadImage} />)

    const editor = await screen.findByRole('textbox', { name: '连续粘贴编辑器' })

    const pasteImage = (file: File) =>
      fireEvent.paste(editor, {
        clipboardData: {
          files: [file],
          types: ['Files'],
          getData: () => ''
        }
      })

    pasteImage(new File(['first'], 'first.png', { type: 'image/png' }))
    pasteImage(new File(['second'], 'second.png', { type: 'image/png' }))

    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      const markdown = onChange.mock.calls.at(-1)?.[0] as string

      expect(markdown).toContain('![](https://example.com/first.png)')
      expect(markdown).toContain('![](https://example.com/second.png)')
    })
  })

  it('解析已有 Markdown，并将富文本修改继续回写为 Markdown', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<MarkdownEditor ariaLabel='总结编辑器' value='## 已有总结' onChange={onChange} />)

    const editor = await screen.findByRole('textbox', { name: '总结编辑器' })

    expect(screen.getByRole('heading', { name: '已有总结', level: 2 })).toBeInTheDocument()
    await user.click(editor)
    await user.type(editor, '补充')

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('补充')
  })

  it('富文本修改后保留已有 Markdown 链接地址', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <MarkdownEditor
        ariaLabel='链接总结编辑器'
        value={'[查看详情](https://example.com)\n\n## 总结'}
        onChange={onChange}
      />
    )

    const editor = await screen.findByRole('textbox', { name: '链接总结编辑器' })

    expect(screen.getByRole('link', { name: '查看详情' })).toHaveAttribute('href', 'https://example.com')

    await user.click(editor)
    await user.type(editor, '补充')
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('[查看详情](https://example.com)')
  })

  it('禁用态使用纯 Markdown 渲染，不显示工具栏或可编辑节点', () => {
    const { container } = render(
      <MarkdownEditor ariaLabel='只读总结' value='**已提交**' disabled onChange={() => {}} />
    )

    expect(screen.getByText('已提交').tagName).toBe('STRONG')
    expect(container.querySelector('[data-slot="markdown-content"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="markdown-toolbar"]')).not.toBeInTheDocument()
    expect(container.querySelector('[contenteditable]')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('把已有 GFM 表格与任务列表解析为可编辑结构', async () => {
    render(
      <MarkdownEditor
        ariaLabel='GFM 编辑器'
        value={'总结\n\n| 项目 | 状态 |\n| --- | --- |\n| A | 完成 |\n\n- [x] 已验收'}
        onChange={() => {}}
      />
    )

    await screen.findByRole('textbox', { name: 'GFM 编辑器' })
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('继续插入图片后仍保留已有 Markdown 图片地址', async () => {
    const onChange = vi.fn()
    const uploadImage = vi.fn(async () => 'https://example.com/result.png')
    const imageFile = new File(['result'], 'result.png', { type: 'image/png' })

    const view = render(
      <MarkdownEditor
        ariaLabel='图片总结编辑器'
        value={'![架构图](https://example.com/architecture.png)\n\n## 总结'}
        onChange={onChange}
        uploadImage={uploadImage}
      />
    )

    const editor = await screen.findByRole('textbox', { name: '图片总结编辑器' })

    expect(screen.getByRole('img', { name: '架构图' })).toHaveAttribute('src', 'https://example.com/architecture.png')

    fireEvent.paste(editor, {
      clipboardData: {
        files: [imageFile],
        types: ['Files'],
        getData: () => ''
      }
    })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const markdown = onChange.mock.calls.at(-1)?.[0] as string

    expect(markdown).toContain('![架构图](https://example.com/architecture.png)')
    expect(markdown).toContain('![](https://example.com/result.png)')
    expect(markdown).toContain('\n\n## 总结')

    // 用刚序列化出的 Markdown 重新挂载，确保图片后的标题结构没有被粘连破坏。
    view.rerender(<MarkdownEditor ariaLabel='图片总结编辑器' value={markdown} onChange={onChange} />)
    expect(screen.getByRole('heading', { name: '总结', level: 2 })).toBeInTheDocument()
  })

  it('富文本修改后保留图片缩放尺寸', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <MarkdownEditor
        ariaLabel='缩放图片编辑器'
        value='<img src="https://example.com/chart.png" alt="图表" width="320" height="180">'
        onChange={onChange}
      />
    )

    const editor = await screen.findByRole('textbox', { name: '缩放图片编辑器' })

    await user.click(editor)
    await user.type(editor, '补充')
    await waitFor(() => expect(onChange).toHaveBeenCalled())

    const markdown = onChange.mock.calls.at(-1)?.[0] as string

    expect(markdown).toContain('width="320"')
    expect(markdown).toContain('height="180"')
  })
})
