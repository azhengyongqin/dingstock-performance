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

// Base UI 的滚动区域在关闭时会等待 Web Animations；jsdom 仅缺少该浏览器 API。
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => []
}

// cmdk 在斜杠菜单切换选中项时会把命令滚动到可视区域。
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
