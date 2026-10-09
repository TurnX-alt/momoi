import { CARD_ACTION_FENCE } from '@momoi/shared/constants'
import type { CardActionPayload } from '@momoi/shared/types'

// ============================================================
// card-action 协议编解码（shared 常量与类型的应用层封装）
// ============================================================
// 交互事件以「普通用户消息」回流：一行人类可读摘要 + ```card-action 围栏
// JSON——模型回喂天然可见、多设备中继免费、零迁移（D54 决策 5）。

/** 组装协议消息文本：摘要行 + 围栏 JSON */
export function composeCardActionMessage(summary: string, payload: CardActionPayload): string {
  return `${summary}\n\n${CARD_ACTION_FENCE}\n${JSON.stringify(payload)}\n\`\`\``
}

/** 匹配 card-action 围栏段（MessageContent 切分用；与 CARD_ACTION_FENCE 同源） */
const fenceEscaped = CARD_ACTION_FENCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const CARD_ACTION_SPLIT_RE = new RegExp(`(${fenceEscaped}[\\s\\S]*?\`\`\`)`, 'g')

/** 从文本中解析 card-action 围栏；无围栏/解析失败/结构不符一律返回 null */
export function parseCardActionFence(text: string): CardActionPayload | null {
  const m = text.match(/```card-action\s*\n([\s\S]*?)\n?```/)
  if (!m) return null
  try {
    const p = JSON.parse(m[1]) as Partial<CardActionPayload>
    if (
      p &&
      p.v === 1 &&
      typeof p.card_id === 'string' &&
      typeof p.component === 'string' &&
      typeof p.action === 'string'
    ) {
      return p as CardActionPayload
    }
  } catch {
    // 解析失败视同无围栏，调用方回退原始文本渲染
  }
  return null
}
