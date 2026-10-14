// ============================================================
// auth-ban 回归测试 —— 封禁即时生效（吊销漏洞的门禁）
// ============================================================
//
// 修复的漏洞：`verifyUserToken` 只验签不查 `users.banned`，导致管理员封禁用户后，
// 该用户手上已签发的 JWT 仍能访问全部受保护 API 最长 14 天（module-auth.md 旧 L85
// 曾明文记载「封禁账号的 token 验证通过」）。JWT 无状态、签发后无法吊销，故只能
// 在中间件层逐请求二次查库。
//
// 返回码刻意用 401（非语义更贴切的 403 USER_DISABLED）：前端只对 401 触发会话驱逐
// （api.ts 的 handleAuthOn401），用户被清回登录页后再试登录，/verify 才返回 403
// USER_DISABLED 告知原因。若中间件返 403，用户会卡在「看似登录但每个请求都失败」。
//
// 测试用真实 temp node:sqlite 库（经 initSqlite 的 dbPath 注入口），但把
// `db/index.js` mock 掉——后者顶层 await 会建真实的 data/momoi.db，直接 import
// 会污染开发库（这也是 momoi 其余测试刻意绕开 db 的原因）。

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

// 测试固定 JWT 密钥（非空 → auth.ts 的 getSecret() 直接用它，不查 settings 表）
const TEST_SECRET = 'test-secret-for-auth-ban-suite-32bytes!'
const ADMIN_NAME = 'root'
const USER_NAME = 'alice'
const COOKIE = 'momoi_token'

// ---- hoisted holder：vi.mock 被提升，必须先声明 ----
const h = vi.hoisted(() => ({
  mod: {} as Record<string, unknown>,
}))

// db/index.js → 转发到 holder（getter 保证 beforeAll 里赋值后可见）
vi.mock('../src/db/index.js', () =>
  new Proxy(
    {},
    {
      get: (_t, prop: string) => h.mod[prop],
      has: (_t, prop: string) => prop in h.mod,
    },
  ),
)

// config.js → 固定 ADMIN 名单与 JWT_SECRET（切断它对 db/index.js 的顶层 import）
vi.mock('../src/lib/config.js', () => ({
  env: { ADMIN: ['root'], JWT_SECRET: TEST_SECRET, OPENAI_BASE_URL: '', OPENAI_API_KEY: '', OPENAI_MODEL: '', PORT: 0 },
}))

// standalone.js → 正常多用户模式（封禁检查只在非 standalone 下生效）
vi.mock('../src/lib/standalone.js', () => ({ STAND_ALONE: false }))

let dbPath = ''

beforeAll(async () => {
  dbPath = join(tmpdir(), `momoi_authban_${Date.now()}_${Math.random().toString(36).slice(2)}.db`)
  // initSqlite 不 import db/index.js（只 import schema + paths），可直接调用真实实现
  const { initSqlite } = await import('../src/db/sqlite.js')
  const { db, schema } = await initSqlite(dbPath)
  Object.assign(h.mod, { db, ...schema })
})

afterAll(() => {
  try { rmSync(dbPath, { force: true }) } catch { /* Windows 句柄锁 */ }
})

// ---- 被测模块（在 mock 之后 import）----
const { signUserToken, isUserBanned, adminAuthMiddleware } = await import('../src/lib/auth.js')
const { userAuthMiddleware } = await import('../src/middleware/userAuth.js')
const { registerErrorHandlers } = await import('../src/lib/errorHandler.js')

// ---- 脚手架 ----

/** 建一个挂好全局错误收口的最小 app，用真实 wire 契约 { code } 断言 */
function buildApp(mw: typeof userAuthMiddleware) {
  const app = new Hono()
  registerErrorHandlers(app)
  app.use('/api/*', mw)
  app.get('/api/ping', (c) => c.json({ userId: c.get('userId') }))
  return app
}

async function seedUser(username: string, banned: boolean) {
  const { db, users } = h.mod as { db: any; users: any }
  const now = Math.floor(Date.now() / 1000)
  await db
    .insert(users)
    .values({ username, pin_hash: '', first_login_at: now, last_login_at: now, banned })
    .onConflictDoUpdate({ target: users.username, set: { banned } })
    .run()
}

