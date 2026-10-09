// ============================================================
// World State — 世界模拟「Agent 状态」的落库与对账（唯一实现）
// ============================================================
// 存储：worlds 两个可空 JSON 列 —— states（定义）/ state_values（当前值）。
// 语义（见 docs/specs/module-world.md 与 DECISIONS.md D60）：
//   · 默认值仅用于初始化；读取时以「对账视图」呈现 —— 按当前成员过滤、缺属性补默认
//     （存储保留已移除成员的历史值，重新加回即恢复）
//   · 值统一为显示字符串（≤60 字符、单行、禁「|」——护轮末结算的行解析格式）
//   · 变更双轨全部走 applyChanges 落库：update_state 工具（即时）与轮末中立结算（复核）
//   · 变更以 component='state' 的引擎合成卡呈现（工具卡与结算卡共用同一形态）
//
// 解析必须宽容：列里可能是 NULL（旧库补列）、损坏 JSON 或手改数据——绝不抛出。
// ============================================================

import type {
  CardDescriptor,
  TraceEntry,
  WorldStateDef,
  WorldStateRuntime,
  WorldStateValues,
} from '@momoi/shared/types'
import { db, worlds, messages, groupConversationAgents, agents } from '../db/index.js'
import { eq } from 'drizzle-orm'

/** 约束（与 Web 编辑器一致；「|」与换行为结算解析的行格式护栏） */
export const MAX_STATE_ATTRS = 12
export const MAX_STATE_NAME_LEN = 20
export const MAX_STATE_VALUE_LEN = 60
export const MAX_STATE_DESC_LEN = 100
const PIPE_OR_NEWLINE = /[|\r\n]/

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string }

export interface WorldStateMember {
  id: string
  name: string
}

/** 一次已落库的状态变更（卡片素材） */
export interface WorldStateChange {
  agentId: string
  agentName: string
  attribute: string
  from: string
  to: string
  reason?: string
}

/** 世界运行态全量上下文（路由对账 / 工具句柄 / 轮末结算共用） */
export interface WorldStateContext {
  conversationId: string
  laws: string
  defs: WorldStateDef[]
  /** 存储原样（可能含已移除成员的历史值；读取视图会过滤，写回时保留） */
  stored: WorldStateValues
  members: WorldStateMember[]
  /** 对账视图：按当前成员过滤 + 缺属性补默认 */
  view: WorldStateValues
}

/** 宽松解析状态定义：损坏 JSON / 形状不符的条目过滤丢弃，绝不抛出 */
export function parseStateDefs(raw: string | null | undefined): WorldStateDef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: WorldStateDef[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const rec = item as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, MAX_STATE_NAME_LEN) : ''
      if (!name || PIPE_OR_NEWLINE.test(name) || seen.has(name)) continue
      const def = toDisplayString(rec.default)
      if (def === null || PIPE_OR_NEWLINE.test(def)) continue
      seen.add(name)
      const description =
        typeof rec.description === 'string'
          ? rec.description.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_STATE_DESC_LEN)
          : ''
      out.push({ name, default: def.slice(0, MAX_STATE_VALUE_LEN), ...(description ? { description } : {}) })
      if (out.length >= MAX_STATE_ATTRS) break
    }
    return out
  } catch {
    return []
  }
}

/** 宽松解析当前值：非字符串条目丢弃（数字转字符串），绝不抛出 */
export function parseStateValues(raw: string | null | undefined): WorldStateValues {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: WorldStateValues = {}
    for (const [agentId, attrs] of Object.entries(parsed as Record<string, unknown>)) {
      if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) continue
      const row: Record<string, string> = {}
      for (const [name, v] of Object.entries(attrs as Record<string, unknown>)) {
        const s = toDisplayString(v)
        if (s !== null) row[name] = s
      }
      out[agentId] = row
    }
    return out
  } catch {
    return {}
  }
}

/** DB 行 → 运行态（不含成员对账：由 loadWorldState / 编排器快照完成） */
export function parseWorldRuntime(row: { laws: string; states: string | null; state_values: string | null }): WorldStateRuntime {
  return {
    laws: row.laws,
    states: parseStateDefs(row.states),
    state_values: parseStateValues(row.state_values),
  }
}

/** 对账视图：按当前成员过滤 + 缺属性补默认（纯函数，四条读路径共用） */
export function reconcileView(defs: WorldStateDef[], stored: WorldStateValues, memberIds: string[]): WorldStateValues {
  const view: WorldStateValues = {}
  for (const id of memberIds) {
    const own = stored[id] ?? {}
    const row: Record<string, string> = {}
    for (const def of defs) row[def.name] = own[def.name] ?? def.default
    view[id] = row
  }
  return view
}

