// ============================================================
// update_state Tool — 世界模拟：更新成员状态值
// ============================================================
// 仅世界会话且已定义状态时由编排器经 createToolAdapter 动态注入（仿 at_mention）。
// 变更即时落库（lib/world-state.ts 的 applyChanges），成功时携带
// data.card（component='state'）——走既有 tool_execution_end 捕获链路渲染状态卡，
// 对应工具条目被卡片认领隐藏。与轮末中立结算共用同一落库与卡片实现。
//
// 值统一为显示字符串（绝对新值，如 "80" 而非 "-20"）；失败走 ToolResult.error
// 自修复通道（列出合法成员/属性），与 ui_* 工具的错误约定一致。

import type { ToolModule, ToolContext, ToolResult } from './types.js'
import {
  applyChanges,
  resolveMemberByName,
  MAX_STATE_VALUE_LEN,
  type WorldStateContext,
} from '../lib/world-state.js'

const MAX_CHANGES_PER_CALL = 4
const MAX_REASON_LEN = 60

export function createWorldStateTool(worldState: WorldStateContext): ToolModule {
  return {
    definition: {
      name: 'update_state',
      description:
        '更新世界模拟中成员的状态值（世界上所有成员共享同一份状态表）。' +
        `changes 为 1-${MAX_CHANGES_PER_CALL} 条变更：agent = 成员名（须与成员名完全一致）；attribute = 已定义的属性名；` +
        'value = 新值（字符串；**绝对新值**而非增减量——如 "80" 而不是 "-20"，数值也写成字符串）；' +
        'reason = 变化原因（可选，简短）。' +
        '何时使用：当剧情中确实发生了改变某人状态的事件（受伤、治愈、生病、休息、情绪冲击等）时——' +
        '你自己和他人的状态都可以更新；同一回合内的多处变化合并为一次调用；' +
        '新值与当前值相同会被忽略，没有实际变化就不要调用。' +
        '调用成功后会自动渲染一张状态卡；不要在回复文本里自行编写状态卡内容或任何卡片标注行。',
      input_schema: {
        type: 'object',
        properties: {
          changes: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_CHANGES_PER_CALL,
            description: `状态变更列表（1-${MAX_CHANGES_PER_CALL} 条）`,
            items: {
              type: 'object',
              required: ['agent', 'attribute', 'value'],
              properties: {
                agent: { type: 'string', description: '成员名（与成员名完全一致）' },
                attribute: { type: 'string', description: '属性名（世界已定义的状态属性）' },
                value: {
                  type: 'string',
                  maxLength: MAX_STATE_VALUE_LEN,
                  description: '新值（绝对新值；数字写成字符串，如 "80"）',
                },
                reason: { type: 'string', maxLength: MAX_REASON_LEN, description: '变化原因（可选，简短）' },
              },
            },
          },
        },
        required: ['changes'],
      },
    },
    execute: async (input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
      const raw = Array.isArray(input.changes) ? input.changes : []
      if (raw.length === 0) {
        return { summary: 'changes 至少 1 条。', error: true }
      }
      if (raw.length > MAX_CHANGES_PER_CALL) {
        return { summary: `changes 最多 ${MAX_CHANGES_PER_CALL} 条（当前 ${raw.length} 条）。`, error: true }
      }

      const attrNames = worldState.defs.map((d) => d.name)
      const memberNames = worldState.members.map((m) => m.name)
      const edits: Array<{ agentId: string; attribute: string; value: string; reason?: string }> = []

      for (let i = 0; i < raw.length; i++) {
        const item = (raw[i] && typeof raw[i] === 'object' ? raw[i] : null) as Record<string, unknown> | null
        if (!item) {
          return { summary: `changes[${i}] 必须是对象 {agent, attribute, value, reason?}。`, error: true }
        }
        const agentName = typeof item.agent === 'string' ? item.agent.trim() : ''
        const attribute = typeof item.attribute === 'string' ? item.attribute.trim() : ''
        if (!agentName || !attribute) {
          return { summary: `changes[${i}] 缺少 agent 或 attribute。`, error: true }
        }
        const member = resolveMemberByName(worldState.members, agentName)
        if (!member) {
          return { summary: `成员「${agentName}」不存在（当前成员：${memberNames.join('、')}）。`, error: true }
        }
        if (!attrNames.includes(attribute)) {
          return { summary: `属性「${attribute}」未定义（可用属性：${attrNames.join('、')}）。`, error: true }
        }
        const value =
          typeof item.value === 'string'
            ? item.value
            : typeof item.value === 'number' && Number.isFinite(item.value)
              ? String(item.value)
              : null
        if (value === null) {
          return { summary: `changes[${i}].value 必须是字符串或数字。`, error: true }
        }
        if (value.length > MAX_STATE_VALUE_LEN || /[|\r\n]/.test(value)) {
          return {
            summary: `「${attribute}」的新值不合法（≤${MAX_STATE_VALUE_LEN} 字符、单行、不含「|」）。`,
            error: true,
          }
        }
        const reason = typeof item.reason === 'string' ? item.reason.trim().slice(0, MAX_REASON_LEN) : ''
        edits.push({ agentId: member.id, attribute, value, reason: reason || undefined })
      }

      const { applied, card } = await applyChanges(worldState, edits, '状态变化')
      if (applied.length === 0) {
        return { summary: '这些值与当前值相同，未产生变化（无需调用）。', terminate: false }
      }
      const text = applied
        .map((c) => `${c.agentName} ${c.attribute}：${c.from} → ${c.to}${c.reason ? `（${c.reason}）` : ''}`)
        .join('；')
      return { summary: `状态已更新：${text}`, data: card ? { card } : undefined, terminate: false }
    },
  }
}
