// ============================================================
// 图表分类色板（dataviz 规范：按固定顺序分配、绝不循环；颜色不是模型 props）
// ============================================================
// 与 globals.css 的 --chart-1..8 同源。recharts 需要具体色值作 SVG 属性
// （attribute 上的 var() 在旧 WebView 不可靠），故此处给出解析后的双模式色板；
// ChartCard 经 useDarkMode 选边。
//
// 校验记录（dataviz validate_palette.js，2026-10）：
//   亮色（表面 #ffffff）：全部 PASS；aqua/yellow/magenta 对比度 <3:1 →
//     按 relief 规则配套可见图例 + 饼图直接标注；
//   暗色（表面 #09090b）：全部 PASS（含对比度 ≥3:1）。

export const CHART_LIGHT: readonly string[] = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
]

export const CHART_DARK: readonly string[] = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
]

/** 第 i 条序列的颜色（服务端限制 series ≤8，颜色按顺序分配、不循环） */
export function colorAt(colors: readonly string[], i: number): string {
  return colors[i % colors.length] ?? colors[colors.length - 1] ?? '#888888'
}
