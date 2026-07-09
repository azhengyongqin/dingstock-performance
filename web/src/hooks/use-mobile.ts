import * as React from 'react'

const MOBILE_BREAKPOINT = 1280

export function useIsMobile() {
  // 初始值必须固定为 undefined：若在初始化器里读 window.innerWidth，
  // 客户端首帧会与 SSR 产物不一致（窗口宽度 <1280px 时触发 hydration mismatch）。
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    mql.addEventListener('change', onChange)

    // 挂载后再依据真实窗口宽度切换，保证水合阶段服务端/客户端渲染一致
    onChange()

    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}
