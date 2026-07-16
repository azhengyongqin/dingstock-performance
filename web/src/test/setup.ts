import '@testing-library/jest-dom/vitest'

// jsdom 未实现 Range 几何 API；ProseMirror 在工具栏命令后滚动光标时会读取它们。
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
