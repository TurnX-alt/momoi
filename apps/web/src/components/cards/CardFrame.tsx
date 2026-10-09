import type { ReactNode } from 'react'

/**
 * 卡片统一外壳：圆角边框卡 + 可选标题。
 * 样式与消息气泡同族（bg-card/60 backdrop-blur-sm border），宽度止于 2xl——
 * 卡片比文本气泡更宽，但不占满整个消息列。
 */
export function CardFrame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="my-2 w-full max-w-2xl rounded-lg border bg-card/60 backdrop-blur-sm text-card-foreground">
      {title && (
        <div className="px-4 pt-3 text-sm font-semibold leading-tight truncate">{title}</div>
      )}
      <div className={title ? 'p-4 pt-3' : 'p-4'}>{children}</div>
    </div>
  )
}
