import React, { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import type { CardDescriptor } from '@momoi/shared/types'
import { cardRegistry } from './registry'
import { CardFrame } from './CardFrame'
import { CardErrorBoundary } from './CardErrorBoundary'

/**
 * 卡片渲染入口：查注册表 → 懒加载组件（Suspense）→ 局部错误边界兜底。
 * React.memo：流式期间父消息气泡随 token 重渲染，但卡片描述符对象引用稳定
 * （useChat 仅追加 trace 条目），memo 可避免图表组件跟随每帧重渲染。
 */
export const CardRenderer = React.memo(function CardRenderer({ card, cardId, ownerAgentName }: { card: CardDescriptor; cardId?: string; ownerAgentName?: string }) {
  const { t } = useTranslation()
  const reg = cardRegistry[card.component]

  if (!reg) {
    return (
      <CardFrame title={card.title}>
        <div className="text-xs text-muted-foreground">
          {t('chat.cardUnsupported', { component: card.component })}
        </div>
      </CardFrame>
    )
  }

  const { Component } = reg
  return (
    <CardFrame title={card.title}>
      <CardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
              {t('common.loading')}
            </div>
          }
        >
          <Component props={card.props} cardId={cardId} cardTitle={card.title} ownerAgentName={ownerAgentName} />
        </Suspense>
      </CardErrorBoundary>
    </CardFrame>
  )
})
