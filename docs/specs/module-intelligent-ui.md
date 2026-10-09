# Spec — 生成式卡片（Intelligent UI）

## 概述

生成式卡片（Intelligent UI）让模型在聊天流中直接渲染**交互式 UI 组件**（图表、统计卡、表格、流程图，后续扩展表单、沙箱应用、3D 角色），而非仅输出纯文本。采用业界通用的 **Chat Components 范式**：模型经 `ui_*` 工具调用声明卡片（组件名 + 结构化 props，schema 约束）→ 服务端校验并捕获 → SSE `card` 事件推送 + `messages.trace` 持久化 → 前端组件注册表懒加载渲染。范式选择与全部设计决策见 `DECISIONS.md` D54。

**与 markdown 输出的关系**：卡片是 markdown 的补充而非替代——能用一两句话讲清的内容不制卡（片段中有明确指引）；diagram 卡收编既有 mermaid 能力（DSL 原样保留，仅换进料通道，渲染器共享）。

**分期**：M1 = 协议核心 + chart/stat/table/diagram（已实装）；M2 = 交互闭环（form + card-action + 历史注入，已实装）；M3 = IM 渠道 trace 补齐；M4 = 沙箱逃生舱（app）；M5 = 3D 角色卡（character）。分期细节见文末。

## 涉及文件

| 文件 | 职责 |
|---|---|
| `packages/shared/src/types.ts` | `CardComponent` / `CardDescriptor` / `CardActionPayload`；`TraceEntry` card 变体；`ServerMessage` card 事件 |
| `packages/shared/src/constants.ts` | `CARD_ACTION_FENCE`（卡片交互协议围栏） |
| `packages/shared/src/schema-validate.ts` | ToolSchemaProperty 子集通用校验器（`validateToolSchema` / `validateToolObject`） |
| `apps/server/src/tools/ui-cards/catalog.ts` | **单一事实来源**：各组件 spec（工具定义 / 目录行 / 校验器），驱动工具、提示词片段与文档 |
| `apps/server/src/tools/ui-cards/card-tool.ts` | `createCardTool` 工厂：spec → ToolModule；execute 校验 → `{ summary, data: { card } }` |
| `apps/server/src/tools/registry.ts` | 注册全部 `ui_*` 工具 |
| `apps/server/src/ai/pi-adapter.ts` | `tool_execution_end` 捕获 `details.data.card` → trace 条目 + SSE `card` 事件（先于 `tool_result`） |
| `apps/server/src/prompts/fragments/chat.ts` | `chat/ui-cards` 片段（capabilities 层）：组件目录 + 选卡指引 |
| `apps/web/src/components/cards/registry.ts` | 组件注册表：`CardComponent` → 懒加载组件映射 |
| `apps/web/src/components/cards/CardRenderer.tsx` | 渲染入口：查表 + Suspense + 局部错误边界（memo） |
| `apps/web/src/components/cards/CardFrame.tsx` | 统一外壳：圆角边框卡 + 可选标题，`max-w-2xl` |
| `apps/web/src/components/cards/{chart,stat,table,diagram}/` | 四类组件实现（chart 含 `palette.ts` 双模式色板） |
| `apps/web/src/components/chat/MermaidBlock.tsx` | Mermaid 渲染共享块（markdown 围栏路径 + diagram 卡 `bare` 模式） |
| `apps/web/src/components/chat/MessageBubble.tsx` | `groupAndRenderTrace` card 分支；ui_* 工具条目被卡片认领后不进工具栈 |
| `apps/web/src/hooks/useChat.ts` | `handleSSEEvent` card case（含多设备中继复用） |
| `apps/web/src/hooks/useDarkMode.ts` | 观察 `documentElement` 主题 class（图表色板跟随切换） |
| `apps/web/src/i18n/*.json` | `chat.cardRenderFailed` / `chat.cardTableEmpty` / `chat.cardUnsupported` 三语 |

## 接口契约

### ui_* 工具面（M1-M2：5 个）

每个组件族一个工具，全部由 `catalog.ts` 的 spec 生成（工具定义、提示词目录、文档同源，永不漂移）：

| 工具 | 组件 | 必填参数 | 关键约束 |
|---|---|---|---|
| `ui_chart` | chart | `type`（line/bar/pie）, `series`（1-8 条） | series 各条 `data` 长度一致；`labels` 提供时长度须一致；饼图：labels 必填、仅 1 条 series、≤5 类；`stacked`/`horizontal` 仅柱状图；颜色由前端分配，模型不可指定 |
| `ui_stat` | stat | `items`（1-6 项，每项 label+value） | value 为格式化展示字符串；`delta` 数值变化量 + `deltaLabel` 说明 |
| `ui_table` | table | `columns`（1-12 列）, `rows` | 每行单元格数 = 列数；单元格为字符串；≤200 行 |
| `ui_diagram` | diagram | `code`（Mermaid DSL） | 完整源码不含围栏标记；≤8000 字符 |
| `ui_form` | form | `fields`（1-12 个字段） | 字段类型 text/number/textarea/select/multiselect/slider/checkbox/button-group；`name` 为回传键（字母下划线开头、唯一，pattern 约束）；select/multiselect/button-group 必填 `options`（2-8 个）且仅限这三类；min/max/step 仅 slider；提交后内容作为新用户消息回传 |

