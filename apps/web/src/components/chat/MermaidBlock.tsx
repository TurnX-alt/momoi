import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Mermaid 渲染块（从 MessageContent 提取共享）：
 * - markdown 围栏路径：MessageContent 切出 ```mermaid 块后渲染（framed 默认样式）
 * - 卡片路径：DiagramCard 以 bare 模式嵌入 CardFrame（无自身边框/内边距）
 */
export function MermaidBlock({ chart, bare }: { chart: string; bare?: boolean }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    import('mermaid').then(async (m) => {
      if (cancelled) return
      try {
        m.default.initialize({ startOnLoad: false, theme: 'default' })
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`
        const { svg: rendered } = await m.default.render(id, chart)
        if (!cancelled) setSvg(rendered)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('chat.renderFailed'))
      }
    })

    return () => { cancelled = true }
  }, [chart, t])

  if (error) {
    return (
      <pre className="text-xs text-destructive bg-muted p-2 rounded overflow-x-auto">
        {chart}
      </pre>
    )
  }

  return (
    <div
      className={bare ? 'overflow-x-auto [&_svg]:mx-auto' : 'mermaid-container'}
      ref={ref}
      dangerouslySetInnerHTML={{ __html: svg || t('common.loading') }}
    />
  )
}
