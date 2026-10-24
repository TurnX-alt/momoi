/**
 * WorkBuddy 凭证存储：落 SQLite settings 表，AES-256-GCM 静态加密。
 *
 * 密钥是与库同存的随机 32 字节（settings.workbuddy_store_key）——本项目的
 * api_key 本就明文存库，加密在此处的意义是「凭证不以可读形式出现在表、
 * 备份与 SQL 查询结果里」，而非抵御拿到整库的攻击者。信封自描述
 * （`aesgcm:v1:<iv>:<tag>:<ciphertext>`），将来换密钥形态可平滑迁移。
 */

import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, settings } from '../../db/index.js'

const CREDENTIAL_KEY = 'workbuddy_credential'
const STORE_KEY_KEY = 'workbuddy_store_key'
const ENVELOPE_PREFIX = 'aesgcm:v1:'

/** 落库的凭证精简形态（不存原始响应，避免把上游回包整包写进配置表） */
export interface WorkBuddyCredential {
  accessToken: string
  refreshToken: string
  uid: string
  domain: string
  nickname?: string
  expiresAt: number
  refreshExpiresAt?: number
  savedAt: number
}

function encrypt(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${ENVELOPE_PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
}

function decrypt(blob: string, key: Buffer): string {
  const [ivB64, tagB64, ctB64] = blob.slice(ENVELOPE_PREFIX.length).split(':')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('凭证信封格式不合法')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'), { authTagLength: 16 })
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8')
}

/** 读取或生成存储密钥（首次使用时生成并落库） */
async function getStoreKey(): Promise<Buffer> {
  const existing = await db.select().from(settings).where(eq(settings.key, STORE_KEY_KEY)).get()
  if (existing?.value) return crypto.createHash('sha256').update(existing.value, 'utf8').digest()

  const generated = crypto.randomBytes(32).toString('hex')
  await db.insert(settings).values({ key: STORE_KEY_KEY, value: generated }).onConflictDoNothing().run()
  const row = await db.select().from(settings).where(eq(settings.key, STORE_KEY_KEY)).get()
  return crypto.createHash('sha256').update(row?.value || generated, 'utf8').digest()
}

/** 读取凭证；不存在或解不开返回 null（调用方按「未登录」处理） */
export async function readCredential(): Promise<WorkBuddyCredential | null> {
  const row = await db.select().from(settings).where(eq(settings.key, CREDENTIAL_KEY)).get()
  if (!row?.value) return null
  try {
    const plain = row.value.startsWith(ENVELOPE_PREFIX)
      ? decrypt(row.value, await getStoreKey())
      : row.value // 兼容早期明文写入
    const parsed = JSON.parse(plain) as WorkBuddyCredential
    if (!parsed || typeof parsed.accessToken !== 'string' || !parsed.accessToken) return null
    return parsed
  } catch (err) {
    console.warn(`[workbuddy] 读取本地凭证失败：${(err as Error).message}`)
    return null
  }
}

/** 写入凭证（整包替换）。refresh token 会轮换，因此每次续期都要写回。 */
export async function writeCredential(credential: WorkBuddyCredential): Promise<void> {
  const blob = encrypt(JSON.stringify(credential), await getStoreKey())
  const existing = await db.select().from(settings).where(eq(settings.key, CREDENTIAL_KEY)).get()
  if (existing) {
    await db.update(settings).set({ value: blob }).where(eq(settings.key, CREDENTIAL_KEY)).run()
  } else {
    await db.insert(settings).values({ key: CREDENTIAL_KEY, value: blob }).run()
  }
}

/** 清除凭证（退出登录） */
export async function clearCredential(): Promise<void> {
  await db.delete(settings).where(eq(settings.key, CREDENTIAL_KEY)).run()
}
