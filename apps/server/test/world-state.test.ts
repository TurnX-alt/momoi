// ============================================================
// 世界状态：解析容错 / 对账 / 校验 / 卡片构建（纯函数单测）
// ============================================================
// 落库与路由链路见 scripts/test-world-state-e2e.ts（内存级 E2E）。
// 提示词注入的渲染文本由 golden 快照锁定（chat.system/world-with-states、
// neutral.world-state.*）。

import { describe, it, expect } from 'vitest'
import {
  parseStateDefs,
  parseStateValues,
  parseWorldRuntime,
  reconcileView,
  reconcileStored,
  resolveMemberByName,
  validateStates,
  validateValueEdit,
  buildStateChangeCard,
  MAX_STATE_ATTRS,
  MAX_STATE_VALUE_LEN,
  type WorldStateChange,
} from '../src/lib/world-state.js'

describe('解析容错（NULL / 损坏 JSON / 手改数据绝不抛出）', () => {
  it('parseStateDefs：NULL / 损坏 JSON / 非数组 → []', () => {
    expect(parseStateDefs(null)).toEqual([])
    expect(parseStateDefs(undefined)).toEqual([])
    expect(parseStateDefs('{oops')).toEqual([])
    expect(parseStateDefs('{"a":1}')).toEqual([])
  })

  it('parseStateDefs：过滤非法条目 + 去重 + 数字默认值字符串化', () => {
    const raw = JSON.stringify([
      { name: '生命值', default: '100', description: '健康' },
      { name: '生命值', default: '200' }, // 重名 → 丢
      { name: '', default: '1' }, // 空名 → 丢
      { name: 'a|b', default: '1' }, // 含「|」→ 丢（护结算解析）
      { name: '体温', default: 36.5 }, // 数字 → 字符串化
      'junk',
    ])
    expect(parseStateDefs(raw)).toEqual([
      { name: '生命值', default: '100', description: '健康' },
      { name: '体温', default: '36.5' },
    ])
  })

  it('parseStateValues：非字符串值丢弃（数字字符串化）', () => {
    const raw = JSON.stringify({
      a1: { 生命值: 78, 体温: '38.2℃', bad: { x: 1 } },
      a2: 'junk',
    })
    expect(parseStateValues(raw)).toEqual({ a1: { 生命值: '78', 体温: '38.2℃' } })
  })

  it('parseWorldRuntime：行 → 运行态（NULL 列容错）', () => {
    const rt = parseWorldRuntime({
      laws: 'L',
      states: JSON.stringify([{ name: 'x', default: '1' }]),
      state_values: null,
    })
    expect(rt).toEqual({ laws: 'L', states: [{ name: 'x', default: '1' }], state_values: {} })
  })
})

describe('对账', () => {
  const defs = [
    { name: '生命值', default: '100' },
    { name: '体温', default: '36.5℃' },
  ]

  it('reconcileView：按当前成员过滤 + 缺属性补默认 + 丢弃未定义属性', () => {
    const stored = {
      a1: { 生命值: '78', 幽灵属性: 'x' },
      gone: { 生命值: '1' }, // 非成员 → 不进视图
    }
    expect(reconcileView(defs, stored, ['a1', 'a2'])).toEqual({
      a1: { 生命值: '78', 体温: '36.5℃' },
      a2: { 生命值: '100', 体温: '36.5℃' },
    })
  })

  it('reconcileStored：成员行按新定义重建，非成员历史值保留（读取时过滤）', () => {
    const stored = { a1: { 生命值: '78', 体温: '38.2℃' }, gone: { 生命值: '1' } }
    const next = reconcileStored(
      [{ name: '生命值', default: '100' }, { name: '精神', default: '90' }],
      stored,
      ['a1'],
    )
    expect(next.a1).toEqual({ 生命值: '78', 精神: '90' }) // 体温被删；精神补默认；生命值保留
    expect(next.gone).toEqual({ 生命值: '1' })
  })
})

