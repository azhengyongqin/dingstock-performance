/*
 * 主题默认配置。
 * 注意：mode / skin / layout / sidebarOpen 等项会被 cookie 覆盖（cookie 优先级最高），
 * 修改后如果本地看不到效果，可在浏览器 Application/Storage 里清除对应 cookie 再刷新，
 * 或使用右上角 Customizer 的 reset 按钮重置。
 */

const themeConfig = {
  templateName: '盯潮-绩效', // 系统名称（Logo 旁展示）
  homePageUrl: '/workbench', // 登录后 / Logo 点击的默认首页
  settingsCookieName: 'dingstock-performance-settings',
  mode: 'system', // 'system' | 'light' | 'dark'
  themePreset: 'default',
  font: 'geist',
  radius: 'md', // 'none' | 'sm' | 'md' | 'lg'
  scale: 'md', // 'sm' | 'md' | 'lg'
  layout: 'compact', // 'compact' | 'full'
  sidebarVariant: 'default', // 'default' | 'inset' | 'floating'
  sidebarCollapsible: 'icon', // 'offcanvas' | 'icon' | 'none'
  sidebarOpen: true
} as const

export default themeConfig
