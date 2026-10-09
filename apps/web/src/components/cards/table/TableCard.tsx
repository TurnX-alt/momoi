import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CardComponentProps } from '../registry'

// 表格卡：服务端已校验行列数一致（≤12 列 × 200 行）。
// 数字列自动右对齐 + 等宽数字（列内纵向对齐场景）；表头吸顶。

interface TableData {
  columns: string[]
  rows: string[][]
  dense: boolean
}

function parseProps(raw: Record<string, unknown>): TableData {
  if (!Array.isArray(raw.columns) || raw.columns.length === 0) throw new Error('table.columns 缺失')
  if (!Array.isArray(raw.rows)) throw new Error('table.rows 缺失')
  return {
    columns: raw.columns as string[],
    rows: raw.rows as string[][],
    dense: raw.dense === true,
  }
}

/** 数字形态的单元格（含千分位/百分号）→ 右对齐 + tabular-nums */
const NUMERIC_RE = /^-?[\d,]+(\.\d+)?%?$/
function isNumeric(cell: string): boolean {
  return NUMERIC_RE.test(cell.trim())
}

export function TableCard({ props }: CardComponentProps) {
  const { t } = useTranslation()
  const data = useMemo(() => parseProps(props), [props])
  const cellPad = data.dense ? 'px-3 py-1' : 'px-3 py-1.5'

  return (
    <div className="max-h-96 overflow-auto rounded-md border border-border/60">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-card backdrop-blur-sm">
          <tr>
            {data.columns.map((col, i) => (
              <th
                key={i}
                className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td colSpan={data.columns.length} className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t('chat.cardTableEmpty')}
              </td>
            </tr>
          ) : (
            data.rows.map((row, ri) => (
              <tr key={ri} className="border-t border-border/40 first:border-t-0">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`${cellPad} ${isNumeric(cell) ? 'text-right tabular-nums' : 'text-left'}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
