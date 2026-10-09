// ============================================================
// history-cards — 回喂前卡片摘要注入单测
// ============================================================

import { describe, it, expect } from 'vitest'
import { augmentRowsWithCards } from '../src/ai/history-cards.js'

const cardTrace = JSON.stringify([
  { type: 'thinking', text: '……' },
  { type: 'tool_call', id: 'call_1', name: 'ui_chart', input: {}, status: 'done' },
  { type: 'card', id: 'call_1', card: { component: 'chart', title: '销售额趋势', props: {} } },
])

describe('augmentRowsWithCards', () => {
  it('含卡 assistant 行：content 尾部追加摘要行', () => {
    const rows = [{ role: 'assistant', content: '看这张图', trace: cardTrace }]
    const out = augmentRowsWithCards(rows)
    expect(out[0].content).toBe('看这张图\n\n[已渲染卡片：chart「销售额趋势」 id:call_1]')
  })

  it('无 title 省略「」，无 id 省略 id 段', () => {
    const trace = JSON.stringify([{ type: 'card', card: { component: 'diagram', props: {} } }])
    const out = augmentRowsWithCards([{ role: 'assistant', content: '图', trace }])
    expect(out[0].content).toBe('图\n\n[已渲染卡片：diagram]')
  })

  it('一消息多卡：逐行追加', () => {
    const trace = JSON.stringify([
      { type: 'card', id: 'c1', card: { component: 'chart', title: 'A', props: {} } },
      { type: 'card', id: 'c2', card: { component: 'table', title: 'B', props: {} } },
    ])
    const out = augmentRowsWithCards([{ role: 'assistant', content: 'x', trace }])
    expect(out[0].content).toBe('x\n\n[已渲染卡片：chart「A」 id:c1]\n[已渲染卡片：table「B」 id:c2]')
  })

  it('标题超 40 字符截断', () => {
    const long = '长'.repeat(50)
    const trace = JSON.stringify([{ type: 'card', id: 'c1', card: { component: 'chart', title: long, props: {} } }])
    const out = augmentRowsWithCards([{ role: 'assistant', content: 'x', trace }])
    expect(out[0].content).toContain(`「${'长'.repeat(40)}」`)
    expect(out[0].content).not.toContain('长'.repeat(41))
  })

  it('user 行不注入（即使带 trace）', () => {
    const rows = [{ role: 'user', content: '问题', trace: cardTrace }]
    const out = augmentRowsWithCards(rows)
    expect(out[0].content).toBe('问题')
  })

  it('无 trace / 坏 JSON / 非数组 / 无卡片条目 → 原样返回（引用不变）', () => {
    const plain = { role: 'assistant', content: 'a', trace: null as string | null }
    const broken = { role: 'assistant', content: 'b', trace: '{bad' }
    const objTrace = { role: 'assistant', content: 'c', trace: JSON.stringify({ type: 'card' }) }
    const noCard = { role: 'assistant', content: 'd', trace: JSON.stringify([{ type: 'text', text: 'x' }]) }
    const out = augmentRowsWithCards([plain, broken, objTrace, noCard])
    expect(out[0]).toBe(plain)
    expect(out[1]).toBe(broken)
    expect(out[2]).toBe(objTrace)
    expect(out[3]).toBe(noCard)
  })

  it('返回新数组且不改动原对象', () => {
    const row = { role: 'assistant', content: 'x', trace: cardTrace }
    const out = augmentRowsWithCards([row])
    expect(out).not.toBe([row])
    expect(out[0]).not.toBe(row)
    expect(row.content).toBe('x') // 原对象未被修改
  })
})
