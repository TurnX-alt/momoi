import type { Context, Next } from 'hono'
import { ErrCode } from '@momoi/shared/errors'
import { STAND_ALONE } from '../lib/standalone.js'
import { verifyUserToken, getAuthToken, isUserBanned } from '../lib/auth.js'
import { ApiError } from '../lib/apiError.js'

/**
 * User auth middleware — validates the JWT from the HttpOnly cookie
 * `momoi_token` (the sole credential transport) and rejects banned accounts.
 * Sets `userId` in context for downstream routes.
 * In stand-alone mode there is no JWT and no cookie: the identity is the
 * fixed 'admin' user and the middleware passes straight through.
 */
export async function userAuthMiddleware(c: Context, next: Next) {
  if (STAND_ALONE) {
    c.set('userId', 'admin')
    await next()
    return
  }
  const token = getAuthToken(c)
  if (!token) {
    throw new ApiError(ErrCode.UNAUTHORIZED)
  }
  const result = await verifyUserToken(token)
  if (!result) {
    throw new ApiError(ErrCode.AUTH_INVALID_TOKEN)
  }
  // 封禁即时生效：JWT 无状态、签发后无法吊销，故每次请求二次查库。
  // 刻意返回 401（而非语义更贴切的 403 USER_DISABLED）——前端只对 401 触发
  // 会话驱逐（api.ts 的 handleAuthOn401），用户会被清回登录页；再尝试登录时
  // /verify 返回 403 USER_DISABLED，i18n 已有「账户已被禁用」文案告知原因。
  // 若在此返 403，用户会卡在「看似登录、但每个请求都失败」的状态。
  if (await isUserBanned(result.username)) {
    throw new ApiError(ErrCode.AUTH_INVALID_TOKEN)
  }
  c.set('userId', result.username)
  await next()
}
