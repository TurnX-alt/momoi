import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '../../ui/input'
import { Button } from '../../ui/button'
import { Switch } from '../../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Loading } from '../../ui/spinner'
import { Eye, EyeOff, ExternalLink, LogIn, LogOut, ShieldCheck } from 'lucide-react'
import { api } from '../../../lib/api'
import { useToast } from '../../ui/toast'
import type { GatewaySource, WorkBuddyStatus } from '@momoi/shared/types'

export interface GatewaySettingsHandle {
  loadFromEnv: () => void
}

interface GatewaySettingsProps {
  /** 智能源变化时通知父级（决定右上角是否显示「从环境变量加载」） */
  onSourceChange?: (source: GatewaySource) => void
}

const normalizeSource = (value: unknown): GatewaySource => (value === 'workbuddy' ? 'workbuddy' : 'custom')

export const GatewaySettings = forwardRef<GatewaySettingsHandle, GatewaySettingsProps>(function GatewaySettings(
  { onSourceChange },
  ref,
) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [config, setConfig] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  // WorkBuddy 凭证 / 登录进度
  const [credential, setCredential] = useState<WorkBuddyStatus | null>(null)
  const [loginState, setLoginState] = useState<'idle' | 'pending' | 'success' | 'failed'>('idle')
  const [loginUrl, setLoginUrl] = useState<string>('')
  const [loginMessage, setLoginMessage] = useState<string>('')
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const source: GatewaySource = normalizeSource(config?.gateway_source)

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const refreshCredential = useCallback(async () => {
    try {
      setCredential(await api.workbuddyStatus())
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    api.getConfig().then((cfg) => {
      setConfig(cfg)
      onSourceChange?.(normalizeSource(cfg.gateway_source))
    }).catch(console.error)
    // onSourceChange 在父级是稳定 setState，无需进 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  // 选中 WorkBuddy 时拉一次凭证状态
  useEffect(() => {
    if (source === 'workbuddy') void refreshCredential()
  }, [source, refreshCredential])

  const handleLoadFromEnv = useCallback(async () => {
    // 空值守卫折进函数式更新（prev ? {...} : prev）：闭包不再引用 config，
    // deps 可以为空——config 每次表单输入都换新引用，入 deps 会让本回调
    // （及其 useImperativeHandle）跟着每次击键重建。
    try {
      const envGateway = await api.getEnvGateway()
      setConfig((prev: any) => prev ? {
        ...prev,
        api_endpoint: envGateway.api_endpoint,
        api_key: envGateway.api_key,
      } : prev)
    } catch (err) {
      console.error(err)
    }
  }, [])

  const handleSourceChange = useCallback((value: string) => {
    const next = normalizeSource(value)
    setConfig((prev: any) => prev ? { ...prev, gateway_source: next } : prev)
    onSourceChange?.(next)
  }, [onSourceChange])

  /**
   * 登录：服务端发起 state 握手并开始换票轮询，浏览器只负责完成腾讯托管页的
   * 登录；本组件轮询服务端进度，成功即刷新凭证面板。
   */
  const handleLogin = useCallback(async () => {
    stopPolling()
    setLoginMessage('')
    try {
      const { auth_url } = await api.workbuddyLogin()
      setLoginUrl(auth_url)
      window.open(auth_url, '_blank', 'noopener,noreferrer')
      setLoginState('pending')
      // 服务端会话最长 5 分钟；本地也设同一上限，页面永不无限转圈
      const deadline = Date.now() + 5 * 60_000
      pollTimer.current = setInterval(async () => {
        if (Date.now() > deadline) {
          stopPolling()
          setLoginState('failed')
          setLoginMessage(t('settings.workbuddyLoginFailed'))
          return
        }
        try {
          const status = await api.workbuddyLoginStatus()
          if (status.status === 'success') {
            stopPolling()
            setLoginState('success')
            if (status.credential) setCredential(status.credential)
            else void refreshCredential()
            toast({ title: t('settings.workbuddyLoginSuccess'), variant: 'success' })
          } else if (status.status === 'failed') {
            stopPolling()
            setLoginState('failed')
            setLoginMessage(status.message || t('settings.workbuddyLoginFailed'))
            toast({ title: t('settings.workbuddyLoginFailed'), variant: 'error' })
          }
        } catch (err) {
          console.error(err)
        }
      }, 1500)
    } catch (err) {
      console.error(err)
      setLoginState('failed')
      setLoginMessage(err instanceof Error ? err.message : String(err))
      toast({ title: t('settings.workbuddyLoginFailed'), variant: 'error' })
    }
  }, [refreshCredential, stopPolling, t, toast])

  const handleLogout = useCallback(async () => {
    try {
      await api.workbuddyLogout()
      setCredential({ logged_in: false, auto_refresh: true })
      setLoginState('idle')
      setLoginUrl('')
      setLoginMessage('')
      toast({ title: t('settings.workbuddyLogoutSuccess'), variant: 'success' })
    } catch (err) {
      console.error(err)
    }
  }, [t, toast])

  useImperativeHandle(ref, () => ({ loadFromEnv: handleLoadFromEnv }), [handleLoadFromEnv])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateConfig(config)
      toast({ title: t('settings.toastSaved'), variant: 'success' })
    } catch (err) {
      console.error(err)
    }
    setSaving(false)
  }

  if (!config) return <Loading className="py-16" />

  const loggedIn = credential?.logged_in === true
  const expired = credential?.expired === true

  return (
    <div className="space-y-4 pt-4">
      <div>
        <label className="text-sm font-medium">{t('settings.gatewaySource')}</label>
        <Select value={source} onValueChange={handleSourceChange}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">{t('settings.gatewaySourceCustom')}</SelectItem>
            <SelectItem value="workbuddy">{t('settings.gatewaySourceWorkBuddy')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {source === 'custom' ? (
        <>
          <div>
            <label className="text-sm font-medium">{t('settings.apiEndpoint')}</label>
            <Input value={config.api_endpoint || ''} onChange={(e) => setConfig({ ...config, api_endpoint: e.target.value })} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">{t('settings.apiKey')}</label>
            <div className="relative mt-1">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={config.api_key || ''}
                onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div>
          <label className="text-sm font-medium">{t('settings.gatewayCredential')}</label>
          <div className="mt-1 rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className={loggedIn && !expired ? 'h-4 w-4 text-green-500' : 'h-4 w-4 text-muted-foreground'} />
              <span className="font-medium">
                {loginState === 'pending'
                  ? t('settings.workbuddyLoginPending')
                  : loggedIn
                    ? expired
                      ? t('settings.workbuddyExpired')
                      : t('settings.workbuddyLoggedIn')
                    : t('settings.workbuddyNotLoggedIn')}
              </span>
            </div>

            {credential && (credential.uid || credential.nickname) && (
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  {t('settings.workbuddyAccount')}：{credential.nickname || credential.uid}
                  {credential.nickname && credential.uid ? ` (${credential.uid})` : ''}
                </div>
                {credential.expires_at && (
                  <div>{t('settings.workbuddyExpiresAt')}：{new Date(credential.expires_at).toLocaleString()}</div>
                )}
                {credential.refresh_expires_at && (
                  <div>{t('settings.workbuddyRefreshExpiresAt')}：{new Date(credential.refresh_expires_at).toLocaleString()}</div>
                )}
                <div>{t('settings.workbuddyAutoRefresh')}：{credential.auto_refresh ? t('settings.workbuddyAutoRefreshOn') : '—'}</div>
              </div>
            )}

            {loginState === 'pending' && loginUrl && (
              <a href={loginUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />
                {t('settings.workbuddyOpenLoginLink')}
              </a>
            )}

            {loginState === 'failed' && loginMessage && (
              <p className="text-sm text-destructive break-words">{loginMessage}</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleLogin} disabled={loginState === 'pending'}>
                <LogIn className="mr-1.5 h-3.5 w-3.5" />
                {loggedIn ? t('settings.workbuddyRelogin') : t('settings.gatewayLogin')}
              </Button>
              {loggedIn && (
                <Button size="sm" variant="outline" onClick={handleLogout} disabled={loginState === 'pending'}>
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  {t('settings.workbuddyLogout')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="text-sm font-medium">{t('settings.contextWindow')}</label>
        <Input
          type="number"
          min={1}
          value={config.context_window ?? 128000}
          onChange={(e) => setConfig({ ...config, context_window: Number(e.target.value) || 128000 })}
          className="mt-1"
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">{t('settings.supportInfiniteMode')}</label>
        <Switch
          checked={config.support_infinite_mode !== false}
          onCheckedChange={(v) => setConfig({ ...config, support_infinite_mode: v })}
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">{t('settings.supportAttachments')}</label>
        <Switch
          checked={!!config.support_attachments}
          onCheckedChange={(v) => setConfig({ ...config, support_attachments: v })}
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">{t('settings.useExternalImageHosting')}</label>
        <Switch
          checked={!!config.use_external_image_hosting}
          onCheckedChange={(v) => setConfig({ ...config, use_external_image_hosting: v })}
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">{t('settings.allowImConversations')}</label>
        <Switch
          checked={config.allow_im_conversations !== false}
          onCheckedChange={(v) => setConfig({ ...config, allow_im_conversations: v })}
        />
      </div>
      <Button onClick={handleSave} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
    </div>
  )
})
