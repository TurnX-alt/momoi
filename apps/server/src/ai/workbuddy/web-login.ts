/**
 * WorkBuddy 网页登录（OAuth 式 state 握手），不依赖本机安装 WorkBuddy App。
 *
 *   1) POST /v2/plugin/auth/state?platform=workbuddy
 *      带「未登录」标记头（X-No-Authorization 等，缺了会被按已登录校验）
 *      → { code:0, data:{ state, authUrl } }
 *   2) 管理员在浏览器完成登录（腾讯托管页，本服务不经手口令）
 *   3) GET /v2/plugin/auth/token?state=<state>
 *      未登录：HTTP 200 + code 11217（pending）；成功：code 0 + token
 *   4) GET /v2/plugin/account（Bearer）→ uid / nickname / domain
 *
 * copilot.tencent.com 与 www.workbuddy.cn 共用同一 state 存储，任一端换票皆可。
 */

import { workbuddyConfig as cfg } from './config.js'

interface ApiEnvelope {
  code?: number
  msg?: string
  data?: any
}

function preLoginHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'X-No-Authorization': 'true',
    'X-No-User-Id': 'true',
    'X-No-Enterprise-Id': 'true',
    'X-No-Department-Info': 'true',
    'X-Product': cfg.product,
    'X-IDE-Type': 'WorkBuddy',
    'X-IDE-Name': 'WorkBuddy',
    'X-IDE-Version': cfg.ideVersion,
    'X-Domain': cfg.domain,
    'User-Agent': `WorkBuddy/${cfg.ideVersion}`,
    'Accept': 'application/json',
    'x-requested-with': 'XMLHttpRequest',
    ...extra,
  }
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** access token 是 JWT：payload 的 exp 可作为 expiresAt 的兜底 */
function jwtExpiresAt(token: string, fallback: number): number {
  try {
    const part = token.split('.')[1] || ''
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    const exp = Number(payload?.exp)
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : fallback
  } catch {
    return fallback
  }
}

export interface LoginHandshake {
  state: string
  authUrl: string
}

export async function requestHandshake(signal?: AbortSignal): Promise<LoginHandshake> {
  const url = `${cfg.authBaseUrl}${cfg.statePath}?platform=${encodeURIComponent(cfg.platform)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: preLoginHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
    signal: signal ?? AbortSignal.timeout(20_000),
  })
  const env = (await res.json().catch(() => null)) as ApiEnvelope | null
  if (!res.ok || !env || env.code !== 0) {
    throw new Error(`登录握手失败：HTTP ${res.status} code=${env?.code ?? '?'} ${env?.msg ?? ''}`.trim())
  }
  const state = typeof env.data?.state === 'string' ? env.data.state.trim() : ''
  const authUrl = typeof env.data?.authUrl === 'string' ? env.data.authUrl : ''
  if (!state || !authUrl) throw new Error('登录握手响应缺少 state / authUrl')
  return { state, authUrl }
}

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  refreshExpiresAt?: number
  domain?: string
}

/** 轮询一次换票：'pending' 表示浏览器端尚未完成登录 */
export async function pollOnce(state: string, signal?: AbortSignal): Promise<IssuedTokens | 'pending'> {
  const url = `${cfg.authBaseUrl}${cfg.tokenPath}?state=${encodeURIComponent(state)}`
  const res = await fetch(url, {
    method: 'GET',
    headers: preLoginHeaders(),
    signal: signal ?? AbortSignal.timeout(20_000),
  })
  const env = (await res.json().catch(() => null)) as ApiEnvelope | null

  // pending 是 HTTP 200 + 业务码，不能只看 status
  if (res.ok && env && env.code === cfg.loginPendingCode) return 'pending'
  if (!res.ok || !env || env.code !== 0) {
    throw new Error(`换票失败：HTTP ${res.status} code=${env?.code ?? '?'} ${env?.msg ?? ''}`.trim())
  }

  const data = env.data?.data ?? env.data
  const accessToken = data?.accessToken ?? data?.access_token
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('换票响应缺少 accessToken')

  const now = Date.now()
  const expiresIn = num(data.expiresIn)
  const refreshExpiresIn = num(data.refreshExpiresIn)
  return {
    accessToken,
    refreshToken: typeof (data.refreshToken ?? data.refresh_token) === 'string'
      ? data.refreshToken ?? data.refresh_token
      : '',
    expiresAt: num(data.expiresAt) ?? (expiresIn ? now + expiresIn * 1000 : jwtExpiresAt(accessToken, now + 24 * 3600_000)),
    refreshExpiresAt: num(data.refreshExpiresAt) ?? (refreshExpiresIn ? now + refreshExpiresIn * 1000 : undefined),
    domain: typeof data.domain === 'string' ? data.domain : undefined,
  }
}

export interface AccountInfo {
  uid: string
  domain?: string
  nickname?: string
}

/** 用 access token 取账号信息；失败返回 null（uid 可由 JWT sub 兜底） */
export async function fetchAccount(accessToken: string, domain: string, signal?: AbortSignal): Promise<AccountInfo | null> {
  try {
    const res = await fetch(`${cfg.authBaseUrl}${cfg.accountPath}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Product': cfg.product,
        'X-IDE-Type': 'WorkBuddy',
        'X-IDE-Name': 'WorkBuddy',
        'X-IDE-Version': cfg.ideVersion,
        'X-Private-Data': 'true',
        'X-Domain': domain || cfg.domain,
        'User-Agent': `WorkBuddy/${cfg.ideVersion}`,
        'Accept': 'application/json',
      },
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    const env = (await res.json().catch(() => null)) as ApiEnvelope | null
    if (!res.ok || !env || env.code !== 0) return null
    const data = env.data?.data ?? env.data
    return {
      uid: typeof data?.uid === 'string' ? data.uid : '',
      domain: typeof data?.domain === 'string' ? data.domain : undefined,
      nickname: typeof data?.nickname === 'string' ? data.nickname : undefined,
    }
  } catch {
    return null
  }
}

/** 从 JWT sub 取 uid（换取账号信息失败时的兜底） */
export function uidFromToken(token: string): string {
  try {
    const part = token.split('.')[1] || ''
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return typeof payload?.sub === 'string' ? payload.sub : ''
  } catch {
    return ''
  }
}
