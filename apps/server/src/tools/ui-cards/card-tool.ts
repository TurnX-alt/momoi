// ============================================================
// UI 卡片工具工厂 — CardComponentSpec → ToolModule
// ============================================================
// 每个 ui_* 卡片工具都由该工厂从 catalog spec 构造：
//   1. definition：名称 / 描述 / input_schema 由 spec 生成
//      （描述随普通工具经 tool/<name> 片段机制进入提示词目录，可被覆盖）
//   2. execute：通用 schema 校验 → 组件特有语义校验
//      失败 → 面向**模型自修复**的 error summary（字段路径 + 允许值）
//      成功 → { summary, data: { card: CardDescriptor } }
//
// 卡片描述符经 ToolResult.data 上送 pi-adapter 的 tool_execution_end 捕获点
// （写入 trace 持久化 + 推 SSE card 事件），协议见
// docs/specs/module-intelligent-ui.md。
// ============================================================

import type { CardDescriptor, ToolDefinition } from '@momoi/shared/types'
import { validateToolObject } from '@momoi/shared/schema-validate'
import type { ToolModule, ToolResult } from '../types.js'
import { cardCatalog, type CardComponentSpec } from './catalog.js'

function buildDefinition(spec: CardComponentSpec): ToolDefinition {
  return {
    name: spec.toolName,
    description: spec.description,
    input_schema: {
      type: 'object',
      properties: spec.propsSchema,
      required: spec.required,
    },
  }
}

export function createCardTool(spec: CardComponentSpec): ToolModule {
  return {
    definition: buildDefinition(spec),

    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      // 1. 通用 schema 校验（服务端唯一权威校验点）
      const schemaError = validateToolObject(input, spec.propsSchema, spec.required)
      if (schemaError) {
        return {
          summary: `参数校验失败：${schemaError}。请修正参数后重新调用 ${spec.toolName}。`,
          error: true,
        }
      }

      // 2. 组件特有语义校验（长度一致性 / 饼图限制 / 表格行列匹配等）
      const semanticError = spec.extraValidate?.(input)
      if (semanticError) {
        return {
          summary: `参数校验失败：${semanticError}。请修正参数后重新调用 ${spec.toolName}。`,
          error: true,
        }
      }

      // 3. 组装卡片描述符：title 提到描述符顶层（CardFrame 统一渲染），其余作为组件 props
      const { title, ...props } = input
      const card: CardDescriptor = {
        component: spec.component,
        ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
        props,
      }

      return {
        summary: `已渲染卡片：${spec.label}${card.title ? `「${card.title}」` : ''}`,
        data: { card },
      }
    },
  }
}

/** 全部已启用的卡片工具（注册进 tools/registry.ts 的 allTools） */
export const cardTools: ToolModule[] = cardCatalog.map(createCardTool)
