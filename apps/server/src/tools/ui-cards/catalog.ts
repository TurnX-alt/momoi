// ============================================================
// UI 卡片目录 — 生成式卡片的单一事实来源（Single Source of Truth）
// ============================================================
// 一个 spec 同时驱动三处产物，保证永不漂移：
//   1. 工具定义（ToolDefinition：名称 / 描述 / input_schema）——模型每轮可见
//   2. chat/ui-cards 提示词片段（capabilities 层的组件目录 + 选卡指引）
//   3. 文档（docs/specs/module-intelligent-ui.md 的组件表）
//
// 分期：M1 = chart / stat / table / diagram；form / app / character 后续追加。
// 协议（CardDescriptor / SSE card 事件 / trace 持久化）见
// docs/specs/module-intelligent-ui.md 与 DECISIONS.md D54。
//
// 注意：本模块刻意只依赖 @momoi/shared——被 prompts 片段静态引用，
// 不得把 DB / 文档解析等重依赖拖进提示词引擎的依赖树。
// ============================================================

import type { CardComponent, ToolSchemaProperty } from '@momoi/shared/types'
import { parseFormula } from '@momoi/shared/formula'

export interface CardComponentSpec {
  /** 卡片组件名（shared CardComponent 联合） */
  component: CardComponent
  /** 暴露给模型的工具名（ui_*） */
  toolName: string
  /** 人类可读组件名（工具结果 summary 与文档用），如「图表」 */
  label: string
  /** chat/ui-cards 片段的一行目录条目（是什么 + 何时用） */
  catalogLine: string
  /** 工具描述正文（模型每轮可见）：职责 + 参数规则 + 限制 */
  description: string
  /** 工具参数 JSON Schema（ToolSchemaProperty 子集；title 为通用可选字段） */
  propsSchema: Record<string, ToolSchemaProperty>
  required: string[]
  /** 组件特有语义校验（在通用 schema 校验之后执行）；返回 null = 通过，否则为面向模型自修复的原因描述 */
  extraValidate?: (props: Record<string, unknown>) => string | null
}

/** 通用可选字段：卡片标题（CardFrame 渲染） */
const titleProp: ToolSchemaProperty = {
  type: 'string',
  maxLength: 60,
  description: '卡片标题（可选）',
}

// ---- 数据可视化：图表 ----

const chartSeriesSchema: ToolSchemaProperty = {
  type: 'object',
  required: ['name', 'data'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 40, description: '系列名（图例显示）' },
    data: {
      type: 'array',
      items: { type: 'number' },
      minItems: 1,
      maxItems: 60,
      description: '数值序列（饼图 = 各扇区数值，应非负）',
    },
    stack: { type: 'string', maxLength: 20, description: '堆叠组名（可选；同名系列堆叠。仅柱状图）' },
  },
}

function validateChartProps(props: Record<string, unknown>): string | null {
  const errs: string[] = []
  const type = props.type as string
  const series = props.series as Array<{ data: number[] }>
  const labels = props.labels as string[] | undefined

  const lengths = new Set(series.map((s) => (Array.isArray(s?.data) ? s.data.length : -1)))
  if (lengths.size > 1) {
    errs.push(`series 各条 data 长度必须一致（当前分别为 ${[...lengths].join(' / ')}）`)
  }
  const len = lengths.size === 1 ? [...lengths][0] : -1
  if (labels && len >= 0 && labels.length !== len) {
    errs.push(`labels 长度（${labels.length}）必须与 series 的 data 长度（${len}）一致`)
  }
  if (type === 'pie') {
    if (!labels) errs.push('饼图必须提供 labels（各扇区名）')
    if (series.length !== 1) errs.push(`饼图只允许 1 条 series（当前 ${series.length} 条）`)
    if (labels && labels.length > 5) {
      errs.push(`饼图最多 5 个扇区（当前 ${labels.length} 个）——类目更多时请改用柱状图`)
    }
  }
  if (props.stacked === true && type !== 'bar') errs.push('stacked 仅用于柱状图（type="bar"）')
  if (props.horizontal === true && type !== 'bar') errs.push('horizontal 仅用于柱状图（type="bar"）')
  return errs.length ? errs.join('；') : null
}

