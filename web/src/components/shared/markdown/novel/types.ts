export type ImageUploadHandler = (file: File) => Promise<string>

/**
 * Markdown 编辑器可选能力开关；缺省全部开启，与 Novel 完整编辑态一致。
 * 关闭某项只隐藏对应交互入口，已有内容仍按既有扩展渲染。
 */
export type MarkdownEditorFeatures = {

  /** 顶部固定工具栏 */
  toolbar?: boolean

  /** Ask AI 选区助手 */
  askAi?: boolean

  /** 输入 / 唤起斜杠命令菜单 */
  slashCommand?: boolean

  /** 选区浮动菜单：块类型切换 */
  nodeSelector?: boolean

  /** 选区浮动菜单：链接 */
  link?: boolean

  /** 选区浮动菜单：行内格式（加粗/斜体/下划线/删除线/代码） */
  textFormatting?: boolean

  /** 选区浮动菜单：文字颜色与高亮 */
  color?: boolean

  /** 选区浮动菜单：LaTeX 公式 */
  math?: boolean

  /** YouTube / X（Twitter）媒体嵌入 */
  mediaEmbed?: boolean

  /** 块级拖拽手柄 */
  dragHandle?: boolean

  /** 斜杠菜单中的「上传图片」入口 */
  imageUpload?: boolean

  /** 粘贴图片 */
  imagePaste?: boolean

  /** 拖入图片 */
  imageDrop?: boolean

  /** 图片缩放把手 */
  imageResize?: boolean

  /** 粘贴 Markdown 源码时解析为富文本（并在复制时输出 Markdown） */
  pasteMarkdown?: boolean

  /** 右上角词数统计 */
  wordCount?: boolean
}

export type ResolvedMarkdownEditorFeatures = Required<MarkdownEditorFeatures>

export const DEFAULT_MARKDOWN_EDITOR_FEATURES: ResolvedMarkdownEditorFeatures = {
  toolbar: true,
  askAi: true,
  slashCommand: true,
  nodeSelector: true,
  link: true,
  textFormatting: true,
  color: true,
  math: true,
  mediaEmbed: true,
  dragHandle: true,
  imageUpload: true,
  imagePaste: true,
  imageDrop: true,
  imageResize: true,
  pasteMarkdown: true,
  wordCount: true
}

export const resolveMarkdownEditorFeatures = (
  features?: MarkdownEditorFeatures
): ResolvedMarkdownEditorFeatures => ({
  ...DEFAULT_MARKDOWN_EDITOR_FEATURES,
  ...features
})

/** 任一选区浮动菜单能力开启时才挂载气泡菜单容器。 */
export const hasBubbleMenuFeatures = (features: ResolvedMarkdownEditorFeatures) =>
  features.askAi ||
  features.nodeSelector ||
  features.link ||
  features.textFormatting ||
  features.color ||
  features.math
