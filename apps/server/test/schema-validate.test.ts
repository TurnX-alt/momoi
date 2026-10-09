// ============================================================
// schema-validate — ToolSchemaProperty 子集通用校验器单测
// ============================================================

import { describe, it, expect } from 'vitest'
import { validateToolSchema, validateToolObject } from '@momoi/shared/schema-validate'
import type { ToolSchemaProperty } from '@momoi/shared/types'

describe('validateToolSchema — 基础类型', () => {
  it('string：通过 / 类型错误 / 长度约束 / enum / pattern', () => {
    const s: ToolSchemaProperty = { type: 'string', minLength: 2, maxLength: 5, enum: ['ab', 'abc'] }
    expect(validateToolSchema('ab', s)).toBeNull()
    expect(validateToolSchema(3, s)).toContain('应为字符串，收到 number')
    expect(validateToolSchema('a', s)).toContain('长度至少 2')
    expect(validateToolSchema('abcd', s)).toContain('只允许 "ab" | "abc"')
    expect(validateToolSchema('abcd', { type: 'string', pattern: '^x' })).toContain('不匹配格式')
  })

  it('number / integer：范围与整数性', () => {
    expect(validateToolSchema(5, { type: 'number', minimum: 1, maximum: 10 })).toBeNull()
    expect(validateToolSchema(0, { type: 'number', minimum: 1 })).toContain('不能小于 1')
    expect(validateToolSchema(11, { type: 'number', maximum: 10 })).toContain('不能大于 10')
    expect(validateToolSchema(1.5, { type: 'integer' })).toContain('应为整数')
    expect(validateToolSchema(NaN, { type: 'number' })).toContain('应为数字')
    expect(validateToolSchema('x', { type: 'number' })).toContain('应为数字')
  })

  it('boolean：类型检查', () => {
    expect(validateToolSchema(true, { type: 'boolean' })).toBeNull()
    expect(validateToolSchema(1, { type: 'boolean' })).toContain('应为布尔值')
  })
})

describe('validateToolSchema — 数组与嵌套', () => {
  const seriesSchema: ToolSchemaProperty = {
    type: 'array',
    minItems: 1,
    maxItems: 3,
    items: {
      type: 'object',
      required: ['name', 'data'],
      properties: {
        name: { type: 'string', maxLength: 5 },
        data: { type: 'array', items: { type: 'number' }, minItems: 1 },
      },
    },
  }

  it('合法嵌套结构通过', () => {
    expect(validateToolSchema([{ name: 'A', data: [1, 2] }], seriesSchema)).toBeNull()
  })

  it('数组长度约束与路径定位', () => {
    expect(validateToolSchema([], seriesSchema)).toContain('至少 1 项（当前 0）')
    const err = validateToolSchema(
      [{ name: 'A', data: [1] }, { name: 'B', data: [1] }, { name: 'C', data: [1] }, { name: 'D', data: [1] }],
      seriesSchema,
    )
    expect(err).toContain('至多 3 项（当前 4）')
  })

  it('嵌套字段错误带完整路径', () => {
    const err = validateToolSchema([{ name: 'A', data: [1] }, { name: 'B', data: ['x'] }], seriesSchema)
    expect(err).toContain('[1].data[0]: 应为数字，收到 string')
  })

  it('必填字段缺失 / 未知字段', () => {
    const err = validateToolSchema([{ name: 'A' }], seriesSchema)
    expect(err).toContain('[0].data: 必填字段缺失')
    const err2 = validateToolSchema([{ name: 'A', data: [1], extra: 1 }], seriesSchema)
    expect(err2).toContain('[0].extra: 未知字段（可用字段：name, data）')
  })
})

describe('validateToolObject — 顶层对象语义', () => {
  const properties: Record<string, ToolSchemaProperty> = {
    title: { type: 'string', maxLength: 10 },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
    },
  }

  it('合法对象通过；路径从顶层字段名起算', () => {
    expect(validateToolObject({ title: 't', items: [{ value: '1' }] }, properties, ['items'])).toBeNull()
    const err = validateToolObject({ items: [{ value: 1.5 }] }, properties, ['items'])
    expect(err).toContain('items[0].value: 应为字符串')
  })

  it('required 缺失与未知顶层字段', () => {
    expect(validateToolObject({ title: 't' }, properties, ['items'])).toContain('items: 必填字段缺失')
    expect(validateToolObject({ title: 't', items: [{}], oops: 1 }, properties, ['items'])).toContain(
      'oops: 未知字段',
    )
  })

  it('错误数封顶并标注', () => {
    const bigProps: Record<string, ToolSchemaProperty> = {}
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < 12; i++) {
      bigProps[`f${i}`] = { type: 'string' }
      obj[`f${i}`] = 1
    }
    const err = validateToolObject(obj, bigProps, [])
    expect(err).toContain('仅列出前 8 条')
  })
})
