// ============================================================
// formula — 受限公式 DSL 单测（解析 / 引用收集 / 求值）
// ============================================================

import { describe, it, expect } from 'vitest'
import { parseFormula, evaluateFormula } from '@momoi/shared/formula'

function evalOf(
  src: string,
  values: Record<string, unknown> = {},
  tables?: Record<string, Record<string, number>>,
): number | null {
  const p = parseFormula(src)
  if (!p.ok) throw new Error(`parse failed: ${p.error}`)
  return evaluateFormula(p.ast, { valueOf: (f) => values[f], tables })
}

describe('parseFormula — 语法', () => {
  it('基础运算与优先级', () => {
    expect(evalOf('1+2*3')).toBe(7)
    expect(evalOf('(1+2)*3')).toBe(9)
    expect(evalOf('10/4')).toBe(2.5)
  })

  it('幂右结合 / 一元负号 / 指数负号', () => {
    expect(evalOf('2^3^2')).toBe(512)
    expect(evalOf('-2^2')).toBe(-4)
    expect(evalOf('2^-3')).toBe(0.125)
    expect(evalOf('--3')).toBe(3)
  })

  it('ROUND：默认 2 位 / 指定位数', () => {
    expect(evalOf('ROUND(3.14159)')).toBe(3.14)
    expect(evalOf('ROUND(3.14159, 3)')).toBe(3.142)
  })

  it('引用收集：字段与表去重、按出现顺序', () => {
    const p = parseFormula('a + LOOKUP(b, t1) + ROUND(c * 2) + LOOKUP(a, t2)')
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.refs.fields).toEqual(['a', 'b', 'c'])
      expect(p.refs.tables).toEqual(['t1', 't2'])
    }
  })

  it('语法错误族：空公式 / 残缺表达式 / 非法数字 / 非法字符 / 缺括号', () => {
    expect(parseFormula('')).toMatchObject({ ok: false, error: '公式为空' })
    expect(parseFormula('   ')).toMatchObject({ ok: false, error: '公式为空' })
    const e1 = parseFormula('1+')
    expect(!e1.ok && e1.error).toContain('表达式不完整')
    const e2 = parseFormula('1.2.3')
    expect(!e2.ok && e2.error).toContain('不是合法数字')
    const e3 = parseFormula('a $ b')
    expect(!e3.ok && e3.error).toContain('意外的字符')
    const e4 = parseFormula('round(3.14')
    expect(!e4.ok && e4.error).toContain('缺少「)」')
    const e5 = parseFormula('ROUND(1, 9)')
    expect(!e5.ok && e5.error).toContain('最多 6')
    const e6 = parseFormula('LOOKUP(a)')
    expect(!e6.ok && e6.error).toContain('缺少「,」')
    const e7 = parseFormula('1 2')
    expect(!e7.ok && e7.error).toContain('多余的')
  })

  it('函数名大小写不敏感', () => {
    expect(evalOf('round(3.14159, 1)')).toBe(3.1)
    const p = parseFormula('lookup(k, t)')
    expect(p.ok).toBe(true)
  })
})

describe('evaluateFormula — 求值与失败路径', () => {
  it('LOOKUP 按字段值查表（汇率换算场景）', () => {
    expect(evalOf('amount * LOOKUP(pair, rate)', { amount: 100, pair: 'USD>CNY' }, { rate: { 'USD>CNY': 7.21 } })).toBe(721)
    expect(
      evalOf('ROUND(amount * LOOKUP(pair, rate), 2)', { amount: 88, pair: 'EUR>CNY' }, { rate: { 'EUR>CNY': 7.8532 } }),
    ).toBe(691.08)
  })

  it('字段值强转：字符串数字 / 布尔', () => {
    expect(evalOf('x * 2', { x: '12.5' })).toBe(25)
    expect(evalOf('flag * 2', { flag: true })).toBe(2)
    expect(evalOf('flag * 2', { flag: false })).toBe(0)
  })

  it('失败一律 null：缺字段 / 非数值 / 空串 / 除零 / 查无键 / 溢出', () => {
    expect(evalOf('x + 1', {})).toBeNull()
    expect(evalOf('x + 1', { x: 'abc' })).toBeNull()
    expect(evalOf('x + 1', { x: '' })).toBeNull()
    expect(evalOf('1/0')).toBeNull()
    expect(evalOf('amount * LOOKUP(pair, rate)', { amount: 1, pair: 'USD>JPY' }, { rate: { 'USD>CNY': 7.21 } })).toBeNull()
    expect(evalOf('amount * LOOKUP(pair, rate)', { amount: 1 }, { rate: { 'USD>CNY': 7.21 } })).toBeNull()
    expect(evalOf('9^9^9')).toBeNull()
    expect(evalOf('(-8)^0.5')).toBeNull()
  })

  it('LOOKUP 的表不存在时返回 null（声明期校验之外的运行时兜底）', () => {
    expect(evalOf('LOOKUP(a, t)', { a: 'k' }, undefined)).toBeNull()
  })
})
