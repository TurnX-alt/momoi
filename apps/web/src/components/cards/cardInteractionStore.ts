import { useSyncExternalStore } from 'react'
import type { CardComponent } from '@momoi/shared/types'

// ============================================================
// 卡片交互分发与消费状态（模块级存储）
// ============================================================
// 为什么是模块级：MessageList 的气泡 key 会随落库变化重挂载（db-id ↔ idx），
// 「已消费」状态放组件内会丢；消息流内也没有现成 Context 通道可穿透
// trace 渲染层。故用模块级 handler 注册（useGroupChat 拥有单聊/群聊/世界
// 的发送路由，挂载时注册），FormCard 等交互卡片经 emit 调用。

export interface CardActionEvent {
  cardId: string
  component: CardComponent
  action: string
  label?: string
  payload?: Record<string, unknown>
  /** 卡片标题（摘要行用） */
  cardTitle?: string
  /** 群聊：卡片所属 Agent 名（合成消息 @ 前缀，置首发言） */
  ownerAgentName?: string
  /** 本地计算模式：卡片内算出的结果（随「发送给 AI」带回模型） */
  result?: number
}

/** 返回 false = 未被受理（如正在生成 / handler 未挂载），调用方不应标记已消费 */
type CardActionHandler = (ev: CardActionEvent) => boolean

let handler: CardActionHandler | null = null

export function setCardActionHandler(fn: CardActionHandler | null): void {
  handler = fn
}

export function emitCardAction(ev: CardActionEvent): boolean {
  return handler ? handler(ev) : false
}

// ---- 已消费卡片（提交后禁用控件，防重复提交） ----

const consumed = new Set<string>()
const listeners = new Set<() => void>()

export function markCardConsumed(cardId: string): void {
  if (consumed.has(cardId)) return
  consumed.add(cardId)
  for (const l of listeners) l()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 订阅某卡片的已消费状态（跨气泡重挂载存活） */
export function useCardConsumed(cardId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (cardId ? consumed.has(cardId) : false),
    () => false,
  )
}
