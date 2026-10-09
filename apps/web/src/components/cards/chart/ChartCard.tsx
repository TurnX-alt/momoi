import { useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useDarkMode } from '../../../hooks/useDarkMode'
import { CHART_LIGHT, CHART_DARK, colorAt } from './palette'
import type { CardComponentProps } from '../registry'

// 折线 / 柱状 / 饼图。dataviz 规范内置：
// - 颜色按固定顺序分配（模型不可指定颜色）；services 限制 series ≤8、饼图 ≤5
// - 2px 线宽、4px 圆角柱端、堆叠段间 2px 表面缝、≤8px 以下不画点
// - ≥2 序列必有图例，图例文字用墨色（色块承担身份）；饼图直接标注（relief）
// - tooltip 常开；无双轴（schema 无从表达）

interface ChartSeries { name: string; data: number[]; stack?: string }

interface ChartData {
  type: 'line' | 'bar' | 'pie'
  series: ChartSeries[]
  labels?: string[]
  unit?: string
  stacked: boolean
  horizontal: boolean
}

function parseProps(raw: Record<string, unknown>): ChartData {
  const type = raw.type
  if (type !== 'line' && type !== 'bar' && type !== 'pie') throw new Error('chart.type 无效')
  if (!Array.isArray(raw.series) || raw.series.length === 0) throw new Error('chart.series 缺失')
  const series: ChartSeries[] = raw.series.map((s) => {
    const o = s as Record<string, unknown>
    if (
      !o || typeof o !== 'object' ||
      typeof o.name !== 'string' ||
      !Array.isArray(o.data) || o.data.length === 0 ||
      !o.data.every((n) => typeof n === 'number')
    ) {
      throw new Error('chart.series 条目无效')
    }
    return { name: o.name, data: o.data as number[], stack: typeof o.stack === 'string' ? o.stack : undefined }
  })
  const labels = Array.isArray(raw.labels) && raw.labels.every((l) => typeof l === 'string')
    ? (raw.labels as string[])
    : undefined
  return {
    type,
    series,
    labels,
    unit: typeof raw.unit === 'string' && raw.unit ? raw.unit : undefined,
    stacked: raw.stacked === true,
    horizontal: raw.horizontal === true,
  }
}

export function ChartCard({ props }: CardComponentProps) {
  const dark = useDarkMode()
  const data = useMemo(() => parseProps(props), [props])
  const colors = dark ? CHART_DARK : CHART_LIGHT
  const surface = dark ? '#09090b' : '#ffffff'
  const tickColor = dark ? '#a1a1aa' : '#71717a'

  // 折线/柱状：类目行；饼图：扇区行
  const rows = useMemo(() => {
    if (data.type === 'pie') return []
    const n = data.series[0].data.length
    return Array.from({ length: n }, (_, i) => {
      const row: Record<string, string | number> = { __label: data.labels?.[i] ?? String(i + 1) }
      for (const s of data.series) row[s.name] = s.data[i] ?? 0
      return row
    })
  }, [data])

  const pieRows = useMemo(() => {
    if (data.type !== 'pie' || !data.labels) return []
    return data.labels.map((l, i) => ({ name: l, value: data.series[0].data[i] ?? 0 }))
  }, [data])

  const tooltip = (
    <Tooltip
      contentStyle={{
        background: 'hsl(var(--popover))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8,
        fontSize: 12,
        color: 'hsl(var(--popover-foreground))',
      }}
      labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 11 }}
      itemStyle={{ fontSize: 12 }}
      cursor={
        data.type === 'line'
          ? { stroke: 'rgba(128,128,128,0.4)', strokeWidth: 1 }
          : { fill: 'rgba(128,128,128,0.12)' }
      }
      formatter={(value, name) => [`${String(value)}${data.unit ?? ''}`, String(name)]}
    />
  )

  const legendWidth = 12
  const showLegend = data.type === 'pie' ? pieRows.length > 1 : data.series.length > 1
  const legend = showLegend ? (
    <Legend
      wrapperStyle={{ fontSize: legendWidth }}
      iconType="circle"
      iconSize={8}
      formatter={(value) => <span className="text-xs text-muted-foreground">{String(value)}</span>}
    />
  ) : null

  if (data.type === 'line') {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(128,128,128,0.18)" />
            <XAxis
              dataKey="__label"
              tickLine={false}
              axisLine={{ stroke: 'rgba(128,128,128,0.35)' }}
              tick={{ fontSize: 12, fill: tickColor }}
              interval="preserveStartEnd"
            />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: tickColor }} width={44} />
            {tooltip}
            {legend}
            {data.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={colorAt(colors, i)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (data.type === 'bar') {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart
            data={rows}
            layout={data.horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap="20%"
          >
            <CartesianGrid
              horizontal={!data.horizontal}
              vertical={data.horizontal}
              stroke="rgba(128,128,128,0.18)"
            />
            {data.horizontal ? (
              <>
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: tickColor }} />
                <YAxis
                  type="category"
                  dataKey="__label"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(128,128,128,0.35)' }}
                  tick={{ fontSize: 12, fill: tickColor }}
                  width={88}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="__label"
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(128,128,128,0.35)' }}
                  tick={{ fontSize: 12, fill: tickColor }}
                  interval="preserveStartEnd"
                />
                <YAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: tickColor }} width={44} />
              </>
            )}
            {tooltip}
            {legend}
            {data.series.map((s, i) => (
              <Bar
                key={s.name}
                dataKey={s.name}
                stackId={data.stacked ? (s.stack ?? '__stack') : undefined}
                fill={colorAt(colors, i)}
                maxBarSize={48}
                radius={data.stacked ? 0 : data.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                stroke={data.stacked ? surface : undefined}
                strokeWidth={data.stacked ? 2 : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // pie
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <PieChart>
          {tooltip}
          {legend}
          <Pie
            data={pieRows}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="78%"
            stroke={surface}
            strokeWidth={2}
            isAnimationActive={false}
            label={(p: { name?: string; percent?: number }) =>
              `${p.name ?? ''}${p.percent != null ? ` ${(p.percent * 100).toFixed(0)}%` : ''}`
            }
            labelLine={{ stroke: 'rgba(128,128,128,0.4)' }}
          >
            {pieRows.map((r, i) => (
              <Cell key={`${r.name}-${i}`} fill={colorAt(colors, i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