const chartSpec: CardComponentSpec = {
  component: 'chart',
  toolName: 'ui_chart',
  label: '图表',
  catalogLine: '图表卡片（折线/柱状/饼图）——趋势、对比、占比可视化',
  description:
    '渲染图表卡片：折线/柱状/饼图，用于趋势、对比、占比等数据可视化。' +
    '颜色由前端自动分配，不要指定颜色。series 为数据系列（1-8 条），缺 labels 时折线/柱状按序号作类目；' +
    '饼图：labels 必填（扇区名）、只允许 1 条 series、最多 5 类。stacked/horizontal 仅用于柱状图。' +
    '数据过于明细时先聚合再制卡；一两个数字直接在正文说明即可，不必制卡。',
  propsSchema: {
    title: titleProp,
    type: {
      type: 'string',
      enum: ['line', 'bar', 'pie'],
      description: '图表类型：line=折线（趋势）、bar=柱状（对比）、pie=饼图（占比，最多 5 类）',
    },
    labels: {
      type: 'array',
      items: { type: 'string', maxLength: 40 },
      maxItems: 60,
      description: '类目轴标签（饼图 = 扇区名）。提供时长度必须与每条 series 的 data 一致',
    },
    series: {
      type: 'array',
      items: chartSeriesSchema,
      minItems: 1,
      maxItems: 8,
      description: '数据系列（最多 8 条）',
    },
    unit: { type: 'string', maxLength: 10, description: '数值单位（可选），如 "%"、"万元"' },
    stacked: { type: 'boolean', description: '堆叠柱状图（仅 type=bar 时有效）' },
    horizontal: { type: 'boolean', description: '横向柱状图（仅 type=bar 时有效）' },
  },
  required: ['type', 'series'],
  extraValidate: validateChartProps,
}

// ---- 数据可视化：统计卡 ----

const statSpec: CardComponentSpec = {
  component: 'stat',
  toolName: 'ui_stat',
  label: '统计卡',
  catalogLine: '统计卡片（KPI 数值组，≤6 项）——一组要点数字的醒目呈现',
  description:
    '渲染统计卡片：一组关键数值的醒目呈现（KPI 数值组，1-6 项，每项含标签与数值，可选变化量）。' +
    'value 为格式化后的展示字符串（如 "1,234"、"98.6%"、"12.5万"）——自行完成千分位/单位等格式化；' +
    'delta 为数值变化量（正数=上升，负数=下降）。' +
    '适用场景：多个要点数字需要醒目呈现时；单个数字直接在正文说明即可。',
  propsSchema: {
    title: titleProp,
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      description: '统计项（1-6 个）',
      items: {
        type: 'object',
        required: ['label', 'value'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 30, description: '指标名' },
          value: {
            type: 'string',
            minLength: 1,
            maxLength: 30,
            description: '展示值（格式化字符串，如 "1,234"、"98.6%"）',
          },
          unit: { type: 'string', maxLength: 10, description: '单位（可选；若 value 已含单位可省略）' },
          delta: { type: 'number', description: '变化量（可选；正数=上升，负数=下降）' },
          deltaLabel: { type: 'string', maxLength: 20, description: '变化量说明（可选），如 "较上月"' },
        },
      },
    },
  },
  required: ['items'],
}

// ---- 数据可视化：表格 ----

function validateTableProps(props: Record<string, unknown>): string | null {
  const columns = props.columns as string[]
  const rows = props.rows as string[][]
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== columns.length) {
      return `第 ${i + 1} 行有 ${rows[i].length} 个单元格，但 columns 有 ${columns.length} 列——每行单元格数必须等于列数`
    }
  }
  return null
}