/** 持久化对账（编辑定义时写回）：当前成员按新定义重建行；非成员历史值保留 */
export function reconcileStored(defs: WorldStateDef[], stored: WorldStateValues, memberIds: string[]): WorldStateValues {
  const next: WorldStateValues = { ...stored }
  for (const id of memberIds) {
    const row: Record<string, string> = {}
    for (const def of defs) row[def.name] = stored[id]?.[def.name] ?? def.default
    next[id] = row
  }
  return next
}

/** 一次性加载世界运行态（worlds 行 + 成员 + 对账视图）；世界行不存在时返回 null */
export async function loadWorldState(convId: string): Promise<WorldStateContext | null> {
  const row = await db.select({ laws: worlds.laws, states: worlds.states, state_values: worlds.state_values })
    .from(worlds).where(eq(worlds.conversation_id, convId)).get()
  if (!row) return null
  const memberRows = await db.select({ id: groupConversationAgents.agent_id, name: agents.name })
    .from(groupConversationAgents)
    .innerJoin(agents, eq(groupConversationAgents.agent_id, agents.id))
    .where(eq(groupConversationAgents.conversation_id, convId))
    .orderBy(groupConversationAgents.sort_order)
    .all()
  const defs = parseStateDefs(row.states)
  const stored = parseStateValues(row.state_values)
  const members: WorldStateMember[] = memberRows.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }))
  return {
    conversationId: convId,
    laws: row.laws,
    defs,
    stored,
    members,
    view: reconcileView(defs, stored, members.map((m) => m.id)),
  }
}

/** 成员名解析（大小写不敏感精确匹配；update_state 工具与轮末结算共用） */
export function resolveMemberByName(members: WorldStateMember[], name: string): WorldStateMember | null {
  const target = name.trim().toLowerCase()
  if (!target) return null
  return members.find((m) => m.name.trim().toLowerCase() === target) ?? null
}

/** 状态定义校验（创建 / 编辑世界）。reason 面向编辑器与 API 调用方。 */
export function validateStates(input: unknown): ValidationResult<WorldStateDef[]> {
  if (!Array.isArray(input)) return { ok: false, reason: 'states 必须是数组' }
  if (input.length > MAX_STATE_ATTRS) {
    return { ok: false, reason: `最多 ${MAX_STATE_ATTRS} 个属性（当前 ${input.length} 个）` }
  }
  const defs: WorldStateDef[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: '每个属性必须是对象 {name, default, description}' }
    }
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (!name) return { ok: false, reason: '属性名不能为空' }
    if (name.length > MAX_STATE_NAME_LEN) {
      return { ok: false, reason: `属性名过长（「${name}」超过 ${MAX_STATE_NAME_LEN} 字）` }
    }
    if (PIPE_OR_NEWLINE.test(name)) return { ok: false, reason: `属性名不能包含「|」或换行：「${name}」` }
    if (seen.has(name)) return { ok: false, reason: `属性名重复：「${name}」` }
    const def = toDisplayString(rec.default)
    if (def === null) return { ok: false, reason: `属性「${name}」缺少默认值（字符串或数字）` }
    if (def.length > MAX_STATE_VALUE_LEN) {
      return { ok: false, reason: `属性「${name}」默认值过长（超过 ${MAX_STATE_VALUE_LEN} 字符）` }
    }
    if (PIPE_OR_NEWLINE.test(def)) return { ok: false, reason: `属性「${name}」默认值不能包含「|」或换行` }
    let description: string | undefined
    if (rec.description !== undefined && rec.description !== null && rec.description !== '') {
      if (typeof rec.description !== 'string') {
        return { ok: false, reason: `属性「${name}」的 description 必须是字符串` }
      }
      const desc = rec.description.trim()
      if (desc.length > MAX_STATE_DESC_LEN) {
        return { ok: false, reason: `属性「${name}」描述过长（超过 ${MAX_STATE_DESC_LEN} 字）` }
      }
      if (/[\r\n]/.test(desc)) return { ok: false, reason: `属性「${name}」描述不能包含换行` }
      description = desc || undefined
    }
    seen.add(name)
    defs.push({ name, default: def, ...(description ? { description } : {}) })
  }
  return { ok: true, value: defs }
}

