import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { CardComponent } from '@momoi/shared/types'

/** 卡片组件统一收参：描述符中的 props（服务端已校验，前端只做防崩轻校验） */
export interface CardComponentProps {
  props: Record<string, unknown>
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
 * character（M5）后续注册。缺失组件由 CardRenderer 渲染错误态。
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
}
