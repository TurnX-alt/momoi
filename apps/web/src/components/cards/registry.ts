import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { CardComponent } from '@momoi/shared/types'

/** 卡片组件统一收参：描述符中的 props（服务端已校验，前端只做防崩轻校验） */
export interface CardComponentProps {
  props: Record<string, unknown>
  /** 卡片对位 ID（trace 条目的工具调用 id）——交互类卡片回传用 */
  cardId?: string
  /** 卡片标题（CardRenderer 传入，交互回传摘要用） */
  cardTitle?: string
  /** 群聊：卡片所属 Agent 名（交互回传 @ 前缀置首发言） */
  ownerAgentName?: string
}

export interface CardRegistration {
  /** 注册表可读名（调试/日志用） */
  title: string
  Component: LazyExoticComponent<ComponentType<CardComponentProps>>
}

/**
 * 卡片组件注册表：CardComponent 联合 → 懒加载组件。
 * 注意 Rolldown 构建硬规则：React.lazy 必须解析到「组件模块」
 * （.then 映射 default），不能对库本身裸动态 import——重依赖
 * （recharts）在组件模块内静态 import，随 lazy 边界自然独立成块。
 *
 * 分期：M1 = chart / stat / table / diagram；form（M2）、app（M4）、
 * character（M5）后续注册；state（世界状态 · 引擎合成卡，无 ui_* 工具）
 * 随世界模拟状态系统加入。缺失组件由 CardRenderer 渲染错误态。
 */
export const cardRegistry: Partial<Record<CardComponent, CardRegistration>> = {
  chart: {
    title: 'chart',
    Component: lazy(() => import('./chart/ChartCard').then((m) => ({ default: m.ChartCard }))),
  },
  stat: {
    title: 'stat',
    Component: lazy(() => import('./stat/StatCard').then((m) => ({ default: m.StatCard }))),
  },
  table: {
    title: 'table',
    Component: lazy(() => import('./table/TableCard').then((m) => ({ default: m.TableCard }))),
  },
  diagram: {
    title: 'diagram',
    Component: lazy(() => import('./diagram/DiagramCard').then((m) => ({ default: m.DiagramCard }))),
  },
  form: {
    title: 'form',
    Component: lazy(() => import('./form/FormCard').then((m) => ({ default: m.FormCard }))),
  },
  app: {
    title: 'app',
    Component: lazy(() => import('./app/AppBlockCard').then((m) => ({ default: m.AppBlockCard }))),
  },
  character: {
    title: 'character',
    Component: lazy(() => import('./character/CharacterCard').then((m) => ({ default: m.CharacterCard }))),
  },
  state: {
    title: 'state',
    Component: lazy(() => import('./state/StateCard').then((m) => ({ default: m.StateCard }))),
  },
}
