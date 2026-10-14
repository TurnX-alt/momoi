// ============================================================
// db-durability 回归测试 —— node:sqlite driver 迁移的验收核心
// ============================================================
//
// 迁移背景：driver 由 sql.js（内存态 + 30s 定时 export）换成 node:sqlite（每 commit fsync），
// 根治服务器满载挤死进程（OOM/SIGKILL）时的数据丢失。本套件把「已提交数据在进程被强杀后
// 仍保全」这条隐式契约钉成显式门禁——这正是 momoi 生产实战丢失、旧 sql.js 架构无法保证的。
//
// 覆盖：
//   1. kill-9 持久性（头号）：spawn 子进程写盘后 SIGKILL（不可捕获），重开库断言数据仍在
//   2. 外键 OFF 语义对齐：悬空外键 INSERT 成功 + 删 parent 不级联 → 逐字还原旧 sql.js 行为
//   3. 迁移幂等：initSqlite 连跑两次不抛错
//   4. drizzle 层 CRUD 冒烟：insert/returning/select/update/delete + count 聚合
//   5. 现存库连续性：预置标准 SQLite 文件（等价 sql.js 导出物），initSqlite 打开后数据在

import { describe, it, expect, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync, existsSync, statSync } from 'node:fs'
import { eq, and, sql, count, desc } from 'drizzle-orm'
import { initSqlite } from '../src/db/sqlite.js'
import { conversations, messages, users, pushSubscriptions } from '../src/db/schema.sqlite.js'

const here = dirname(fileURLToPath(import.meta.url))
const childFixture = join(here, 'fixtures', 'kill9-child.mjs')

// 测试用临时库路径 + 统一清理（Windows 文件锁：close 句柄后才能删）
const tmpPaths: string[] = []
function tmpDb(): string {
  const p = join(tmpdir(), `momoi_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`)
  tmpPaths.push(p)
  return p
}
afterAll(() => {
  for (const p of tmpPaths) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try { rmSync(p + suffix, { force: true }) } catch { /* Windows 句柄未释放时忽略 */ }
    }
  }
})

const now = () => Math.floor(Date.now() / 1000)

