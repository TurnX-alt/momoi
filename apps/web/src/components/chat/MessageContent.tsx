import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { MermaidBlock } from './MermaidBlock'

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

  const safeContent = useMemo(
    () => sanitizeIncompleteMarkdown(renderedContent),
    [renderedContent],
  )

  const parts = safeContent.split(/(```mermaid[\s\S]*?```)/g)

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
