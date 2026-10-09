// 一次性内存级 E2E：世界状态（定义 / 当前值 / 校验 / 对账 / 变更卡落库往返）。
// 运行：npx tsx scripts/test-world-state-e2e.ts --stand-alone
// 不触发 persist（不 sleep / 不发信号），测试数据随进程退出蒸发，不落盘。
import { Hono } from 'hono'
import { worldsRoute } from '../src/routes/worlds.js'
import { registerErrorHandlers } from '../src/lib/errorHandler.js'
import { db, agents } from '../src/db/index.js'
import { loadWorldState, applyChanges } from '../src/lib/world-state.js'

// 子路由实例需要自己挂错误收口（正式挂载在主 app 的 onError 不在此实例上）
registerErrorHandlers(worldsRoute as unknown as Hono)

const JSONHeaders = { 'content-type': 'application/json' }
let passed = 0, failed = 0

async function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 300) : '') }
}

// ---- 造两个真实 Agent（成员名册解析/响应需要真名） ----
const now = Math.floor(Date.now() / 1000)
await db.insert(agents).values([
  { id: 'e2e-a1', name: '红豆', created_at: now },
  { id: 'e2e-a2', name: '椰子', created_at: now },
]).run()

const DEFS = [
  { name: '生命值', default: '100', description: '身体的健康程度' },
  { name: '体温', default: '36.5℃' },
]

// ---- 创建（带状态定义） ----
console.log('[创建世界（带状态定义）]')
let r = await worldsRoute.request('/', {
  method: 'POST',
  headers: JSONHeaders,
  body: JSON.stringify({ laws: '  法则一：世界只有夜晚。  ', agent_ids: ['e2e-a1', 'e2e-a2'], states: DEFS }),
})
check('POST 带 states → 201', r.status === 201, r.status)
let body = await r.json()
const convId = body.conversation.id
check('laws 已 trim', body.world.laws === '法则一：世界只有夜晚。', body.world.laws)
check('states 回显（含描述）', JSON.stringify(body.world.states) === JSON.stringify(DEFS), body.world.states)
check('state_values 全员填默认（对账视图）',
  body.world.state_values['e2e-a1']?.['生命值'] === '100' && body.world.state_values['e2e-a2']?.['体温'] === '36.5℃',
  body.world.state_values)

r = await worldsRoute.request('/', {
  method: 'POST', headers: JSONHeaders,
  body: JSON.stringify({ agent_ids: ['e2e-a1'], states: [{ name: 'a', default: '1' }, { name: 'a', default: '2' }] }),
})
body = await r.json()
check('定义重名 → 400 WORLD_STATES_INVALID（detail 含重复）',
  r.status === 400 && body.code === 'WORLD_STATES_INVALID' && String(body.params?.detail).includes('重复'),
  { status: r.status, body })

r = await worldsRoute.request('/', {
  method: 'POST', headers: JSONHeaders,
  body: JSON.stringify({ agent_ids: ['e2e-a1'], states: [{ name: 'a|b', default: '1' }] }),
})
check('属性名含「|」→ 400', r.status === 400 && (await r.json()).code === 'WORLD_STATES_INVALID', r.status)

r = await worldsRoute.request('/', {
  method: 'POST', headers: JSONHeaders,
  body: JSON.stringify({ agent_ids: [], states: DEFS }),
})
check('无成员 → 400 WORLD_AGENTS_REQUIRED', r.status === 400 && (await r.json()).code === 'WORLD_AGENTS_REQUIRED', r.status)

// ---- 读取（对账视图 + 成员名） ----
console.log('[读取]')
r = await worldsRoute.request(`/${convId}`, { method: 'GET' })
body = await r.json()
check('GET → states / state_values / agents 齐全',
  body.world.states.length === 2 && body.world.state_values['e2e-a1']['生命值'] === '100' &&
  body.agents.map((a: any) => a.name).join(',') === '红豆,椰子',
  { states: body.world.states, agents: body.agents })

r = await worldsRoute.request('/00000000-0000-0000-0000-000000000000', { method: 'GET' })
check('GET 不存在 → 404 WORLD_NOT_FOUND', r.status === 404 && (await r.json()).code === 'WORLD_NOT_FOUND', r.status)

