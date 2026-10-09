// ============================================================
// Momoi — 受限公式 DSL（表单卡本地计算）
// ============================================================
// 设计约束（DECISIONS D55）：
// · 不用 eval / Function —— 手写词法 + 递归下降，产物只有算术，天然无注入面
// · 语法刻意极小：数字、字段引用、+ - * / ^、括号、一元负号、
//   ROUND(expr[, digits])、LOOKUP(字段, 表名)
// · 服务端在声明期用 parseFormula 校验（语法 / 未知字段 / 未知表 → 自修复）；
//   浏览器端用同一份实现求值——单源同构，杜绝双实现漂移
// · 求值失败（字段缺值 / 非数值 / 除零 / 查无键）一律返回 null——
//   UI 显示占位符，绝不抛错、绝不让半成品数值上屏

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'field'; name: string }
  | { kind: 'lookup'; field: string; table: string }
  | { kind: 'round'; arg: FormulaNode; digits: number }
  | { kind: 'neg'; arg: FormulaNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: FormulaNode; right: FormulaNode }

export interface FormulaRefs {
  /** 公式引用的字段名（去重，出现顺序） */
  fields: string[]
  /** LOOKUP 引用的数据表名（去重，出现顺序） */
  tables: string[]
}

export type FormulaParseResult =
  | { ok: true; ast: FormulaNode; refs: FormulaRefs }
  | { ok: false; error: string }

// ---- 词法 ----

interface Token {
  type: 'num' | 'ident' | 'op'
  value: string
  pos: number
}

const IDENT_START = /[A-Za-z_]/
const IDENT_CHAR = /[A-Za-z0-9_]/

function tokenize(src: string): { tokens: Token[] } | { error: string } {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i
      while (i < src.length && /[0-9.]/.test(src[i])) i++
      const text = src.slice(start, i)
      if (!/^(\d+(\.\d+)?|\.\d+)$/.test(text)) return { error: `位置 ${start}：「${text}」不是合法数字` }
      tokens.push({ type: 'num', value: text, pos: start })
      continue
    }
    if (IDENT_START.test(ch)) {
      const start = i
      while (i < src.length && IDENT_CHAR.test(src[i])) i++
      tokens.push({ type: 'ident', value: src.slice(start, i), pos: start })
      continue
    }
    if ('+-*/^(),'.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i })
      i++
      continue
    }
    return { error: `位置 ${i}：意外的字符「${ch}」` }
  }
  return { tokens }
}

// ---- 递归下降解析 ----
// 优先级（低→高）：+ -  <  * /  <  一元负号  <  ^（右结合）  <  原子

class ParsingError extends Error {}

