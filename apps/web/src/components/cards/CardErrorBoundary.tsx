import React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

/**
 * 消息流内的卡片局部错误边界：单张卡片渲染失败只降级该卡片，
 * 不冒泡到全局 ErrorBoundary（全库唯一那个包着整个 App）。
 * 调用方以 key={card id} 挂载，卡片数据变化即重挂载自然复位。
 */
export class CardErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.warn('[card] render failed:', error)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return <CardErrorFallback message={this.state.error.message} />
    }
    return this.props.children
  }
}

function CardErrorFallback({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div>{t('chat.cardRenderFailed')}</div>
        <div className="mt-0.5 text-destructive/70 break-all">{message}</div>
      </div>
    </div>
  )
}