describe('定义校验（validateStates）', () => {
  it('合法定义通过：修剪空白 + 数字默认值字符串化', () => {
    const r = validateStates([{ name: ' 生命值 ', default: 100, description: ' 健康 ' }])
    expect(r).toEqual({ ok: true, value: [{ name: '生命值', default: '100', description: '健康' }] })
  })

  it('拒绝路径：非数组 / 超上限 / 空名 / 重名 / 超长 / 管道符 / 缺默认值 / 超长默认值', () => {
    expect(validateStates('x').ok).toBe(false)
    expect(
      validateStates(Array.from({ length: MAX_STATE_ATTRS + 1 }, (_, i) => ({ name: `a${i}`, default: '1' }))).ok,
    ).toBe(false)
    expect(validateStates([{ name: ' ', default: '1' }]).ok).toBe(false)
    expect(validateStates([{ name: 'a', default: '1' }, { name: 'a', default: '2' }]).ok).toBe(false)
    expect(validateStates([{ name: 'x'.repeat(21), default: '1' }]).ok).toBe(false)
    expect(validateStates([{ name: 'a|b', default: '1' }]).ok).toBe(false)
    expect(validateStates([{ name: 'a' }]).ok).toBe(false)
    expect(validateStates([{ name: 'a', default: 'x'.repeat(MAX_STATE_VALUE_LEN + 1) }]).ok).toBe(false)
    expect(validateStates([{ name: 'a', default: 'x\ny' }]).ok).toBe(false)
  })
})

describe('值校验（validateValueEdit）', () => {
  const defs = [{ name: '生命值', default: '100' }]

  it('合法编辑通过（数字字符串化）', () => {
    expect(validateValueEdit({ a1: { 生命值: 78 } }, defs, ['a1'])).toEqual({
      ok: true,
      value: { a1: { 生命值: '78' } },
    })
  })

  it('拒绝路径：非成员 / 未定义属性 / 非法值', () => {
    expect(validateValueEdit({ ghost: { 生命值: '1' } }, defs, ['a1']).ok).toBe(false)
    expect(validateValueEdit({ a1: { 不存在: '1' } }, defs, ['a1']).ok).toBe(false)
    expect(validateValueEdit({ a1: { 生命值: 'a|b' } }, defs, ['a1']).ok).toBe(false)
    expect(validateValueEdit({ a1: { 生命值: { deep: 1 } } }, defs, ['a1']).ok).toBe(false)
    expect(validateValueEdit('x', defs, ['a1']).ok).toBe(false)
  })
})

describe('成员解析与卡片构建', () => {
  it('resolveMemberByName：大小写不敏感精确匹配', () => {
    const members = [
      { id: 'a1', name: 'Cinnamon' },
      { id: 'a2', name: '椰子' },
    ]
    expect(resolveMemberByName(members, ' cinnamon ')?.id).toBe('a1')
    expect(resolveMemberByName(members, '椰子')?.id).toBe('a2')
    expect(resolveMemberByName(members, '椰')).toBeNull()
    expect(resolveMemberByName(members, '')).toBeNull()
  })

  it('buildStateChangeCard：component=state + 变更条目映射（reason 可省）', () => {
    const changes: WorldStateChange[] = [
      { agentId: 'a1', agentName: '红豆', attribute: '生命值', from: '100', to: '78', reason: '落石' },
      { agentId: 'a2', agentName: '椰子', attribute: '体温', from: '36.5℃', to: '38.2℃' },
    ]
    expect(buildStateChangeCard(changes, '状态结算')).toEqual({
      component: 'state',
      title: '状态结算',
      props: {
        changes: [
          { agent: '红豆', attribute: '生命值', from: '100', to: '78', reason: '落石' },
          { agent: '椰子', attribute: '体温', from: '36.5℃', to: '38.2℃' },
        ],
      },
    })
  })
})
