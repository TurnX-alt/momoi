# Spec — 世界模拟（World Simulation）

## 概述

世界模拟是纯文本群聊的变体（`conversations.type = 'world'`）：用户以「世界叙事者」身份描述变动，一群 Agent 作为世界中的存在回应。世界不需要额外描述——Agent 的人设就是身份，法则就是约束，**状态就是事实**。

世界有两个可变维度：

- **法则**（`worlds.laws`）：世界中所有存在都必须遵守的最高规则，每轮注入系统提示。
- **状态**（`worlds.states` / `worlds.state_values`）：一组贯穿会话的属性定义（属性名/默认值/描述）与每个成员各自的当前值，随世界中的事件变化。

**核心不变量**：

- **默认没有任何状态**：未定义状态的世界，提示词 / 工具 / 结算 / 卡片全部零行为变化（既有黄金快照逐字不变）。
- **状态的读写与卡片构建只经 `lib/world-state.ts` 一处实现**，三条变更路径（路由手动修正 / update_state 工具 / 轮末结算）共用 `applyChanges`。
- **有变化必有卡**：全部变更以 component='state' 的变更卡呈现（第 8 种生成式卡片，引擎合成）。
- 世界会话仅限网页版（IM 渠道没有世界入口，无需闸门）。

### 状态语义

- 值统一为**显示字符串**（≤60 字符、单行、禁「|」——轮末结算的行解析格式护栏；数值语义由前端按可解析性自行呈现）。
- **默认值仅用于初始化**；读取时以「对账视图」呈现——按当前成员过滤、缺属性补默认。
- **编辑定义 = 全量替换 + 就地持久对账**：新增属性全员补默认；删除属性随成员行重建丢弃；**改名 = 删 + 建、值重置**（无稳定 attr id，spec 显式写明）；非成员的历史值保留在存储中（重新加回即恢复，读取时过滤）。
- **变更双轨**：角色 Agent 经 `update_state` 工具即时修改（自己 / 他人均可，绝对新值）；轮末由中立 Agent 以「世界裁决者」身份复核补结算（可修正与叙事明显不符的夸张改动）。两侧均对 no-op（新值 == 当前值）静默跳过。

## 涉及文件

| 文件 | 职责 |
|---|---|
| `apps/server/src/lib/world-state.ts` | **唯一实现**：解析容错 / 对账视图 / 编辑持久对账 / 定义与值校验 / `applyChanges` 落库与变更卡构建 / trace 卡片追加 |
| `apps/server/src/routes/worlds.ts` | 世界创建 / 读取 / 编辑（法则 + 状态定义 + 当前值手动修正） |
| `apps/server/src/routes/chat.ts` | 草稿建会（`world_laws` / `world_states`）、轮末 `settleWorldState` 后台任务 |
| `apps/server/src/tools/world-state-tool.ts` | `update_state` 工具（仅世界会话且已定义状态时动态注入） |
| `apps/server/src/ai/neutral-agent.ts` | `generateWorldStateSettlement`（世界裁决者，行级容错解析） |
| `apps/server/src/prompts/fragments/chat.ts` | `chat/world-scene`（法则与参与方式）/ `chat/world-state`（状态块） |
| `apps/server/src/prompts/fragments/neutral.ts` | `neutral.world-state.system / .user` 配方 |
| `apps/server/src/ai/group-orchestrator.ts` | 每 Agent 重取运行态快照 + 状态句柄注入 |
| `apps/web/src/components/cards/state/StateCard.tsx` | 第 8 卡型 'state' 渲染（只读变更列表） |
| `apps/web/src/components/sidebar/WorldStatesFields.tsx` | 状态定义编辑器（创建 / 编辑共用） |
| `apps/web/src/components/sidebar/LawsEditor.tsx` | 「编辑世界」双分页（法则｜状态 + 当前值手动修正） |
| `apps/web/src/hooks/useChat.ts` / `useGroupChat.ts` | 草稿链路（world_states）、`realtime:world_state` 刷新 |
| `packages/shared/src/types.ts` | `WorldStateDef` / `WorldStateValues` / `WorldStateRuntime` / `WorldStateRow` / `WorldStatePromptView` / `WorldInfo` |

