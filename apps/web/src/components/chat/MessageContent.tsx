import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { MermaidBlock } from './MermaidBlock'
import { CardActionChip } from './CardActionChip'
import { parseCardActionFence } from '../../lib/cardAction'

// Lazy-load the markdown renderer at the COMPONENT level: MarkdownView
// statically imports react-markdown + remark-gfm, so the ~39 KB (gzip)
// dependency tree ships as one chunk loaded on first message render.
// (Bare dynamic imports of the libraries themselves broke under the current
// Rolldown build — React.lazy must resolve to a component module.)
// While the chunk loads, messages render as plain text via Suspense fallback.
const LazyMarkdownView = lazy(() => import('./MarkdownView').then(m => ({ default: m.MarkdownView })))

interface MessageContentProps {
  content: string
  streaming?: boolean
  isUser?: boolean
}

const STREAM_THROTTLE_MS = 120

/** Regex to match @AgentName mentions (word chars + CJK chars after @) */
const MENTION_RE = /(@[\w一-鿿぀-ゟ゠-ヿ]+)/g

/**
 * Convert @Name mentions to markdown links so they render inline
 * inside the same paragraph. We use a custom x-mention: protocol
 * that won't be stripped by react-markdown's default URL sanitizer.
 */
function processMentions(content: string): string {
  return content.replace(MENTION_RE, (match) => {
    const name = match.slice(1)
    return `[@${name}](x-mention:${encodeURIComponent(name)})`
  })
}

export function MessageContent({ content, streaming, isUser }: MessageContentProps) {
  const [renderedContent, setRenderedContent] = useState(content)

  useEffect(() => {
    if (!streaming) {
      setRenderedContent(content)
      return
    }
    const timer = setTimeout(() => {
      setRenderedContent(content)
    }, STREAM_THROTTLE_MS)
    return () => clearTimeout(timer)
  }, [content, streaming])

  const safeContent = useMemo(() => {
    // 防模型仿写：助手消息剥除系统标注行（[已渲染卡片：…]），历史注入格式
    // 只该出现在回喂历史中——见 D59 防仿写
    const cleaned = isUser ? renderedContent : stripCardMarkers(renderedContent)
    return sanitizeIncompleteMarkdown(cleaned)
  }, [renderedContent, isUser])

  // mermaid 围栏 + card-action 围栏（user 气泡内渲染为紧凑交互 chip）
  const parts = safeContent.split(/(```mermaid[\s\S]*?```|```card-action[\s\S]*?```)/g)

  return (
    <div className={`prose prose-sm max-w-none [&_p]:my-1.5 [&>:first-child]:mt-0 [&>:last-child]:mb-0 ${isUser ? '[color:inherit] [--tw-prose-body:currentColor] [--tw-prose-headings:currentColor] [--tw-prose-bold:currentColor] [--tw-prose-links:currentColor] [--tw-prose-code:currentColor] [--tw-prose-counters:currentColor] [--tw-prose-bullets:currentColor] [--tw-prose-quotes:currentColor]' : 'dark:prose-invert'}`}>
      {parts.map((part, idx) => {
        if (part.startsWith('```mermaid')) {
          if (streaming) {
            return <pre key={idx} className="text-xs bg-muted p-2 rounded overflow-x-auto">{part}</pre>
          }
          const chart = part.replace(/```mermaid\n?/, '').replace(/\n?```$/, '')
          return <MermaidBlock key={idx} chart={chart} />
        }
        if (part.startsWith('```card-action')) {
          if (isUser) {
            const payload = parseCardActionFence(part)
            if (payload) {
              return (
                <div key={idx}>
                  <CardActionChip payload={payload} />
                </div>
              )
            }
          }
          // 非 user 或解析失败：原样展示（调试友好）
          return <pre key={idx} className="text-xs bg-muted p-2 rounded overflow-x-auto">{part}</pre>
        }
        if (!part) return null
        const processed = processMentions(part)
        return (
          <Suspense key={idx} fallback={<p className="whitespace-pre-wrap">{processed}</p>}>
            <LazyMarkdownView content={processed} isUser={isUser} />
          </Suspense>
        )
      })}
    </div>
  )
}

/**
 * 剥除模型仿写的系统标注行（[已渲染卡片：…]，含流式未闭合残行）——
 * 标注格式只该出现在回喂历史里；模型偶发在回复中复读它（历史注入格式的
 * 已知副作用），剥除防文本污染。卡片本身仍只由工具调用产生。
 */
const CARD_MARKER_RE = /^[ \t]*[\[［]已渲染卡片[^\]］\n]*[\]］]?[ \t]*$/gm

function stripCardMarkers(text: string): string {
  if (!text.includes('已渲染卡片')) return text
  return text.replace(CARD_MARKER_RE, '').replace(/\n{3,}/g, '\n\n')
}

/**
 * Fix incomplete markdown that would render as garbled text during streaming.
 */
function sanitizeIncompleteMarkdown(text: string): string {
  if (!text) return text

  let result = text

  const fenceCount = (result.match(/^```/gm) || []).length
  if (fenceCount % 2 !== 0) {
    result += '\n```'
  }

  const backtickCount = (result.match(/(?<!`)`(?!`)/g) || []).length
  if (backtickCount % 2 !== 0) {
    result += '`'
  }

  const boldCount = (result.match(/\*\*/g) || []).length
  if (boldCount % 2 !== 0) {
    result += '**'
  }

  const italicCount = (result.match(/(?<!\*)\*(?!\*)/g) || []).length
  if (italicCount % 2 !== 0) {
    result += '*'
  }

  result = result.replace(/\!?\[[^\]]*$/, '')

  return result
}