const tableSpec: CardComponentSpec = {
  component: 'table',
  toolName: 'ui_table',
  label: '表格',
  catalogLine: '表格卡片——多字段明细、对比清单',
  description:
    '渲染表格卡片：结构化清单（多字段明细、对比清单，最多 12 列 × 200 行）。' +
    'columns 为列名，rows 为数据行——每行的单元格数必须等于列数；单元格为字符串' +
    '（纯数字列前端会自动右对齐）。行数很多时考虑只展示摘要与代表性数据。',
  propsSchema: {
    title: titleProp,
    columns: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 40 },
      minItems: 1,
      maxItems: 12,
      description: '列名（1-12 列）',
    },
    rows: {
      type: 'array',
      maxItems: 200,
      description: '数据行（最多 200 行；每行单元格数须等于列数）',
      items: {
        type: 'array',
        items: { type: 'string', maxLength: 200 },
        maxItems: 12,
        description: '单行',
      },
    },
    dense: { type: 'boolean', description: '紧凑行距（可选，适合行数较多时）' },
  },
  required: ['columns', 'rows'],
  extraValidate: validateTableProps,
}

// ---- 图示：Mermaid ----

const diagramSpec: CardComponentSpec = {
  component: 'diagram',
  toolName: 'ui_diagram',
  label: 'Mermaid 图',
  catalogLine: 'Mermaid 图示卡片——流程、时序、状态、甘特等结构图',
  description:
    '渲染 Mermaid 图示卡片：用 Mermaid DSL 渲染流程图、时序图、状态图、甘特图等结构化图示。' +
    'code 为完整 Mermaid 源码（不含任何围栏标记）。' +
    '优先使用 flowchart/graph、sequenceDiagram、stateDiagram-v2、gantt 等主流图型；过于小众的图型可能渲染失败。' +
    '数据可视化（趋势/对比/占比）请改用 ui_chart。',
  propsSchema: {
    title: titleProp,
    code: {
      type: 'string',
      minLength: 1,
      maxLength: 8000,
      description: 'Mermaid 源码（不含 ```mermaid 围栏标记）',
    },
  },
  required: ['code'],
}

// ---- 交互：表单 ----

const formFieldSchema: ToolSchemaProperty = {
  type: 'object',
  required: ['type', 'name', 'label'],
  properties: {
    type: {
      type: 'string',
      enum: ['text', 'number', 'textarea', 'select', 'multiselect', 'slider', 'checkbox', 'button-group'],
      description: '字段类型',
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 40,
      pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
      description: '字段标识（回传表单值的键；字母/下划线开头，字母数字下划线组成，须唯一）',
    },
    label: { type: 'string', minLength: 1, maxLength: 40, description: '显示标签' },
    required: { type: 'boolean', description: '是否必填（默认 false）' },
    placeholder: { type: 'string', maxLength: 60, description: '占位提示（text/number/textarea）' },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      description: '选项（select/multiselect/button-group 必填；其它类型不可携带）',
      items: {
        type: 'object',
        required: ['label'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 40, description: '选项显示文本' },
          value: { type: 'string', maxLength: 40, description: '选项回传值（可选；缺省用 label）' },
        },
      },
    },
    min: { type: 'number', description: '最小值（仅 slider）' },
    max: { type: 'number', description: '最大值（仅 slider）' },
    step: { type: 'number', description: '步长（仅 slider，默认 1）' },
  },
}