// ---- 手动修正当前值 ----
console.log('[手动修正当前值]')
r = await worldsRoute.request(`/${convId}`, {
  method: 'PATCH', headers: JSONHeaders,
  body: JSON.stringify({ values: { 'e2e-a1': { 生命值: 78 } } }),
})
body = await r.json()
check('PATCH values → 200 且就近返回 78 / 对方仍默认',
  r.status === 200 && body.world.state_values['e2e-a1']['生命值'] === '78' && body.world.state_values['e2e-a2']['生命值'] === '100',
  body.world?.state_values)

r = await worldsRoute.request(`/${convId}`, {
  method: 'PATCH', headers: JSONHeaders,
  body: JSON.stringify({ values: { ghost: { 生命值: '1' } } }),
})
check('非成员 → 400 WORLD_STATE_VALUE_INVALID', r.status === 400 && (await r.json()).code === 'WORLD_STATE_VALUE_INVALID', r.status)

r = await worldsRoute.request(`/${convId}`, {
  method: 'PATCH', headers: JSONHeaders,
  body: JSON.stringify({ values: { 'e2e-a1': { 不存在: '1' } } }),
})
check('未定义属性 → 400', r.status === 400 && (await r.json()).code === 'WORLD_STATE_VALUE_INVALID', r.status)

// ---- 编辑定义（全量替换 + 就地持久对账） ----
console.log('[编辑定义（全量替换 + 就地持久对账）]')
r = await worldsRoute.request(`/${convId}`, {
  method: 'PATCH', headers: JSONHeaders,
  body: JSON.stringify({ states: [{ name: '生命值', default: '100' }, { name: '精神健康', default: '90' }] }),
})
body = await r.json()
check('删体温 / 加精神健康：体温值清除、精神补默认、生命值保留 78',
  r.status === 200 &&
  body.world.state_values['e2e-a1']['体温'] === undefined &&
  body.world.state_values['e2e-a1']['精神健康'] === '90' &&
  body.world.state_values['e2e-a1']['生命值'] === '78',
  body.world?.state_values)

r = await worldsRoute.request(`/${convId}`, { method: 'PATCH', headers: JSONHeaders, body: JSON.stringify({ laws: '新法则' }) })
check('仅改法则 → 200', r.status === 200 && (await r.json()).world.laws === '新法则', r.status)

r = await worldsRoute.request(`/${convId}`, { method: 'PATCH', headers: JSONHeaders, body: JSON.stringify({}) })
check('空 body → 400 WORLD_NOTHING_TO_UPDATE', r.status === 400 && (await r.json()).code === 'WORLD_NOTHING_TO_UPDATE', r.status)

// ---- lib 落库往返（applyChanges = update_state 工具与轮末结算的共用实现） ----
console.log('[applyChanges 落库往返]')
const ctx = await loadWorldState(convId)
check('loadWorldState：成员/定义/对账视图齐全',
  !!ctx && ctx.members.length === 2 && ctx.defs.length === 2 && ctx.view['e2e-a1']['生命值'] === '78',
  ctx && { defs: ctx.defs, view: ctx.view })

const applied1 = await applyChanges(ctx!, [{ agentId: 'e2e-a1', attribute: '生命值', value: '50', reason: '落石' }], '状态变化')
check('applyChanges → applied 1 + 变更卡（component=state，from/to 正确）',
  applied1.applied.length === 1 && applied1.card?.component === 'state' &&
  (applied1.card.props as any).changes[0].from === '78' && (applied1.card.props as any).changes[0].to === '50',
  applied1)

const applied2 = await applyChanges(ctx!, [{ agentId: 'e2e-a1', attribute: '生命值', value: '50' }], '状态变化')
check('同值再应用 → applied 0（no-op 静默）', applied2.applied.length === 0 && applied2.card === undefined, applied2)

const reloaded = await loadWorldState(convId)
check('重载后 50 已持久化', reloaded?.view['e2e-a1']['生命值'] === '50', reloaded?.view)

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
// 测试数据仅存于本进程内存（未触发 persist / 未发信号），随退出蒸发，不落盘
process.exit(failed > 0 ? 1 : 0)
