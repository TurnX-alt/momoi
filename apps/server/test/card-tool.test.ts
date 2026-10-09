// ============================================================
// card-tool — ui_* 卡片工具工厂单测
// ============================================================
// 覆盖：合法参数产出卡片描述符（title 提取 / props 剥离）、通用 schema 校验
// 错误（含自修复提示格式）、组件特有语义校验（series 长度一致、饼图限制、
// 表格行列匹配、stacked 限柱状图）、未知字段与 enum 违规。
// ============================================================

import { describe, it, expect } from 'vitest'
import { cardTools } from '../src/tools/ui-cards/card-tool.js'
import type { CardDescriptor } from '@momoi/shared/types'
import type { ToolContext } from '../src/tools/types.js'

const ctx = {} as ToolContext

function tool(name: string) {
  const t = cardTools.find((x) => x.definition.name === name)
  if (!t) throw new Error(`missing tool: ${name}`)
  return t
}

function cardOf(data: unknown): CardDescriptor {
  return (data as { card: CardDescriptor }).card
}

describe('ui_chart', () => {
  const exec = (input: Record<string, unknown>) => tool('ui_chart').execute(input, ctx)

  it('合法参数：title 提取到描述符顶层，props 不含 title', async () => {
    const r = await exec({
      type: 'line',
      title: ' 销售额趋势 ',
      labels: ['1月', '2月'],
      series: [{ name: '线上', data: [10, 20] }, { name: '线下', data: [8, 12] }],
    })
    expect(r.error).toBeUndefined()
    const card = cardOf(r.data)
    expect(card.component).toBe('chart')
    expect(card.title).toBe('销售额趋势')
    expect((card.props as Record<string, unknown>).title).toBeUndefined()
    expect((card.props as Record<string, unknown>).type).toBe('line')
    expect(r.summary).toContain('已渲染卡片：图表「销售额趋势」')
  })

  it('缺少 series：通用校验错误带字段名', async () => {
    const r = await exec({ type: 'bar' })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('参数校验失败')
    expect(r.summary).toContain('series: 必填字段缺失')
    expect(r.summary).toContain('重新调用 ui_chart')
  })

  it('enum 违规：错误列出允许值', async () => {
    const r = await exec({ type: 'scatter', series: [{ name: 'A', data: [1] }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('只允许 "line" | "bar" | "pie"')
  })

  it('series 长度不一致被拒绝', async () => {
    const r = await exec({ type: 'line', series: [{ name: 'A', data: [1, 2] }, { name: 'B', data: [1] }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('长度必须一致')
  })

  it('labels 长度与 data 不一致被拒绝', async () => {
    const r = await exec({ type: 'line', labels: ['a'], series: [{ name: 'A', data: [1, 2] }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('labels 长度（1）必须与 series 的 data 长度（2）一致')
  })

  it('饼图：缺 labels / 多 series / 超 5 类分别被拒绝', async () => {
    expect((await exec({ type: 'pie', series: [{ name: 'A', data: [1, 2] }] })).summary).toContain(
      '饼图必须提供 labels',
    )
    expect(
      (await exec({ type: 'pie', labels: ['a', 'b'], series: [{ name: 'A', data: [1, 2] }, { name: 'B', data: [1, 2] }] }))
        .summary,
    ).toContain('饼图只允许 1 条 series')
    expect(
      (await exec({ type: 'pie', labels: ['a', 'b', 'c', 'd', 'e', 'f'], series: [{ name: 'A', data: [1, 2, 3, 4, 5, 6] }] }))
        .summary,
    ).toContain('最多 5 个扇区')
  })

  it('stacked / horizontal 仅限柱状图', async () => {
    expect((await exec({ type: 'line', stacked: true, series: [{ name: 'A', data: [1] }] })).summary).toContain(
      'stacked 仅用于柱状图',
    )
    expect((await exec({ type: 'line', horizontal: true, series: [{ name: 'A', data: [1] }] })).summary).toContain(
      'horizontal 仅用于柱状图',
    )
  })

  it('未知字段被拒绝并列出可用字段', async () => {
    const r = await exec({ type: 'bar', color: 'red', series: [{ name: 'A', data: [1] }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('color: 未知字段')
  })
})

describe('ui_stat', () => {
  const exec = (input: Record<string, unknown>) => tool('ui_stat').execute(input, ctx)

  it('合法：KPI 组产出描述符', async () => {
    const r = await exec({
      title: '本月经营',
      items: [
        { label: '营收', value: '128万', delta: 12.5, deltaLabel: '较上月' },
        { label: '客户数', value: '1,204' },
      ],
    })
    expect(r.error).toBeUndefined()
    const card = cardOf(r.data)
    expect(card.component).toBe('stat')
    expect((card.props as { items: unknown[] }).items).toHaveLength(2)
  })

  it('items 项缺 value：嵌套路径错误', async () => {
    const r = await exec({ items: [{ label: '营收' }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('items[0].value: 必填字段缺失')
  })

  it('超过 6 项被拒绝', async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ label: `l${i}`, value: '1' }))
    const r = await exec({ items })
    expect(r.summary).toContain('至多 6 项')
  })
})

describe('ui_table', () => {
  const exec = (input: Record<string, unknown>) => tool('ui_table').execute(input, ctx)

  it('合法：行列匹配产出描述符', async () => {
    const r = await exec({ columns: ['名称', '数量'], rows: [['苹果', '3'], ['梨', '5']] })
    expect(r.error).toBeUndefined()
    expect(cardOf(r.data).component).toBe('table')
  })

  it('行单元格数与列数不匹配被拒绝（指向具体行号）', async () => {
    const r = await exec({ columns: ['a', 'b'], rows: [['1', '2'], ['3']] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('第 2 行有 1 个单元格，但 columns 有 2 列')
  })
})

describe('ui_diagram', () => {
  const exec = (input: Record<string, unknown>) => tool('ui_diagram').execute(input, ctx)

  it('合法：mermaid 源码产出描述符', async () => {
    const r = await exec({ title: '登录流程', code: 'flowchart TD\n  A --> B' })
    expect(r.error).toBeUndefined()
    const card = cardOf(r.data)
    expect(card.component).toBe('diagram')
    expect((card.props as { code: string }).code).toContain('flowchart')
  })

  it('缺 code 被拒绝', async () => {
    const r = await exec({})
    expect(r.error).toBe(true)
    expect(r.summary).toContain('code: 必填字段缺失')
  })
})

describe('catalog 一致性', () => {
  it('工具名与组件名一一对应且唯一', () => {
    const names = cardTools.map((t) => t.definition.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of cardTools) {
      expect(t.definition.name.startsWith('ui_')).toBe(true)
      expect(t.definition.input_schema.type).toBe('object')
    }
  })

  it('工具描述包含职责句与规则（非空）', () => {
    for (const t of cardTools) {
      expect(t.definition.description.length).toBeGreaterThan(30)
    }
  })
})