describe('node:sqlite driver 迁移 — 持久性与行为对齐', () => {
  // ── 1. kill-9 持久性（本轮验收核心，直接复刻生产事故）──
  it('进程被 SIGKILL 后，已提交数据仍保全（无需优雅关闭）', async () => {
    const dbPath = tmpDb()

    // spawn 纯 node:sqlite 子进程：写盘 → 打印 WROTE → 挂起等待被杀（绝不 close）
    const child = spawn(process.execPath, [childFixture, dbPath], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })

    const wrote = await new Promise<boolean>((res) => {
      const timer = setTimeout(() => res(false), 20_000)
      child.stdout.on('data', (d: Buffer) => {
        if (d.toString().includes('WROTE')) { clearTimeout(timer); res(true) }
      })
      child.on('exit', () => { clearTimeout(timer); res(false) })
    })
    expect(wrote, '子进程应在超时前完成写入').toBe(true)

    // SIGKILL 不可捕获、不可忽略——最忠实地模拟断电/OOM/kill -9
    child.kill('SIGKILL')
    await new Promise<void>((res) => child.on('exit', () => res()))

    // 重开库断言标记行仍在（数据已由 synchronous=FULL fsync，不依赖子进程 close）
    const verify = new DatabaseSync(dbPath, { readOnly: true })
    const rows = verify
      .prepare(`SELECT content FROM messages WHERE content = 'SURVIVOR_MARKER'`)
      .all() as Array<{ content: string }>
    verify.close()
    expect(rows.length).toBe(1)
    expect(rows[0]?.content).toBe('SURVIVOR_MARKER')
  }, 30_000)

  // ── 2. 外键 OFF 语义对齐（逐字还原旧 sql.js 宽松语义）──
  it('PRAGMA foreign_keys=OFF：悬空外键 INSERT 成功且删 parent 不级联', async () => {
    const { db } = await initSqlite(tmpDb())

    // 确认外键确实是关的（node:sqlite 默认 ON，initSqlite 显式关掉）
    const fk = (db.$client.prepare('PRAGMA foreign_keys').all() as Array<{ foreign_keys: number }>)[0]
    expect(fk?.foreign_keys).toBe(0)

    // 悬空外键 INSERT 应成功（FK OFF）——旧 sql.js 下同样成功
    await db
      .insert(messages)
      .values({ conversation_id: 'GHOST_CONV', role: 'user', content: 'orphan', created_at: now() })
      .run()
    const orphan = await db
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, 'GHOST_CONV'))
      .all()
    expect(orphan.length).toBe(1)

    // 建 parent + child，删 parent 后 child 应残留（FK OFF → CASCADE 不生效）
    await db.insert(conversations).values({
      id: 'p1', user_id: 'alice', title: 't', agent_id: '', type: 'direct',
      created_at: now(), updated_at: now(),
    }).run()
    await db.insert(messages).values({
      conversation_id: 'p1', role: 'user', content: 'child', created_at: now(),
    }).run()
    await db.delete(conversations).where(eq(conversations.id, 'p1')).run()
    const stillThere = await db
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, 'p1'))
      .all()
    expect(stillThere.length, 'FK OFF 下删 parent 不应级联删 child（与 sql.js 一致）').toBe(1)

    db.$client.close()
  })

  // ── 3. 迁移幂等 ──
  it('initSqlite 对同一库连跑两次不抛错（IF NOT EXISTS + try/catch ALTER 幂等）', async () => {
    const p = tmpDb()
    const first = await initSqlite(p)
    first.db.$client.close()
    // 第二次打开同一文件：CREATE TABLE IF NOT EXISTS 与 try/catch ALTER 都应静默通过
    const second = await initSqlite(p)
    const tables = second.db.$client
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>
    second.db.$client.close()
    const names = tables.map((t) => t.name)
    expect(names).toContain('conversations')
    expect(names).toContain('messages')
    expect(names).toContain('worlds')
    expect(names).toContain('workspaces')
  })

  // ── 4. drizzle 层 CRUD 冒烟（237 处调用点的典型形态）──
  it('drizzle query builder 全形态在 node:sqlite 下工作', async () => {
    const { db } = await initSqlite(tmpDb())
    const t = now()

    // insert + returning（momoi 5 处形态）
    await db.insert(conversations).values({
      id: 'c1', user_id: 'alice', title: '测试', agent_id: 'a1', type: 'direct',
      created_at: t, updated_at: t,
    }).run()
    const ins = await db
      .insert(messages)
      .values({ conversation_id: 'c1', role: 'user', content: 'hello', created_at: t })
      .returning({ id: messages.id })
    const msgId = Number(ins[0]?.id ?? 0)
    expect(msgId).toBeGreaterThan(0)

    // select + where + and + eq + get
    const row = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, 'c1'), eq(conversations.user_id, 'alice')))
      .get()
    expect(row?.title).toBe('测试')

    // select + orderBy desc + limit + all
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, 'c1'))
      .orderBy(desc(messages.created_at))
      .limit(20)
      .all()
    expect(msgs.length).toBe(1)

    // count() 聚合
    const c = await db.select({ value: count() }).from(messages).where(eq(messages.conversation_id, 'c1')).get()
    expect(c?.value).toBe(1)

    // update + set + where
    await db.update(conversations).set({ title: '改名了', updated_at: t + 1 }).where(eq(conversations.id, 'c1')).run()
    const upd = await db.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, 'c1')).get()
    expect(upd?.title).toBe('改名了')

    // onConflictDoNothing（幂等）
    await db.insert(users).values({ username: 'alice', pin_hash: '', first_login_at: t, last_login_at: t, banned: false }).onConflictDoNothing().run()
    await db.insert(users).values({ username: 'alice', pin_hash: '', first_login_at: t, last_login_at: t, banned: false }).onConflictDoNothing().run()
    const userCount = await db.select({ value: count() }).from(users).get()
    expect(userCount?.value).toBe(1)

    // onConflictDoUpdate（依赖 pushSubscriptions 的 uniqueIndex 数组回调）
    await db.insert(pushSubscriptions).values({ user_id: 'alice', device_id: 'd1', endpoint: 'e1', p256dh: 'p', auth: 'a', created_at: t }).onConflictDoUpdate({ target: [pushSubscriptions.user_id, pushSubscriptions.device_id], set: { endpoint: 'e2' } }).run()
    await db.insert(pushSubscriptions).values({ user_id: 'alice', device_id: 'd1', endpoint: 'e3', p256dh: 'p', auth: 'a', created_at: t }).onConflictDoUpdate({ target: [pushSubscriptions.user_id, pushSubscriptions.device_id], set: { endpoint: 'e3' } }).run()
    const sub = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.device_id, 'd1')).get()
    expect(sub?.endpoint, '冲突后应更新为 e3').toBe('e3')

    // sql`` 原生片段（软删过滤，momoi 39 处）
    await db.update(conversations).set({ deleted_at: t }).where(eq(conversations.id, 'c1')).run()
    const alive = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.user_id, 'alice'), sql`${conversations.deleted_at} IS NULL`))
      .all()
    expect(alive.length).toBe(0)

    // delete
    await db.delete(messages).where(eq(messages.id, msgId)).run()
    const afterDel = await db.select({ value: count() }).from(messages).get()
    expect(afterDel?.value).toBe(0)

    db.$client.close()
  })

  // ── 5. 现存库连续性（sql.js 导出的标准 SQLite 文件可被 node:sqlite 原地打开）──
  it('预置的标准 SQLite 文件（等价 sql.js 导出物）被 initSqlite 原地接管', async () => {
    const p = tmpDb()

    // 用裸 node:sqlite 预置一个含数据的标准 SQLite 文件（sql.js export() 产出的就是此格式）
    const seed = new DatabaseSync(p)
    seed.exec(`CREATE TABLE conversations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '新对话',
      agent_id TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'direct',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
      last_read_at INTEGER, workspace_id TEXT, stats TEXT
    )`)
    seed.prepare(`INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES ('legacy','bob','历史会话',1700000000,1700000000)`).run()
    seed.close()
    expect(existsSync(p)).toBe(true)
    const sizeBefore = statSync(p).size

    // initSqlite 打开同一文件：历史数据应在，且迁移幂等补全其余表/索引
    const { db } = await initSqlite(p)
    const legacy = await db.select().from(conversations).where(eq(conversations.id, 'legacy')).get()
    expect(legacy?.title).toBe('历史会话')
    expect(legacy?.user_id).toBe('bob')
    // 迁移应已补建 messages 等表（幂等 CREATE IF NOT EXISTS）
    const hasMessages = (db.$client
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='messages'`)
      .all() as Array<{ name: string }>).length
    expect(hasMessages).toBe(1)
    db.$client.close()
    expect(statSync(p).size).toBeGreaterThanOrEqual(sizeBefore)
  })
})
