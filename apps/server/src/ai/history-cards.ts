// ============================================================
// History Cards — 回喂前的卡片感知注入（不动存储）
// ============================================================
// 背景：saveAssistantMsg 不写 tool_calls 列——模型连历史工具调用都不可见。
// 卡片是用户看得见的 UI 产物：不知道历史卡片，「把刚才的柱状图改成折线」
// 类请求无法完成。此处在**构建历史时**对含卡 assistant 行的 content 尾部
// 追加摘要行（标题截 40 字符）：
//   [已渲染卡片：chart「销售额趋势」 id:call_xxx]
// 交互事件（card-action 围栏）在 user 消息 content 内原样回喂，天然可见，
// 此处无需处理。
//
// 输入输出都是 DB 行形状（仅依赖 role/content/trace 三个字段）——纯函数，
// 无 IO，单测直接构造行对象；routes/chat.ts 的初始 history 构建与
// reloadHistory 共用；IM 渠道（M3）接入时同样套用。

/** 与 messages 表对齐的最小行形状 */
export interface HistoryCardRow {
  role: string
  content: string
  trace?: string | null
}

const TITLE_MAX = 40

/** 解析一行 trace JSON，提取卡片摘要行（非数组/损坏 JSON 一律视为无卡片） */
function cardSummaryLines(traceJson: string | null | undefined): string[] {
  if (!traceJson) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(traceJson)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const lines: string[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { type?: unknown; card?: { component?: unknown; title?: unknown }; id?: unknown }
    if (e.type !== 'card' || !e.card || typeof e.card.component !== 'string') continue
    const title =
      typeof e.card.title === 'string' && e.card.title.trim()
        ? `「${e.card.title.trim().slice(0, TITLE_MAX)}」`
        : ''
    const id = typeof e.id === 'string' && e.id ? ` id:${e.id}` : ''
    lines.push(`[已渲染卡片：${e.card.component}${title}${id}]`)
  }
  return lines
}

/** 对历史行做卡片摘要注入（返回新数组；无卡片的行原样保留引用） */
export function augmentRowsWithCards<T extends HistoryCardRow>(rows: T[]): T[] {
  return rows.map((row) => {
    if (row.role !== 'assistant') return row
    const lines = cardSummaryLines(row.trace)
    if (lines.length === 0) return row
    return { ...row, content: `${row.content}\n\n${lines.join('\n')}` }
  })
}
