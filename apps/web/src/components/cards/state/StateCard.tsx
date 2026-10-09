import { useMemo } from 'react'
import type { CardComponentProps } from '../registry'

// 状态卡（component='state'）：世界模拟的状态变更列表——由 update_state 工具与
// 轮末结算（引擎合成）产生，只读、不接 card-action。
// 方向箭头仅当新旧值均可解析为数字时展示，且颜色保持中性——属性语义因名字而异，
// 「升绿降红」会误读（如体温上升并不"好"），箭头 + 数值本身承担信息。

interface StateChange {
  agent: string
  attribute: string
  from: string
  to: string
  reason?: string
}

function parseProps(raw: Record<string, unknown>): StateChange[] {
  if (!Array.isArray(raw.changes) || raw.changes.length === 0) throw new Error('state.changes 缺失')
  return raw.changes.map((it) => {
    const o = it as Record<string, unknown>
    if (
      !o ||
      typeof o !== 'object' ||
      typeof o.agent !== 'string' ||
      typeof o.attribute !== 'string' ||
      typeof o.from !== 'string' ||
      typeof o.to !== 'string'
    ) {
      throw new Error('state.changes 条目无效')
    }
    return {
      agent: o.agent,
      attribute: o.attribute,
      from: o.from,
      to: o.to,
      reason: typeof o.reason === 'string' && o.reason ? o.reason : undefined,
    }
  })
}

/** 数值方向：▲ 上升 / ▼ 下降 / → 非数值或持平 */
function direction(from: string, to: string): '▲' | '▼' | '→' {
  const f = Number(from)
  const t = Number(to)
  if (from.trim() === '' || to.trim() === '' || !Number.isFinite(f) || !Number.isFinite(t) || f === t) return '→'
  return t > f ? '▲' : '▼'
}

export function StateCard({ props }: CardComponentProps) {
  const changes = useMemo(() => parseProps(props), [props])

  return (
    <ul className="space-y-1.5">
      {changes.map((c, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm leading-snug">
          <span className="font-medium">{c.agent}</span>
          <span className="text-xs text-muted-foreground">{c.attribute}</span>
          <span className="tabular-nums">
            <span className="text-muted-foreground">{c.from}</span>
            <span className="mx-1 text-muted-foreground" aria-hidden>
              {direction(c.from, c.to)}
            </span>
            <span className="font-medium">{c.to}</span>
          </span>
          {c.reason && <span className="text-xs text-muted-foreground">（{c.reason}）</span>}
        </li>
      ))}
    </ul>
  )
}