function parse(src: string): FormulaParseResult {
  const lex = tokenize(src)
  if ('error' in lex) return { ok: false, error: lex.error }
  const tokens = lex.tokens
  if (tokens.length === 0) return { ok: false, error: '公式为空' }

  let pos = 0
  const fields = new Set<string>()
  const tables = new Set<string>()
  const peek = (): Token | undefined => tokens[pos]
  const eat = (value: string): boolean => {
    const t = peek()
    if (t && t.type === 'op' && t.value === value) {
      pos++
      return true
    }
    return false
  }
  const expectIdent = (msg: string): string => {
    const t = peek()
    if (!t || t.type !== 'ident') throw new ParsingError(t ? `位置 ${t.pos}：${msg}` : msg)
    pos++
    return t.value
  }

  function parseExpr(): FormulaNode {
    let left = parseTerm()
    for (;;) {
      if (eat('+')) left = { kind: 'binary', op: '+', left, right: parseTerm() }
      else if (eat('-')) left = { kind: 'binary', op: '-', left, right: parseTerm() }
      else return left
    }
  }

  function parseTerm(): FormulaNode {
    let left = parseUnary()
    for (;;) {
      if (eat('*')) left = { kind: 'binary', op: '*', left, right: parseUnary() }
      else if (eat('/')) left = { kind: 'binary', op: '/', left, right: parseUnary() }
      else return left
    }
  }

  function parseUnary(): FormulaNode {
    if (eat('-')) return { kind: 'neg', arg: parseUnary() }
    if (eat('+')) return parseUnary()
    return parsePower()
  }

  function parsePower(): FormulaNode {
    const base = parsePrimary()
    if (eat('^')) {
      // 右结合（2^3^2 = 2^(3^2)），指数侧允许一元负号（2^-3）
      return { kind: 'binary', op: '^', left: base, right: parseUnary() }
    }
    return base
  }

  function parsePrimary(): FormulaNode {
    const t = peek()
    if (!t) throw new ParsingError('表达式不完整（末尾缺少操作数）')
    if (t.type === 'num') {
      pos++
      return { kind: 'num', value: Number(t.value) }
    }
    if (t.type === 'ident') {
      pos++
      const up = t.value.toUpperCase()
      if (up === 'ROUND' || up === 'LOOKUP') {
        if (!eat('(')) throw new ParsingError(`位置 ${t.pos}：${up} 后应跟「(」`)
        if (up === 'LOOKUP') {
          const f = expectIdent('LOOKUP 第一个参数应为字段名')
          if (!eat(',')) throw new ParsingError('LOOKUP(field, table)：缺少「,」')
          const tb = expectIdent('LOOKUP 第二个参数应为数据表名')
          if (!eat(')')) throw new ParsingError('LOOKUP(...) 缺少「)」')
          fields.add(f)
          tables.add(tb)
          return { kind: 'lookup', field: f, table: tb }
        }
        const arg = parseExpr()
        let digits = 2
        if (eat(',')) {
          const n = peek()
          if (!n || n.type !== 'num' || !/^\d+$/.test(n.value)) {
            throw new ParsingError('ROUND 第二个参数应为 0-6 的整数')
          }
          digits = Number(n.value)
          pos++
          if (digits > 6) throw new ParsingError('ROUND 的位数最多 6')
        }
        if (!eat(')')) throw new ParsingError('ROUND(...) 缺少「)」')
        return { kind: 'round', arg, digits }
      }
      fields.add(t.value)
      return { kind: 'field', name: t.value }
    }
    if (t.value === '(') {
      pos++
      const inner = parseExpr()
      if (!eat(')')) throw new ParsingError('缺少「)」')
      return inner
    }
    throw new ParsingError(`位置 ${t.pos}：意外的「${t.value}」`)
  }

  try {
    const ast = parseExpr()
    if (pos < tokens.length) {
      const t = tokens[pos]
      throw new ParsingError(`位置 ${t.pos}：多余的「${t.value}」`)
    }
    return { ok: true, ast, refs: { fields: [...fields], tables: [...tables] } }
  } catch (err) {
    if (err instanceof ParsingError) return { ok: false, error: err.message }
    throw err
  }
}

/** 解析并校验公式（服务端声明期与前端求值共用）。 */
export function parseFormula(src: string): FormulaParseResult {
  return parse(src)
}

// ---- 求值 ----

export interface FormulaEvalOptions {
  /** 取字段原始值（string / number / boolean）；undefined = 字段无值 */
  valueOf: (field: string) => unknown
  /** 数据表：表名 → { 键: 数值 } */
  tables?: Record<string, Record<string, number>>
}

/**
 * 求值。任何无法得出有限数的情况（缺值 / 非数值 / 除零 / 查无键 / 溢出）
 * 返回 null——调用方显示占位符。
 */
export function evaluateFormula(ast: FormulaNode, opts: FormulaEvalOptions): number | null {
  function numOf(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string') {
      const s = v.trim()
      if (s === '') return null
      const n = Number(s)
      return Number.isFinite(n) ? n : null
    }
    if (typeof v === 'boolean') return v ? 1 : 0
    return null
  }

  function ev(node: FormulaNode): number | null {
    switch (node.kind) {
      case 'num':
        return node.value
      case 'field':
        return numOf(opts.valueOf(node.name))
      case 'lookup': {
        const raw = opts.valueOf(node.field)
        if (raw === undefined || raw === null || typeof raw === 'object') return null
        const table = opts.tables?.[node.table]
        if (!table) return null
        const hit = table[String(raw)]
        return typeof hit === 'number' && Number.isFinite(hit) ? hit : null
      }
      case 'round': {
        const v = ev(node.arg)
        if (v == null) return null
        const f = 10 ** node.digits
        const r = Math.round(v * f) / f
        return Number.isFinite(r) ? r : null
      }
      case 'neg': {
        const v = ev(node.arg)
        return v == null ? null : -v
      }
      case 'binary': {
        const l = ev(node.left)
        if (l == null) return null
        const r = ev(node.right)
        if (r == null) return null
        let out: number
        switch (node.op) {
          case '+': out = l + r; break
          case '-': out = l - r; break
          case '*': out = l * r; break
          case '/': out = r === 0 ? NaN : l / r; break
          case '^': out = Math.pow(l, r); break
        }
        return Number.isFinite(out) ? out : null
      }
    }
  }

  return ev(ast)
}