通用可选参数：`title`（≤60 字符）——执行时提取到 `CardDescriptor.title`（CardFrame 统一渲染），不留在 props。

**执行语义**：
- 校验分两层：Pi 的 TypeBox 层拦 schema 级违规（必填/enum/类型/长度）；execute 层拦**跨字段语义**违规（series 一致性、饼图限制、行列匹配、未知字段）
- 校验失败 → `ToolResult { error: true, summary }`，summary 面向**模型自修复**：字段路径 + 违规原因 + 允许值，模型在下一轮循环中修正
- 成功 → `summary: '已渲染卡片：{label}「{title}」'` + `data: { card: CardDescriptor }`

### SSE `card` 事件

```typescript
| { type: 'card'; id?: string; card: CardDescriptor; agent_id?: string; agent_name?: string }
```

- **发出时机**：`ui_*` 工具执行完成（`tool_execution_end`）后、同一工具调用的 `tool_result` **之前**。运行期实时推送 + 多设备中继（`broadcastStream`）自动覆盖
- 群聊下由编排器自动附加 `agent_id` / `agent_name`（与其他事件一致）
- `id` = 工具调用 ID，与 trace 条目、card-action 回传对位

### 卡片描述符与 trace 持久化

```typescript
interface CardDescriptor {
  component: CardComponent   // 'chart' | 'stat' | 'table' | 'diagram' | 'form' | 'app' | 'character'
  title?: string
  props: Record<string, unknown>
}
```

- 卡片既发 SSE，也即时写入 `RunPiAgentLoopResult.trace` 的 **`{ type: 'card', id?, card }` 条目**（紧随对应 `tool_call` 条目之后）——经 `saveAssistantMsg` 落入 `messages.trace` 列（**零迁移**，复用既有 JSON 列）
- 重放链路：`conversations.ts` parse → `mapServerMessage` → `groupAndRenderTrace` card 分支——刷新会话 / 收尾 reconcile / 多设备切换后卡片确定性重放
- trace 是审计底稿（含全部 ui_* 工具调用），**UI 层认领**：某 tool_call 条目若有同 id 的 card 条目，则不再进工具栈（校验失败无卡片时照常显示错误条目）

### 前端渲染契约

- **注册表**：`cardRegistry` 为 `Partial<Record<CardComponent, …>>`——未注册组件渲染 `chat.cardUnsupported` 错误态，不崩溃
- **懒加载**：严格遵守 Rolldown 硬规则（`lazy(() => import('./X').then(m => ({ default: m.X })))`）；recharts 等重依赖在组件模块内静态 import，随 lazy 边界独立成块（**不得**为此类重依赖配置 manualChunks——Rolldown 会把传递依赖闭包吸入强制块并让入口静态预载）
- **容错**：props 轻校验（非法数据 throw）→ `CardErrorBoundary` 局部降级（单卡失败不影响消息流）
- **图表色板**（dataviz 规范内置）：**颜色不是模型 props**——ChartCard 按 series 顺序从固定色板分配（`CHART_LIGHT`/`CHART_DARK`，与 `globals.css` 的 `--chart-1..8` 同源；双模式均以实际表面色通过 dataviz 校验器）；series ≤8 不循环；无双轴；≥2 序列必有图例（图例文字用墨色，色块承担身份）；饼图直接标注（对比度 relief）
- **数值呈现**：stat 卡大数字用比例字；表格数字列右对齐 + `tabular-nums`（列内纵向对齐场景）

### card-action 围栏协议（M2 已实装）