function validateFormProps(props: Record<string, unknown>): string | null {
  const errs: string[] = []
  const fields = props.fields as Array<Record<string, unknown>>
  const names = new Set<string>()

  for (const f of fields) {
    const name = f.name as string
    const type = f.type as string
    if (names.has(name)) errs.push(`字段名 "${name}" 重复——name 必须唯一`)
    names.add(name)

    const optionsTypes = type === 'select' || type === 'multiselect' || type === 'button-group'
    if (optionsTypes && !f.options) {
      errs.push(`字段 "${name}"（${type}）必须提供 options（2-8 个）`)
    }
    if (!optionsTypes && f.options) {
      errs.push(`字段 "${name}"（${type}）不支持 options——options 仅用于 select/multiselect/button-group`)
    }
    const sliderTypes = type === 'slider'
    if (!sliderTypes && (f.min !== undefined || f.max !== undefined || f.step !== undefined)) {
      errs.push(`字段 "${name}"（${type}）不支持 min/max/step——仅用于 slider`)
    }
    if (sliderTypes) {
      if (typeof f.min === 'number' && typeof f.max === 'number' && f.min >= f.max) {
        errs.push(`字段 "${name}" 的 min（${f.min}）必须小于 max（${f.max}）`)
      }
      if (typeof f.step === 'number' && f.step <= 0) {
        errs.push(`字段 "${name}" 的 step 必须大于 0`)
      }
    }
  }

  // 本地计算配置：声明期校验公式（语法 / 未知字段 / 未知表）——错误面向模型自修复
  const compute = props.compute as Record<string, unknown> | undefined
  if (compute) {
    const parsed = parseFormula(String(compute.formula ?? ''))
    if (!parsed.ok) {
      errs.push(`compute.formula 语法错误：${parsed.error}`)
    } else {
      const tables = Array.isArray(compute.tables) ? (compute.tables as Array<{ name?: unknown }>) : []
      const tableNames = new Set<string>()
      for (const t of tables) {
        const tn = String(t?.name ?? '')
        if (tableNames.has(tn)) errs.push(`compute.tables 中表名 "${tn}" 重复`)
        tableNames.add(tn)
      }
      const unknownFields = parsed.refs.fields.filter((f) => !names.has(f))
      if (unknownFields.length) {
        errs.push(
          `compute.formula 引用了不存在的字段：${unknownFields.join('、')}（可用字段：${[...names].join('、')}）`,
        )
      }
      const unknownTables = parsed.refs.tables.filter((t) => !tableNames.has(t))
      if (unknownTables.length) {
        errs.push(
          `compute.formula 的 LOOKUP 引用了不存在的表：${unknownTables.join('、')}（可用表：${[...tableNames].join('、') || '无'}）`,
        )
      }
    }
  }

  return errs.length ? errs.join('；') : null
}

const formSpec: CardComponentSpec = {
  component: 'form',
  toolName: 'ui_form',
  label: '表单',
  catalogLine: '表单卡片——收集用户输入；可配 compute 公式在卡片内实时计算（如汇率换算），亦可提交回传',
  description:
    '渲染表单卡片：向用户收集若干字段（1-12 个），用户填写提交后，其内容会作为一条新消息回传给你继续处理。' +
    'name 是回传值的键（字母/下划线开头，须唯一）；字段类型 text/number/textarea 自由输入，' +
    'select/multiselect/button-group 必须提供 options（2-8 个），slider 可用 min/max/step，checkbox 为开关。' +
    '可选 compute 开启**本地实时计算**（无状态工具类卡片的正确形态：结果随输入在卡片内实时显示，不消耗对话轮次）——' +
    'formula 以字段名作变量，支持 + - * / ^、括号、一元负号、ROUND(x, n)、LOOKUP(字段, 表名)；' +
    '数据（汇率、换算系数等——尽量用最新值）经 tables 内联，LOOKUP 的键对应 select 字段的选项值；用户可随时把结果发送给你。' +
    '典型："ROUND(amount * LOOKUP(pair, rate), 2)" 做汇率换算，另见单位换算、贷款月供。' +
    '何时用：需要用户输入多个参数、做选择题、确认配置，或需要一张能直接算出结果的小工具时。' +
    '何时不用：只有一个简单问题用正文询问即可。',
  propsSchema: {
    title: titleProp,
    description: { type: 'string', maxLength: 200, description: '表单说明（可选，显示在字段上方）' },
    fields: {
      type: 'array',
      items: formFieldSchema,
      minItems: 1,
      maxItems: 12,
      description: '字段列表（1-12 个）',
    },
    submitLabel: { type: 'string', maxLength: 20, description: '提交按钮文案（可选，默认「提交」）' },
    compute: {
      type: 'object',
      required: ['formula'],
      description:
        '本地实时计算配置（可选）——配置后结果随输入实时显示在卡片内（不消耗对话轮次），提交按钮变为「发送给 AI」',
      properties: {
        formula: {
          type: 'string',
          minLength: 1,
          maxLength: 300,
          description:
            '结果公式：字段名作变量，支持 + - * / ^、括号、一元负号、ROUND(x, n)、LOOKUP(字段, 表名)。' +
            '示例："ROUND(amount * LOOKUP(pair, rate), 2)"',
        },
        tables: {
          type: 'array',
          maxItems: 4,
          description: 'LOOKUP 数据表（可选）——如汇率表；键需与 select 字段的选项值一致',
          items: {
            type: 'object',
            required: ['name', 'entries'],
            properties: {
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 30,
                pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
                description: '表名（公式中 LOOKUP 第二参数引用）',
              },
              entries: {
                type: 'array',
                minItems: 1,
                maxItems: 50,
                description: '条目列表',
                items: {
                  type: 'object',
                  required: ['key', 'value'],
                  properties: {
                    key: { type: 'string', minLength: 1, maxLength: 40, description: '键（与 select 选项的 value 对应）' },
                    value: { type: 'number', description: '数值' },
                  },
                },
              },
            },
          },
        },
        resultLabel: { type: 'string', maxLength: 20, description: '结果行标签（可选，默认「计算结果」）' },
        resultUnit: { type: 'string', maxLength: 10, description: '结果单位（可选），如 "元"' },
      },
    },
  },
  required: ['fields'],
  extraValidate: validateFormProps,
}

