import { useEffect, useMemo, useRef, useState } from 'react'
import { useDarkMode } from '../../../hooks/useDarkMode'
import type { CardComponentProps } from '../registry'

// 应用卡（AppBlock，M4 / D57）：模型生成的 HTML/CSS/JS 按**不可信内容**处理——
// 安全边界完全由三层承担（缺一不可）：
//   · sandbox="allow-scripts"（仅此一项）——无 allow-same-origin 即不透明源，
//     脚本无法触碰父文档 / localStorage / cookie；无 allow-forms/popups/
//     top-navigation，表单提交与跳转亦被阻断；
//   · srcDoc 内 CSP default-src 'none'——fetch/XHR/WebSocket 全部阻断（无网络），
//     仅允许内联脚本与样式；图片限 data: 与 https:；
//   · 父侧 postMessage 校验 event.source === iframe.contentWindow，height clamp 64..960。
// 主题切换重建 srcDoc（iframe 重载、应用状态重置——v1 接受）。
// 生命周期：React key = 卡片 id，消息卸载即 iframe 销毁；无持久化。

const MIN_HEIGHT = 64
const MAX_HEIGHT = 960
const DEFAULT_HEIGHT = 320

interface AppData {
  html: string
  css?: string
  js?: string
  height: number
}

function parseProps(raw: Record<string, unknown>): AppData {
  if (typeof raw.html !== 'string' || !raw.html.trim()) throw new Error('app.html 缺失')
  const h = typeof raw.height === 'number' && Number.isFinite(raw.height) ? raw.height : DEFAULT_HEIGHT
  return {
    html: raw.html,
    css: typeof raw.css === 'string' && raw.css ? raw.css : undefined,
    js: typeof raw.js === 'string' && raw.js ? raw.js : undefined,
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h))),
  }
}

/** 读取宿主的主题变量（HSL 三元组），注入沙箱供应用取用（含图表色板） */
function collectThemeVars(): string {
  const cs = getComputedStyle(document.documentElement)
  const names = [
    '--background', '--foreground', '--card', '--card-foreground',
    '--primary', '--primary-foreground', '--secondary', '--secondary-foreground',
    '--muted', '--muted-foreground', '--accent', '--accent-foreground',
    '--destructive', '--destructive-foreground', '--border', '--input', '--ring', '--radius',
    '--chart-1', '--chart-2', '--chart-3', '--chart-4',
    '--chart-5', '--chart-6', '--chart-7', '--chart-8',
  ]
  return names
    .map((n) => {
      const v = cs.getPropertyValue(n).trim()
      return v ? `  ${n}: ${v};` : ''
    })
    .filter(Boolean)
    .join('\n')
}

/** 防止用户 js/css 中的 </script>、</style> 序列提前闭合注入块（\/ 在其宿主语法中均为合法转义） */
function escapeClosers(s: string): string {
  return s.replace(/<\/(script|style)/gi, '<\\/$1')
}

/** 沙箱助手：定义 momoiResize()（无参 = 自动量高）并在加载/尺寸变化时自动上报 */
const RESIZE_HELPER = `(function(){
  function post(){
    try{
      var h = Math.max(
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.scrollHeight : 0
      );
      parent.postMessage({ source: 'momoi-app', type: 'resize', height: h }, '*');
    }catch(e){}
  }
  window.momoiResize = post;
  window.addEventListener('load', post);
  document.addEventListener('DOMContentLoaded', post);
  if (window.ResizeObserver) { try { new ResizeObserver(post).observe(document.documentElement); } catch(e){} }
})();`

function buildSrcDoc(data: AppData, dark: boolean): string {
  const vars = collectThemeVars()
  const fgFallback = dark ? '0 0% 98%' : '240 10% 3.9%'
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:">
<style>
:root {
${vars}
}
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif;
  font-size: 14px;
  background: transparent;
  color: hsl(var(--foreground, ${fgFallback}));
}
</style>
${data.css ? `<style>${escapeClosers(data.css)}</style>` : ''}
</head>
<body>
${data.html}
<script>${RESIZE_HELPER}</script>
${data.js ? `<script>${escapeClosers(data.js)}</script>` : ''}
</body>
</html>`
}

export function AppBlockCard({ props, cardTitle }: CardComponentProps) {
  const dark = useDarkMode()
  const data = useMemo(() => parseProps(props), [props])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(() => data.height)

  // 主题切换 → srcDoc 重建 → iframe 重载；随后由助手脚本重新上报高度
  const srcDoc = useMemo(() => buildSrcDoc(data, dark), [data, dark])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // 不透明源的 origin 恒为 'null'，无法按 origin 鉴别——用 source 身份校验
      if (e.source !== iframeRef.current?.contentWindow) return
      const msg = e.data as { source?: unknown; type?: unknown; height?: unknown } | null
      if (!msg || typeof msg !== 'object') return
      if (msg.source !== 'momoi-app' || msg.type !== 'resize') return
      if (typeof msg.height !== 'number' || !Number.isFinite(msg.height)) return
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(msg.height))))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <iframe
      ref={iframeRef}
      title={cardTitle ?? 'momoi-app'}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ height }}
      className="w-full rounded-md border border-border/60"
    />
  )
}