用户与卡片交互（提交表单/点按钮）时，前端合成**普通用户消息**：一行人类可读摘要（`chat.cardActionSummary(Named)`，UI 语言）+ `CARD_ACTION_FENCE`（```` ```card-action ````）内的 `CardActionPayload` JSON，经既有 `POST /api/chat` 发起新一轮生成（**无新端点**）。围栏是唯一的机器可读载体：模型回喂天然可见、多设备同步免费、零迁移。

实装细节：
- **分发**：FormCard 经模块级 `cardInteractionStore`（`emitCardAction`）调用 `useGroupChat` 注册的 handler——消息流内无 Context 通道可穿透 trace 渲染层，且气泡 key 变化会重挂载，状态必须模块级
- **发送路由**：单聊 `sendMessage`；群聊/世界 `sendGroupMessage` 且合成文本以 `@所属Agent名 ` 开头（置首发言）；**生成中不受理**并轻提示（`sendMessage` 同会话串行锁会静默丢弃）——handler 返回 false 时表单不标记已消费
- **防重复**：提交受理后 `markCardConsumed`（模块级 Set + `useSyncExternalStore` 订阅），控件锁定显示「已提交」；跨气泡重挂载存活（页面刷新后失效，v1 接受）
- **渲染**：user 气泡内围栏由 `MessageContent` 切出（与 mermaid 同模式）→ `CardActionChip` 紧凑 chip（label + payload ≤3 项 key=value 摘要）；解析失败回退原始文本

## 行为约束

### 服务端

1. **捕获点唯一**：卡片仅在 `createEventEmitter` 的 `tool_execution_end` 分支捕获（`details.data.card`）——trace 与 SSE 同一处产出，避免双源漂移
2. **事件顺序保证**：`card` 事件必定先于同 id 的 `tool_result` 到达客户端
3. **校验权威在服务端**：前端轻校验只防崩；模型可见的错误经工具结果通道回传（不上 wire 错误码）
4. **历史卡片感知**：回喂时经 `augmentRowsWithCards()`（`ai/history-cards.ts`）在含卡 assistant 行 content 尾部注入 `[已渲染卡片：{component}「{title}」 id:{id}]` 摘要（标题截 40 字符，不动存储；纯函数无 IO）——初始 history 构建与 reloadHistory 共用
5. **IM 渠道（M3）**：wechat/qq 落库链路补齐 trace 字段后，IM 触发的卡片刷新不丢

### 客户端

1. **SSE 消费**：`useChat` 的 `card` case 从尾向前定位目标 assistant 气泡（群聊按 `agent_id` 匹配）；找不到则丢弃（收尾 reconcile 从 DB 重建兜底）
2. **中继复用**：远程流事件经同一 `handleSSEEvent` 处理——卡片天然多设备同步，无需专门代码
3. **memo**：`CardRenderer` 以 `React.memo` + 稳定的 `card` 对象引用避免流式期间逐帧重渲染（图表尤其敏感）
4. **主题**：图表色板经 `useDarkMode`（MutationObserver 观察 `dark` class）跟随切换
5. **表单卡交互**：必填校验在前端先行（服务端不校验交互值——用户伪造自己的交互事件只影响自己的会话，威胁模型不成立）；提交发射、生成中拦截与已消费锁定见〈card-action 围栏协议〉

## 验收标准

### 自动化：`pnpm --filter @momoi/server test`

- ✅ `schema-validate.test.ts`：通用校验器全子集（嵌套路径/enum/边界/错误封顶）
- ✅ `card-tool.test.ts`：五工具的合法产出与全部拒绝路径（含自修复 summary 格式）
- ✅ `history-cards.test.ts`：注入格式 / 标题截断 / 多卡 / 损坏 JSON / 引用不变
- ✅ `card-sse.test.ts`（伪造 fetch 驱动真实 `runPiAgentLoop`）：card 事件先于 tool_result、载荷完整、校验失败无卡片、一轮多卡、trace 条目紧随 tool_call、tool_call 状态照常回填
- ✅ `golden.test.ts`：`chat/ui-cards` 片段文本锁定 + 四个 `tool.description` 用例 + 结构性 bullet 断言

### 手工 / 端到端（M1）

1. 单聊「画个折线图」→ 卡片随工具执行完成即时出现；thinking/工具栈/卡片/文本按 trace 时序排列；ui_chart 不再出现在工具栈（被卡片认领）
2. 刷新会话 → 卡片仍在（trace 持久化）；从历史长会话中间滚动回看旧卡片正常渲染
3. 群聊成员画卡 → 归属该成员气泡；其他设备实时看到卡片（中继）
4. 弱模型/手写错误参数 → 模型收到自修复 summary 并在下一轮修正（或放弃转文本）
5. network 面板：无图表的会话不加载 recharts；首个图表卡渲染时才拉取 ChartCard chunk
6. 暗色/亮色切换 → 图表配色切换、对比度正常；饼图直接标注、柱状图圆角、折线 2px
7. 历史消息含未知组件名（手工构造）→ 渲染「暂不支持的卡片类型」而非崩溃

### 分期验收（M2-M5）

- **M2（已实装）**：模型出表单 → 填写提交 → 历史出现交互 chip → 新一轮正确引用表单值；「把刚才的柱状图改成折线」成功（历史注入生效）；双击提交只触发一轮；已消费卡片控件禁用；生成中提交被 toast 拦下且表单不被锁定；群聊卡片按钮 → @所属成员置首回应
- **M3**：微信/QQ 触发画卡 → web 侧实时可见且刷新仍在；回退掉卡片所在消息后卡片随消息消失
- **M4**：自包含 HTML 计数器可交互 + 自动高度；外部 fetch 被 CSP 阻断；>64KB 拒绝并自修复；主题切换正确；消息卸载 iframe 销毁
- **M5**：VRM 模型加载 + idle 动画；切换 animation 生效；无 WebGL 优雅降级；three chunk 仅 3D 卡首次渲染拉取

## 预留错误码（不注册进 errors.ts，启用时再登记）

| 码 | HTTP | 场景 |
|---|---|---|
| `CHAT_CARD_NOT_FOUND` | 404 | card-action 目标卡片不存在（若未来启用服务端校验端点） |
| `CHAT_CARD_ACTION_INVALID` | 400 | 围栏负载校验失败 |
| `CHAT_CARD_ACTION_CONSUMED` | 410 | 卡片动作重复提交 |

v1 零新增错误码：工具级错误走 `ToolResult.error`（模型反馈通道），前端渲染失败走局部边界 + i18n。