/** 手动修正值校验（PATCH values）：{agentId: {属性名: 值}} 部分合并 */
export function validateValueEdit(
  input: unknown,
  defs: WorldStateDef[],
  memberIds: string[],
): ValidationResult<WorldStateValues> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'values 必须是对象 {agentId: {属性名: 值}}' }
  }
  const defNames = new Set(defs.map((d) => d.name))
  const memberSet = new Set(memberIds)
  const out: WorldStateValues = {}
  for (const [agentId, attrs] of Object.entries(input as Record<string, unknown>)) {
    if (!memberSet.has(agentId)) return { ok: false, reason: `成员不在当前世界中：${agentId}` }
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
      return { ok: false, reason: '每个成员的值必须是 {属性名: 值} 对象' }
    }
    const row: Record<string, string> = {}
    for (const [name, v] of Object.entries(attrs as Record<string, unknown>)) {
      if (!defNames.has(name)) return { ok: false, reason: `属性未定义：${name}` }
      const s = toDisplayString(v)
      if (s === null) return { ok: false, reason: `属性「${name}」的值必须是字符串或数字` }
      if (s.length > MAX_STATE_VALUE_LEN) {
        return { ok: false, reason: `属性「${name}」的值过长（超过 ${MAX_STATE_VALUE_LEN} 字符）` }
      }
      if (PIPE_OR_NEWLINE.test(s)) return { ok: false, reason: `属性「${name}」的值不能包含「|」或换行` }
      row[name] = s
    }
    out[agentId] = row
  }
  return { ok: true, value: out }
}

/**
 * 应用变更（update_state 工具与轮末结算共用）：逐条绝对新值，no-op 静默跳过，
 * 落库后返回已应用变更与变更卡。调用方负责成员/属性解析；本函数仍做防御性过滤。
 */
export async function applyChanges(
  ctx: WorldStateContext,
  edits: Array<{ agentId: string; attribute: string; value: string; reason?: string }>,
  cardTitle: string,
): Promise<{ applied: WorldStateChange[]; card?: CardDescriptor }> {
  const defNames = new Set(ctx.defs.map((d) => d.name))
  const memberNameById = new Map(ctx.members.map((m) => [m.id, m.name]))
  const pending = new Map<string, { agentId: string; attribute: string; value: string; reason?: string }>()
  for (const edit of edits) {
    if (!memberNameById.has(edit.agentId) || !defNames.has(edit.attribute)) continue
    if (typeof edit.value !== 'string' || edit.value.length > MAX_STATE_VALUE_LEN || PIPE_OR_NEWLINE.test(edit.value)) continue
    pending.set(`${edit.agentId}\u0000${edit.attribute}`, edit)
  }

  const applied: WorldStateChange[] = []
  for (const edit of pending.values()) {
    const current = ctx.view[edit.agentId]?.[edit.attribute]
      ?? ctx.defs.find((d) => d.name === edit.attribute)?.default ?? ''
    if (current === edit.value) continue // no-op：静默
    applied.push({
      agentId: edit.agentId,
      agentName: memberNameById.get(edit.agentId)!,
      attribute: edit.attribute,
      from: current,
      to: edit.value,
      ...(edit.reason ? { reason: edit.reason } : {}),
    })
  }
  if (applied.length === 0) return { applied }

  // 存储 ∪ 变更（保留已移除成员历史值；不做全量对账写回）
  const next: WorldStateValues = { ...ctx.stored }
  for (const ch of applied) {
    next[ch.agentId] = { ...(next[ch.agentId] ?? {}), [ch.attribute]: ch.to }
  }
  await db.update(worlds)
    .set({ state_values: JSON.stringify(next), updated_at: Math.floor(Date.now() / 1000) })
    .where(eq(worlds.conversation_id, ctx.conversationId))
    .run()

  // 就地刷新共享上下文：同一 Agent 循环内的连续调用、或调用方后续读取，
  // 都会看到最新值（from 取值与写回基准不落旧快照）
  ctx.stored = next
  for (const ch of applied) {
    if (ctx.view[ch.agentId]) ctx.view[ch.agentId][ch.attribute] = ch.to
  }
  return { applied, card: buildStateChangeCard(applied, cardTitle) }
}

/** 变更卡（component='state'）：工具结果与轮末结算共用的描述符形态 */
export function buildStateChangeCard(changes: WorldStateChange[], title: string): CardDescriptor {
  return {
    component: 'state',
    title,
    props: {
      changes: changes.map((c) => ({
        agent: c.agentName,
        attribute: c.attribute,
        from: c.from,
        to: c.to,
        ...(c.reason ? { reason: c.reason } : {}),
      })),
    },
  }
}

/** 向消息 trace 追加一张卡片条目（轮末结算卡的持久化；调用方「先落库再发事件」） */
export async function appendTraceCard(messageId: number, card: CardDescriptor): Promise<void> {
  const row = await db.select({ trace: messages.trace }).from(messages).where(eq(messages.id, messageId)).get()
  let trace: TraceEntry[] = []
  if (row?.trace) {
    try {
      const parsed = JSON.parse(row.trace)
      if (Array.isArray(parsed)) trace = parsed
    } catch {
      // 损坏 trace 从空重建（与读取端容错一致）
    }
  }
  trace.push({ type: 'card', card })
  await db.update(messages).set({ trace: JSON.stringify(trace) }).where(eq(messages.id, messageId)).run()
}

/** string | number → 显示字符串；其他类型返回 null */
function toDisplayString(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}
