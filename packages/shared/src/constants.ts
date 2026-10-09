export const SUGGESTIONS_FENCE = '```suggestions'
// 卡片交互协议围栏：用户与卡片交互时，前端合成的用户消息 content 内嵌
// `card-action` 围栏 JSON（CardActionPayload）。模型回喂天然可见；
// 前端渲染为紧凑交互 chip 而非代码块。见 docs/specs/module-intelligent-ui.md。
export const CARD_ACTION_FENCE = '```card-action'
// 多轮思考链的片段分隔符：loop 在每一轮思考开始前插入，
// DB 存含分隔符的纯文本，前端按此拆分展示多个「思考片段」。
export const THINKING_SEGMENT_OPEN = '\n\n〔思考片段 '
export const THINKING_SEGMENT_CLOSE = '〕\n'
// 当一轮思考被输出 token 上限（finishReason === 'length'）截断时，
// 在思考片段尾部追加该标记，前端据此显示「思考被截断」。
export const THINKING_TRUNCATED_MARK = '\n…（思考被输出长度截断）…'
// Default system prompt is empty. 追问建议（suggestions）由中立 Agent
// 在每轮回复完成后单独生成补发，不再注入普通 Agent 的系统提示词。
export const DEFAULT_SYSTEM_PROMPT = ''
export const DEFAULT_APP_NAME = 'Momoi'
export const DEFAULT_API_ENDPOINT = 'https://api.openai.com/v1'
export const DEFAULT_MODEL = 'gpt-4o'

// Agent 默认值
export const NEUTRAL_AGENT_NAME = '中立 Agent'
export const NEUTRAL_AGENT_ID = 'neutral-agent'

// TTS
export const DEFAULT_TTS_ENDPOINT = 'http://localhost:9880'
export const DEFAULT_TTS_PROVIDER = 'gpt-sovits'

// ---- 3D 角色卡·实时表演（D59）----

/** 语义手势库（单一事实来源）：服务端 schema 枚举与前端程序化实现共用。
 *  前端在 VRM 标准化人形骨骼上实现——一次编写、全模型通用。 */
export const CHARACTER_GESTURES = [
  'wave',          // 挥手
  'nod',           // 点头
  'shake_head',    // 摇头
  'tilt_head',     // 歪头
  'bow',           // 鞠躬
  'clap',          // 鼓掌
  'shrug',         // 耸肩
  'think',         // 思考（手托下巴）
  'point',         // 指（右臂前伸）
  'jump',          // 蹦跳
  'hands_on_hips', // 叉腰
  'shy',           // 害羞（低头捂胸）
  'salute',        // 敬礼
  'heart',         // 比心
  'dance',         // 简单律动
  'stretch',       // 伸懒腰
] as const
export type CharacterGesture = (typeof CHARACTER_GESTURES)[number]

/** 姿态逃生舱可用骨骼（VRM 标准化人形非手指骨骼）+ 特殊通道 __root（整体位移，米）。
 *  欧拉角 -135..135 度（__root 为位移，前端钳制 ±2 米）。 */
export const CHARACTER_POSE_BONES = [
  '__root',
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot',
] as const
export type CharacterPoseBone = (typeof CHARACTER_POSE_BONES)[number]
