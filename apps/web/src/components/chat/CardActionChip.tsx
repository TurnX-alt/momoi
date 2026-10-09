import { Zap } from 'lucide-react'
import type { CardActionPayload } from '@momoi/shared/types'

/**
 * user 气泡内的卡片交互标记：MessageContent 把 ```card-action 围栏切出后
 * 由本组件渲染为紧凑 chip（不显示原始 JSON）。摘要值取 payload 前 3 项的
 * key=value，数组以「、」连接，单项截断 24 字符。
 */
export function CardActionChip({ payload }: { payload: CardActionPayload }) {
  const summary = payload.payload ? summarize(payload.payload) : ''
  return (
    <span className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-black/10 bg-black/10 px-2.5 py-1 text-xs dark:border-white/15 dark:bg-white/15">
      <Zap className="h-3 w-3 flex-shrink-0" />
      <span className="font-medium">{payload.label ?? payload.action}</span>
      {payload.result != null && <span className="font-mono text-xs opacity-90">= {payload.result}</span>}
      {summary && <span className="truncate opacity-80">{summary}</span>}
    </span>
  )
}

function summarize(payload: Record<string, unknown>): string {
  const parts: string[] = []
  let total = 0
  for (const [k, v] of Object.entries(payload)) {
    total++
    if (parts.length >= 3) continue
    if (v == null) continue
    let s: string
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      s = v.map(String).join('、')
    } else if (typeof v === 'object') {
      continue
    } else {
      s = String(v)
    }
    if (!s) continue
    if (s.length > 24) s = `${s.slice(0, 24)}…`
    parts.push(`${k}=${s}`)
  }
  if (parts.length === 0) return ''
  return parts.join('  ') + (total > parts.length ? ' …' : '')
}