// ---- 沙箱逃生舱：自包含小应用 ----

/** html + css + js 合计字符上限（D57）——超限工具级拒绝，引导模型精简 */
const APP_SIZE_LIMIT = 64000

function validateAppProps(props: Record<string, unknown>): string | null {
  const total = (['html', 'css', 'js'] as const)
    .map((k) => (typeof props[k] === 'string' ? (props[k] as string).length : 0))
    .reduce((a, b) => a + b, 0)
  if (total > APP_SIZE_LIMIT) {
    return `html + css + js 合计 ${total} 字符，超过上限 ${APP_SIZE_LIMIT}——请精简（压缩内联数据、去掉冗余标记与注释）`
  }
  return null
}

const appSpec: CardComponentSpec = {
  component: 'app',
  toolName: 'ui_app',
  label: '应用',
  catalogLine: '应用卡片（AppBlock）——自包含 HTML/CSS/JS 小应用（小游戏/交互演示），隔离沙箱内运行',
  description:
    '渲染交互式小应用卡片：自包含的 HTML/CSS/JS 单页应用，在隔离沙箱中运行，可包含按钮、画布、动画、小游戏等任意交互。' +
    'html 为页面主体（不含外层的 <html>/<body> 标签），css/js 可选（分别以内联 <style>/<script> 注入）；三者合计不超过 64000 字符。' +
    '沙箱硬性限制：fetch/XHR/WebSocket 全部被阻断（**没有网络**）；无 localStorage/cookie；外部 CDN 脚本与样式不可用——' +
    '所有逻辑与数据必须内联；图片可用 data: URL 或 https 直链。不要要求用户输入任何凭据或敏感信息。' +
    '页面高度默认 320px，可经 height 指定（64-960）；JS 中调用 momoiResize() 可通知卡片自适应高度。' +
    '适合：小游戏、交互演示、可视化玩具。图表/表格/表单请优先用对应的 ui_* 专用卡片。',
  propsSchema: {
    title: titleProp,
    html: { type: 'string', minLength: 1, maxLength: 64000, description: '页面主体 HTML（不含 <html>/<body> 外层标签）' },
    css: { type: 'string', maxLength: 32000, description: '附加 CSS（可选，以内联 <style> 注入）' },
    js: { type: 'string', maxLength: 32000, description: '附加 JavaScript（可选，以内联 <script> 注入；momoiResize() 在此可用）' },
    height: { type: 'integer', minimum: 64, maximum: 960, description: '初始高度 px（可选，默认 320）' },
  },
  required: ['html'],
  extraValidate: validateAppProps,
}

// ---- 目录 ----

export const cardCatalog: CardComponentSpec[] = [chartSpec, statSpec, tableSpec, diagramSpec, formSpec, appSpec]