async function setBanned(username: string, banned: boolean) {
  const { db, users } = h.mod as { db: any; users: any }
  await db.update(users).set({ banned }).where(eq(users.username, username)).run()
}

async function callAs(app: Hono, token: string | null) {
  const headers: Record<string, string> = {}
  if (token) headers.cookie = `${COOKIE}=${token}`
  const res = await app.request('/api/ping', { headers })
  let body: any = null
  try { body = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, body }
}

describe('isUserBanned — 封禁状态查询', () => {
  it('未封禁用户 → false', async () => {
    await seedUser(USER_NAME, false)
    expect(await isUserBanned(USER_NAME)).toBe(false)
  })

  it('已封禁用户 → true', async () => {
    await seedUser(USER_NAME, true)
    expect(await isUserBanned(USER_NAME)).toBe(true)
    await setBanned(USER_NAME, false) // 还原
  })

  it('用户不存在 → false（不阻断，缺失账号由后续逻辑判定）', async () => {
    expect(await isUserBanned('nobody-here')).toBe(false)
  })
})

describe('userAuthMiddleware — 封禁即时生效', () => {
  const app = buildApp(userAuthMiddleware)

  it('有效 token + 未封禁 → 放行且注入 userId', async () => {
    await seedUser(USER_NAME, false)
    const { token } = await signUserToken(USER_NAME)
    const r = await callAs(app, token)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ userId: USER_NAME })
  })

  it('★ 有效 token + 已封禁 → 401 AUTH_INVALID_TOKEN（本漏洞的回归门禁）', async () => {
    await setBanned(USER_NAME, true)
    const { token } = await signUserToken(USER_NAME)
    const r = await callAs(app, token)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ code: 'AUTH_INVALID_TOKEN' })
    await setBanned(USER_NAME, false)
  })

  it('★ 封禁在 token 签发之后发生 → 同一个 token 立刻失效（漏洞核心场景）', async () => {
    await seedUser(USER_NAME, false)
    const { token } = await signUserToken(USER_NAME)

    // 封禁前：同一 token 可访问
    expect((await callAs(app, token)).status).toBe(200)

    // 管理员封禁 —— 无需轮换 JWT_SECRET、无需等 14 天过期
    await setBanned(USER_NAME, true)

    // 封禁后：同一 token 立刻被拒
    const after = await callAs(app, token)
    expect(after.status).toBe(401)
    expect(after.body).toEqual({ code: 'AUTH_INVALID_TOKEN' })

    // 解封后：同一 token 恢复可用（证明拦截点就是 banned，而非 token 本身失效）
    await setBanned(USER_NAME, false)
    expect((await callAs(app, token)).status).toBe(200)
  })

  it('无 token → 401 UNAUTHORIZED（与封禁路径可区分）', async () => {
    const r = await callAs(app, null)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ code: 'UNAUTHORIZED' })
  })

  it('无效/伪造 token → 401 AUTH_INVALID_TOKEN', async () => {
    const r = await callAs(app, 'not-a-real-jwt')
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ code: 'AUTH_INVALID_TOKEN' })
  })
})

describe('adminAuthMiddleware — ADMIN 名单与 banned 是两个独立维度', () => {
  const app = buildApp(adminAuthMiddleware)

  it('管理员 + 未封禁 → 放行', async () => {
    await seedUser(ADMIN_NAME, false)
    const { token } = await signUserToken(ADMIN_NAME)
    const r = await callAs(app, token)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ userId: ADMIN_NAME })
  })

  it('★ 管理员但已封禁 → 401（banned 优先于 ADMIN 名单）', async () => {
    await setBanned(ADMIN_NAME, true)
    const { token } = await signUserToken(ADMIN_NAME)
    const r = await callAs(app, token)
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ code: 'AUTH_INVALID_TOKEN' })
    await setBanned(ADMIN_NAME, false)
  })

  it('非管理员（未封禁）→ 403 AUTH_FORBIDDEN（与 401 可区分）', async () => {
    await seedUser(USER_NAME, false)
    const { token } = await signUserToken(USER_NAME)
    const r = await callAs(app, token)
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ code: 'AUTH_FORBIDDEN' })
  })
})
