import { useMemo } from 'react'
import type { CardComponentProps } from '../registry'

// 统计卡（KPI 数值组，1-6 项）：大数字用正文比例字（hero 数字不强制等宽对齐），
// delta 变化量走图标+文本双通道（箭头 + 标签），不单靠颜色传意。

interface StatItem {
  label: string
  value: string
  unit?: string
  delta?: number
  deltaLabel?: string
}

function parseProps(raw: Record<string, unknown>): StatItem[] {
  if (!Array.isArray(raw.items) || raw.items.length === 0) throw new Error('stat.items 缺失')
  return raw.items.map((it) => {
    const o = it as Record<string, unknown>
    if (!o || typeof o !== 'object' || typeof o.label !== 'string' || typeof o.value !== 'string') {
      throw new Error('stat.items 条目无效')
    }
    return {
      label: o.label,
      value: o.value,
      unit: typeof o.unit === 'string' && o.unit ? o.unit : undefined,
      delta: typeof o.delta === 'number' && Number.isFinite(o.delta) ? o.delta : undefined,
      deltaLabel: typeof o.deltaLabel === 'string' && o.deltaLabel ? o.deltaLabel : undefined,
    }
  })
}

export function StatCard({ props }: CardComponentProps) {
  const items = useMemo(() => parseProps(props), [props])

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item, i) => (
        <div key={i} className="min-w-0 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
          <div className="truncate text-xs text-muted-foreground">{item.label}</div>
          <div className="mt-1 truncate text-xl font-semibold leading-none tracking-tight">
            {item.value}
            {item.unit && <span className="ml-0.5 text-sm font-medium text-muted-foreground">{item.unit}</span>}
          </div>
          {item.delta !== undefined && (
            <div
              className={`mt-1.5 text-xs ${
                item.delta >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-destructive'
              }`}
            >
              <span aria-hidden>{item.delta >= 0 ? '▲' : '▼'}</span>{' '}
              {Math.abs(item.delta)}
              {item.deltaLabel && (
                <span className="ml-1 text-muted-foreground">{item.deltaLabel}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
