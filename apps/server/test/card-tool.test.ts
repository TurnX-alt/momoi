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

describe('ui_form', () => {
  const exec = (input: Record<string, unknown>) => tool('ui_form').execute(input, ctx)

  it('合法：多类型字段产出描述符', async () => {
    const r = await exec({
      title: '项目配置',
      description: '请填写以下参数',
      fields: [
        { type: 'text', name: 'project', label: '项目名', required: true, placeholder: '如 momoi' },
        { type: 'select', name: 'db', label: '数据库', options: [{ label: 'SQLite' }, { label: 'PostgreSQL', value: 'pg' }] },
        { type: 'slider', name: 'budget', label: '预算（万）', min: 0, max: 100, step: 5 },
        { type: 'multiselect', name: 'mods', label: '功能模块', options: [{ label: 'A' }, { label: 'B' }] },
      ],
      submitLabel: '创建',
    })
    expect(r.error).toBeUndefined()
    const card = cardOf(r.data)
    expect(card.component).toBe('form')
    expect(card.title).toBe('项目配置')
    expect((card.props as { fields: unknown[] }).fields).toHaveLength(4)
    expect(r.summary).toContain('已渲染卡片：表单「项目配置」')
  })

  it('select 缺 options 被拒绝', async () => {
    const r = await exec({ fields: [{ type: 'select', name: 's', label: 'S' }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('必须提供 options')
  })

  it('字段名重复被拒绝', async () => {
    const r = await exec({
      fields: [
        { type: 'text', name: 'a', label: 'A' },
        { type: 'text', name: 'a', label: 'B' },
      ],
    })
    expect(r.summary).toContain('"a" 重复')
  })

  it('slider 的 min 不小于 max 被拒绝', async () => {
    const r = await exec({ fields: [{ type: 'slider', name: 'x', label: 'X', min: 10, max: 5 }] })
    expect(r.summary).toContain('必须小于')
  })

  it('非 options 类型携带 options / 非 slider 携带 min 被拒绝', async () => {
    const r1 = await exec({
      fields: [{ type: 'text', name: 'a', label: 'A', options: [{ label: 'x' }, { label: 'y' }] }],
    })
    expect(r1.summary).toContain('不支持 options')
    const r2 = await exec({ fields: [{ type: 'text', name: 'a', label: 'A', min: 1 }] })
    expect(r2.summary).toContain('仅用于 slider')
  })

  it('name 非法标识符被通用 pattern 校验拦截', async () => {
    const r = await exec({ fields: [{ type: 'text', name: '1bad', label: 'A' }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('不匹配格式')
  })

  it('compute 本地计算：合法公式与数据表产出描述符', async () => {
    const r = await exec({
      title: '汇率换算',
      fields: [
        { type: 'number', name: 'amount', label: '金额' },
        { type: 'select', name: 'pair', label: '币种', options: [{ label: '美元→人民币', value: 'USD>CNY' }, { label: '欧元→人民币', value: 'EUR>CNY' }] },
      ],
      compute: {
        formula: 'ROUND(amount * LOOKUP(pair, rate), 2)',
        tables: [{ name: 'rate', entries: [{ key: 'USD>CNY', value: 7.21 }, { key: 'EUR>CNY', value: 7.85 }] }],
        resultUnit: '元',
      },
    })
    expect(r.error).toBeUndefined()
    const card = cardOf(r.data)
    expect(card.component).toBe('form')
    expect((card.props as { compute: { formula: string } }).compute.formula).toContain('LOOKUP')
  })

  it('compute.formula 语法错误被拒绝', async () => {
    const r = await exec({
      fields: [{ type: 'number', name: 'a', label: 'A' }],
      compute: { formula: 'a +' },
    })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('语法错误')
  })

  it('compute.formula 引用未知字段被拒绝（含可用字段清单）', async () => {
    const r = await exec({
      fields: [{ type: 'number', name: 'a', label: 'A' }],
      compute: { formula: 'a * b' },
    })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('不存在的字段：b')
    expect(r.summary).toContain('可用字段：a')
  })

  it('LOOKUP 引用未知表被拒绝', async () => {
    const r = await exec({
      fields: [{ type: 'select', name: 'k', label: 'K', options: [{ label: 'x' }, { label: 'y' }] }],
      compute: { formula: 'LOOKUP(k, nope)' },
    })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('不存在的表：nope')
  })

  it('compute.tables 表名重复被拒绝', async () => {
    const r = await exec({
      fields: [{ type: 'number', name: 'a', label: 'A' }],
      compute: {
        formula: 'a',
        tables: [
          { name: 't', entries: [{ key: 'x', value: 1 }] },
          { name: 't', entries: [{ key: 'y', value: 2 }] },
        ],
      },
    })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('"t" 重复')
  })
})

describe('ui_app', () => {
  const exec = (input: Record<string, unknown>) => tool('ui_app').execute(input, ctx)

  it('合法：html + js 产出描述符', async () => {
    const r = await exec({
      title: '计数器',
      html: '<button id="b">0</button>',
      js: 'let n=0;b.onclick=function(){b.textContent=++n;momoiResize()}',
    })
    expect(r.error).toBeUndefined()
    const card = cardOf(r.data)
    expect(card.component).toBe('app')
    expect(card.title).toBe('计数器')
    expect(r.summary).toContain('已渲染卡片：应用「计数器」')
  })

  it('超 64K 合计上限被拒绝并给精简指引（各字段单独合规）', async () => {
    const r = await exec({
      html: 'x'.repeat(40000),
      css: 'y'.repeat(20000),
      js: 'z'.repeat(20000),
    })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('超过上限')
    expect(r.summary).toContain('精简')
  })

  it('单字段超长先被通用长度校验拦截', async () => {
    const r = await exec({ html: 'x'.repeat(65000) })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('长度不超过 64000')
  })

  it('html 缺失被拒绝', async () => {
    const r = await exec({ css: 'body{}' })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('html: 必填字段缺失')
  })

  it('height 超范围被拒绝（通用 schema 校验）', async () => {
    const r = await exec({ html: '<p>x</p>', height: 5000 })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('不能大于 960')
  })
})

describe('ui_character', () => {
  const exec = (input: Record<string, unknown>) => tool('ui_character').execute(input, ctx)

  it('合法：模型 + 表情 + 台词产出描述符', async () => {
    const r = await exec({
      title: '肉桂',
      model: 'cinnamon.vrm',
      expression: [{ name: 'happy', weight: 0.8 }],
      caption: '欢迎回来喵～',
      height: 420,
    })
    expect(r.error).toBeUndefined()
    const card = cardOf(r.data)
    expect(card.component).toBe('character')
    expect((card.props as { model: string }).model).toBe('cinnamon.vrm')
    expect(r.summary).toContain('已渲染卡片：3D 角色「肉桂」')
  })

  it('空参数合法（全默认：内置示例模型）', async () => {
    const r = await exec({})
    expect(r.error).toBeUndefined()
    expect(cardOf(r.data).component).toBe('character')
  })

  it('model 路径含 .. 被拒绝', async () => {
    const r = await exec({ model: '../../secret.vrm' })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('不得包含')
  })

  it('expression 权重越界被拒绝（通用 schema 校验）', async () => {
    const r = await exec({ expression: [{ name: 'happy', weight: 2 }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('不能大于 1')
  })

  it('expression 缺 name 被拒绝', async () => {
    const r = await exec({ expression: [{ weight: 0.5 }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('expression[0].name: 必填字段缺失')
  })

  it('acts：手势编排（at/times）合法产出', async () => {
    const r = await exec({
      caption: '欢迎回来喵～',
      acts: [
        { type: 'gesture', gesture: 'wave', at: 0, times: 2 },
        { type: 'gesture', gesture: 'tilt_head', at: 2 },
      ],
    })
    expect(r.error).toBeUndefined()
    const card = cardOf(r.data)
    expect((card.props as { acts: unknown[] }).acts).toHaveLength(2)
  })

  it('acts：姿态逃生舱合法产出', async () => {
    const r = await exec({
      acts: [
        { type: 'pose', pose: { bones: [{ bone: 'head', x: 12, z: -6 }, { bone: '__root', y: 0.1 }], hold: 1.5 } },
      ],
    })
    expect(r.error).toBeUndefined()
  })

  it('acts：非法手势名被 schema enum 拦截', async () => {
    const r = await exec({ acts: [{ type: 'gesture', gesture: 'moonwalk' }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('只允许')
  })

  it('acts：gesture 缺手势名 / pose 缺骨骼 被拒绝', async () => {
    const r1 = await exec({ acts: [{ type: 'gesture' }] })
    expect(r1.error).toBe(true)
    expect(r1.summary).toContain('必须提供 gesture')

    // 空数组 → 通用 schema 层（minItems）
    const r2 = await exec({ acts: [{ type: 'pose', pose: { bones: [] } }] })
    expect(r2.error).toBe(true)
    expect(r2.summary).toContain('至少 1 项')

    // 整个 pose 缺失 → extraValidate 层
    const r3 = await exec({ acts: [{ type: 'pose' }] })
    expect(r3.error).toBe(true)
    expect(r3.summary).toContain('必须提供 pose.bones')
  })

  it('acts：pose 骨骼未给任何角度 / pose 携带 times 被拒绝', async () => {
    const r1 = await exec({ acts: [{ type: 'pose', pose: { bones: [{ bone: 'head' }] } }] })
    expect(r1.error).toBe(true)
    expect(r1.summary).toContain('未提供任何角度')
    const r2 = await exec({ acts: [{ type: 'pose', pose: { bones: [{ bone: 'head', x: 10 }] }, times: 2 }] })
    expect(r2.error).toBe(true)
    expect(r2.summary).toContain('times 仅用于 gesture')
  })

  it('acts：未知骨骼名被 schema enum 拦截', async () => {
    const r = await exec({ acts: [{ type: 'pose', pose: { bones: [{ bone: 'tail', x: 10 }] } }] })
    expect(r.error).toBe(true)
    expect(r.summary).toContain('只允许')
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