## 接口契约

### POST /api/worlds（创建）

请求：`{ laws?, states?, agent_ids, title?, workspace_id? }`（`states` 缺省 = `[]`）

- `states` 校验失败 → 400 `WORLD_STATES_INVALID`（params.detail = 原因摘要）
- 至少 1 个成员（`WORLD_AGENTS_REQUIRED`）；创建即就绪（同步落库，无异步生成）

响应（201）：`{ conversation, world }`——`world` 为解析 JSON 列 + 对账视图后的形态
（`laws / states / state_values`）。

### GET /api/worlds/:id

响应：`{ world, agents }`——agents 为成员名册（`id / name / avatar`，按 sort_order）；
不存在 / 他人所有 / 已软删统一 404 `WORLD_NOT_FOUND`（防探测）。

### PATCH /api/worlds/:id（编辑世界）

请求：`{ laws?, states?, values? }`——三个可变项任选：

- 全空 → 400 `WORLD_NOTHING_TO_UPDATE`
- `laws`：字符串，trim + 截断 2000
- `states`：定义**全量替换** + 就地持久对账（见〈状态语义〉）；校验失败 → 400 `WORLD_STATES_INVALID`
- `values`：`{agentId: {属性名: 值}}` 部分合并（手动修正）；校验失败 → 400 `WORLD_STATE_VALUE_INVALID`
  （成员必须存在、属性必须已定义、值 ≤60 字符且单行不含「|」）

响应：`{ world }`（编辑后的对账视图）。

### POST /api/chat（世界草稿建会）

body 增 `world_laws` / `world_states`（仅新建世界会话时生效）。`world_states` 校验失败以
SSE `error`（`WORLD_STATES_INVALID`）终止——不创建出半成品世界。

### update_state 工具（动态注入）

仅世界会话且 `states` 非空时经 `createToolAdapter` 注入（仿 at_mention 的动态工具模式）。

- 输入 `changes`（1-4 条）：`agent`（成员名，大小写不敏感精确匹配）/ `attribute`（已定义属性）/ `value`（**绝对新值**，字符串，数值也写成字符串）/ `reason?`（≤60 字）
- 失败走 `ToolResult.error` 自修复通道（列出合法成员 / 属性、值护栏）
- 成功返回**含变更正文的 summary**（模型只看得到 summary） + `data.card`（component='state'），
  走既有卡片捕获链路（trace + SSE；工具条目被卡片认领隐藏——认领按 id 匹配、与工具名无关）

### 轮末状态结算（settleWorldState）

- 仅世界会话且已定义状态时执行；30s 超时、失败开放（绝不打断主循环）
- **非无限模式**与 suggestions 并行（`Promise.all`）；**无限模式每轮轮内结算**
  （下一轮提示词与 follow_up 必须看到最新值）
- 解析行格式 `成员名 | 属性名 | 新值 | 原因`——行级容错：剥围栏 / bullet / 编号 / 包裹引号；
  原因从第四段起并回「|」；`无` = 不变；上限 30 行；未知成员 / 属性 / 非法值静默丢弃
- **零变更静默**（不发卡不发事件）；有变更 → 先落库（trace 追加合成卡）再发 SSE `card`
  （`agent_id` = 本轮最后发言者，`id` 缺省）

### SSE 与实时刷新

- 状态卡复用既有 `card` 事件（`ServerMessage`）——跨设备中继自动覆盖
- 客户端收到 `component === 'state'` 的卡片时派发 `window` 事件 `realtime:world_state`
  （`detail.conversation_id`；气泡未命中时同样派发）；`useGroupChat` 监听并**去抖 600ms**
  重拉 `GET /api/worlds/:id` 刷新 `worldInfo`（状态面板 / 编辑器的数据源）

## 数据库 Schema

worlds 表（与 conversations 1:1）：

| 列 | 说明 |
|---|---|
| `laws` TEXT NOT NULL DEFAULT '' | 世界法则（每轮注入系统提示） |
| `states` TEXT（可空） | JSON `WorldStateDef[]`（状态定义）；NULL / 缺省 = 无状态 |
| `state_values` TEXT（可空） | JSON `{agentId: {属性名: 值}}`（当前值）；NULL / 缺省 = 全默认 |
| `created_at` / `updated_at` INTEGER | Unix epoch（秒） |

