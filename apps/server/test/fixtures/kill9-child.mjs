// kill-9 持久性测试的子进程 fixture（纯 node:sqlite，不依赖 TS/tsx）。
//
// 流程：打开库 → PRAGMA foreign_keys=OFF（复刻 initSqlite 的设置）→ 建 messages 表 →
// 写入标记行（node:sqlite 同步提交即 fsync）→ 打印 WROTE → 挂起等待被父进程 SIGKILL。
// 刻意不调用 close()：模拟进程被强杀（断电/OOM/kill -9）时没有优雅关闭。
//
// 由 db-durability.test.ts 用 `node fixtures/kill9-child.mjs <dbPath>` spawn。
import { DatabaseSync } from 'node:sqlite'

const dbPath = process.argv[2]
if (!dbPath) {
  process.stderr.write('usage: kill9-child.mjs <dbPath>\n')
  process.exit(2)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys = OFF')
db.exec(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`)
db.prepare(
  `INSERT INTO messages (conversation_id, role, content, created_at) VALUES ('ck','user','SURVIVOR_MARKER', unixepoch())`,
).run()

// 同步提交已 fsync 落盘。通知父进程可以 SIGKILL 了，然后挂起（绝不 close）。
process.stdout.write('WROTE\n')
setTimeout(() => {}, 120_000)
