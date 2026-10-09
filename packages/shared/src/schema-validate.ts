// ============================================================
// Momoi — 工具参数 Schema 校验（ToolSchemaProperty 子集通用递归校验器）
// ============================================================
// 用途：ui_* 卡片工具在 execute 内校验模型传入的 props——服务端是唯一权威校验点
// （前端注册表只做防崩轻校验）。非 JSON Schema 全集，只覆盖 ToolSchemaProperty
// 定义的子集：type / required / enum / minimum / maximum / minLength / maxLength /
// minItems / maxItems / items / properties。
//
// 错误消息面向**模型自修复**：字段路径 + 违规原因 + 允许值，同一批错误聚合返回
// （上限 8 条，超出折叠计数），模型可据此在下一轮循环中修正参数。
// 手写而非 ajv：子集足够小、零依赖、前后端同构可复用。

import type { ToolSchemaProperty } from './types.js'

const MAX_ERRORS = 8

function typeName(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** 把字段路径拼成模型可读形式：'' → 根，'series[1].data' → 原样 */
function fmtPath(path: string): string {
  return path || '(根)'
}

function checkNode(value: unknown, schema: ToolSchemaProperty, path: string, errors: string[]): void {
  if (errors.length >= MAX_ERRORS) return

  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${fmtPath(path)}: 应为字符串，收到 ${typeName(value)}`)
        return
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${fmtPath(path)}: 长度至少 ${schema.minLength}（当前 ${value.length}）`)
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${fmtPath(path)}: 长度不超过 ${schema.maxLength}（当前 ${value.length}）`)
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${fmtPath(path)}: 只允许 ${schema.enum.map((e) => `"${e}"`).join(' | ')}，收到 "${value}"`)
      }
      if (schema.pattern) {
        try {
          if (!new RegExp(schema.pattern).test(value)) {
            errors.push(`${fmtPath(path)}: 不匹配格式 ${schema.pattern}`)
          }
        } catch {
          // schema 由服务端定义，非法 pattern 不应出现——忽略而非让校验瘫痪
        }
      }
      break
    }

    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${fmtPath(path)}: 应为数字，收到 ${typeName(value)}`)
        return
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`${fmtPath(path)}: 应为整数，收到 ${value}`)
        return
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${fmtPath(path)}: 不能小于 ${schema.minimum}（当前 ${value}）`)
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${fmtPath(path)}: 不能大于 ${schema.maximum}（当前 ${value}）`)
      }
      break
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push(`${fmtPath(path)}: 应为布尔值 true/false，收到 ${typeName(value)}`)
      }
      break
    }

    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${fmtPath(path)}: 应为数组，收到 ${typeName(value)}`)
        return
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${fmtPath(path)}: 至少 ${schema.minItems} 项（当前 ${value.length}）`)
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${fmtPath(path)}: 至多 ${schema.maxItems} 项（当前 ${value.length}）`)
      }
      if (schema.items) {
        for (let i = 0; i < value.length && errors.length < MAX_ERRORS; i++) {
          checkNode(value[i], schema.items, `${path}[${i}]`, errors)
        }
      }
      break
    }

    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${fmtPath(path)}: 应为对象，收到 ${typeName(value)}`)
        return
      }
      const obj = value as Record<string, unknown>
      for (const key of schema.required ?? []) {
        if (obj[key] === undefined) {
          errors.push(`${fmtPath(path)}.${key}: 必填字段缺失`)
          if (errors.length >= MAX_ERRORS) return
        }
      }
      const props = schema.properties ?? {}
      for (const [key, val] of Object.entries(obj)) {
        if (val === undefined) continue
        const sub = props[key]
        if (!sub) {
          const allowed = Object.keys(props)
          errors.push(
            `${fmtPath(path)}.${key}: 未知字段${allowed.length ? `（可用字段：${allowed.join(', ')}）` : ''}`,
          )
          if (errors.length >= MAX_ERRORS) return
          continue
        }
        checkNode(val, sub, path ? `${path}.${key}` : key, errors)
      }
      break
    }

    default:
      // 未知 type：宽松通过（schema 由服务端定义，不应出现）
      break
  }
}

/** 校验单个值是否满足 ToolSchemaProperty 节点。返回 null = 通过；否则为聚合错误描述。 */
export function validateToolSchema(value: unknown, schema: ToolSchemaProperty): string | null {
  const errors: string[] = []
  checkNode(value, schema, '', errors)
  return errors.length ? formatErrors(errors) : null
}

/** 校验对象是否满足工具输入形状（ToolDefinition.input_schema 语义：properties + required）。
 *  字段路径以 props 顶层字段名起算（如 `series[1].data`）。返回 null = 通过。 */
export function validateToolObject(
  value: unknown,
  properties: Record<string, ToolSchemaProperty>,
  required?: string[],
): string | null {
  const root: ToolSchemaProperty = { type: 'object', properties, required }
  const errors: string[] = []
  checkNode(value, root, '', errors)
  return errors.length ? formatErrors(errors) : null
}

function formatErrors(errors: string[]): string {
  // checkNode 在达到 MAX_ERRORS 时截断——无法精确知道总数，只标注"或更多"
  if (errors.length >= MAX_ERRORS) {
    return `${errors.join('；')}；…（错误较多，仅列出前 ${MAX_ERRORS} 条）`
  }
  return errors.join('；')
}
