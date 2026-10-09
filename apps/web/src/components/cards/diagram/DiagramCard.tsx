import { MermaidBlock } from '../../chat/MermaidBlock'
import type { CardComponentProps } from '../registry'

// 图示卡：收编 mermaid——DSL 原样保留，渲染器与 markdown 围栏路径共享
// （MermaidBlock bare 模式：CardFrame 已提供边框与内边距）。
export function DiagramCard({ props }: CardComponentProps) {
  const code = props.code
  if (typeof code !== 'string' || !code.trim()) throw new Error('diagram.code 缺失')
  return <MermaidBlock chart={code} bare />
}