迁移：`db/ddl.ts`（新库）+ `db/sqlite.ts` 幂等 ALTER（**无 DEFAULT**，旧库 NULL 由 lib 统一
容错，跟随 `conversations.stats` 先例）+ `db/pg.ts` `ADD COLUMN IF NOT EXISTS` + 两侧 drizzle
schema 同步。

**约束**：属性 ≤12 个；属性名 ≤20 字且唯一、不含「|」与换行；描述 ≤100 字（不含换行）；
默认值与值 ≤60 字符、单行、不含「|」。

## 行为约束

1. **默认无状态 = 零行为变化**：无 states 时 `chat/world-state` 片段不注入、update_state
   不注入、结算直接返回——提示词与既有行为逐字不变。
2. **单一实现**：状态的全部读写与卡片构建只经 `lib/world-state.ts`；路由 / 工具 / 结算
   三条路径共用 `applyChanges`（含 no-op 静默与落库）。
3. **同轮新鲜度**：编排器在每 Agent 执行前重取运行态快照（`loadWorldState`）——同轮内
   后续 Agent 能看到前序 update_state 的改动；`applyChanges` 落库后就地刷新共享上下文
   （同一 Agent 循环内连续调用不落旧快照）。
4. **全员可见**：每个 Agent 的提示词注入全部成员的当前值表。
5. **解析必须宽容**：`states` / `state_values` 列可能为 NULL（旧库补列）、损坏 JSON 或
   手改数据——解析层过滤丢弃非法条目，绝不抛出。
6. **轮末结算的身份锚定**：中立 Agent 以「世界裁决者」身份运行（不做角色扮演、不模仿
   角色语气）；刻意**不接额外指示**（`neutral/extra-instruction` 不覆盖该配方）——保证
   结构化输出不被中立 Agent 的 DB 人设污染。
7. **防仿写**：`chat/world-state` 片段明令禁止模型自写状态卡内容与「[已渲染卡片]」标注行；
   结算不要求模型输出卡片 JSON（卡片由引擎合成）。
8. **结算卡持久化**：引擎合成卡以 `{type:'card', id:undefined}` 追加到末条 assistant 消息
   的 trace——刷新 / 多设备重放与工具卡同构（渲染 key 回退已覆盖）。
9. **末条消息跟踪为轮内作用域**：`lastAssistantMsgId / lastAssistantAgentId /
   lastAssistantHadSuggestions` 每轮开始前重置——suggestions 与结算只挂本轮（消除末位
   Agent 空回复时挂到上一轮的隐患）。
10. **编辑界面草稿保护**：「编辑世界」对话框仅在打开瞬间对齐服务端值，打开期间的状态卡
   刷新（worldInfo 更新）不清掉正在编辑的草稿。

## 验收标准

1. 创建带状态的世界 → 系统提示注入属性定义 + 全员默认值；未定义状态的世界零变化
2. 角色调用 update_state → 变更卡即现、值即时落库 → 同轮后续 Agent 提示词可见新值
3. 轮末结算补充 / 修正变化 → 结算卡；零变更静默；失败 / 超时不打断主循环
4. 刷新会话 / 切换设备 → 两类状态卡从 trace 确定性重放
5. 编辑定义：删属性清值、加属性全员补默认、改名值重置；非成员历史值保留
6. 手动改值即时生效（PATCH values），非法成员 / 属性被 400 拒绝
7. 无状态世界的黄金快照与工具面逐字不变（回归）
8. 自动化：`world-state.test.ts`（解析 / 对账 / 校验 / 卡片）+ `preview.test`（归化）
   + golden（`world-with-states`、`neutral.world-state.*`）+ `scripts/test-world-state-e2e.ts`
   （内存级 E2E，19 断言）

## 相关

- 决策记录：`docs/DECISIONS.md` D60
- 卡片协议：`docs/specs/module-intelligent-ui.md`（〈引擎合成卡（第二来源）〉）
- 提示词配方：`docs/specs/module-prompt-engine.md`
- 工具面：`docs/specs/module-tool-system.md`（update_state）
