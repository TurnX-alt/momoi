import { useEffect, useState } from 'react'

/**
 * 跟踪 documentElement 上的 dark class（图表等需要按主题取具体色值的地方用）。
 * useTheme 是逐实例局部状态、跨组件不同步；这里直接观察 DOM 这一事实来源，
 * 主题切换（class 变化）会即刻反映到所有订阅组件。
 */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )

  useEffect(() => {
    const root = document.documentElement
    const update = () => setDark(root.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}
