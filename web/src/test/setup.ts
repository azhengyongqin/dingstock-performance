import '@testing-library/jest-dom/vitest'

// jsdom 未实现 Range 几何 API；ProseMirror 在工具栏命令后滚动光标时会读取它们。
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

// jsdom 未实现坐标命中查询；Novel 的斜杠菜单与 ProseMirror 光标定位会调用它。
if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.body
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom 不提供响应式媒体查询；评估分栏默认按桌面宽度运行测试。
if (!window.matchMedia) {
  window.matchMedia = query => {
    const viewportWidth = 1440
    const minWidth = query.match(/\(min-width:\s*(\d+)px\)/)?.[1]
    const maxWidth = query.match(/\(max-width:\s*(\d+)px\)/)?.[1]

    const matches =
      (minWidth ? viewportWidth >= Number(minWidth) : true) &&
      (maxWidth ? viewportWidth <= Number(maxWidth) : true) &&
      Boolean(minWidth || maxWidth)

    return {
      matches,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true
    } as MediaQueryList
  }
}

// 横向滚动 Tab 会定位当前项；jsdom 没有实现元素级 scrollTo。
if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = () => {}
}

// Base UI 的滚动区域在关闭时会等待 Web Animations；jsdom 仅缺少该浏览器 API。
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => []
}

// cmdk 在斜杠菜单切换选中项时会把命令滚动到可视区域。
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Novel 的全局拖拽手柄会用该 API 查找鼠标下方的 ProseMirror 节点。
if (!document.elementsFromPoint) {
  document.elementsFromPoint = () => []
}
