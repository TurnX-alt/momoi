import type { CharacterGesture } from '@momoi/shared/constants'

// ============================================================
// 3D 角色·实时表演引擎（D59）
// ============================================================
// 语义手势库：在 **VRM 标准化人形骨骼**上程序化实现——一次编写、全模型通用。
// 模型只做语义编排（act = gesture/pose + at + times），骨骼关键帧由本模块演算。
//
// 轴向约定（VRM 1.0 标准化人形：T-pose、面向 +Z、角色左侧为 +X）：
//   · 全部角度为**叠加在静止姿态上的欧拉增量**（度，XYZ 序）
//   · 抬臂：绕 Z 轴——左臂正角 / 右臂负角（镜像，见 L/R 常量）
//   · 前挥：绕 Y 轴——左臂负角 / 右臂正角（镜像）
//   · 点头 = 头 +X；摇头 = 头 ±Y；歪头 = 头 ±Z（正角=向角色右侧倾）
//   · '__root' 为整体位移（米，x/y/z），引擎单独处理
// 若某个模型四肢方向相反（个别非规范模型），只需翻转下方 L/R 的符号。

export type PoseDelta = Record<string, [number, number, number]>

/** 左右镜像符号——校准入口 */
const L = { raiseZ: 1, fwdY: -1 } as const
const R = { raiseZ: -1, fwdY: 1 } as const

const smooth = (p: number) => p * p * (3 - 2 * p)
const win = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)))
/** 进出场包络（两端 18% 淡入出）——重复手势逐周期独立淡入出 */
const env = (p: number) => win(p, 0, 0.18) * (1 - win(p, 0.82, 1))
/** 中段保持包络（默认 30% 进、30% 出保持中段） */
const hold = (p: number, inEnd = 0.3, outStart = 0.7) => win(p, 0, inEnd) * (1 - win(p, outStart, 1))

interface GestureDef {
  /** 单次时长（秒） */
  duration: number
  /** p ∈ [0,1] → 骨骼姿态增量 */
  curve: (p: number) => PoseDelta
}

const GESTURES: Record<CharacterGesture, GestureDef> = {
  // 挥手：右臂抬起 + 前臂摆动 2 周期
  wave: {
    duration: 1.8,
    curve: (p) => {
      const e = env(p)
      const sway = Math.sin(win(p, 0.16, 0.88) * Math.PI * 4) * 24 * smooth(win(p, 0.1, 0.28)) * (1 - win(p, 0.86, 1))
      const pose: PoseDelta = {}
      pose.rightUpperArm = [0, R.fwdY * 10 * e, R.raiseZ * 72 * e]
      pose.rightLowerArm = [0, 0, R.raiseZ * (16 + sway)]
      pose.head = [0, 0, 5 * e] // 微微向挥手侧倾斜
      return pose
    },
  },

  // 点头：俯仰 2 次
  nod: {
    duration: 1.2,
    curve: (p) => {
      const s = Math.sin(p * Math.PI * 4) * env(p)
      return { head: [15 * s, 0, 0], neck: [6 * s, 0, 0] }
    },
  },

  // 摇头：左右 3 次
  shake_head: {
    duration: 1.2,
    curve: (p) => {
      const s = Math.sin(p * Math.PI * 6) * env(p)
      return { head: [0, 16 * s, 0], neck: [0, 6 * s, 0] }
    },
  },

  // 歪头：向右侧倾并保持
  tilt_head: {
    duration: 1.6,
    curve: (p) => {
      const h = hold(p)
      return { head: [0, 0, 16 * h], neck: [0, 0, 5 * h] }
    },
  },

  // 鞠躬：躯干前倾
  bow: {
    duration: 2.0,
    curve: (p) => {
      const h = hold(p, 0.35, 0.55)
      return { hips: [5 * h, 0, 0], spine: [16 * h, 0, 0], chest: [14 * h, 0, 0], head: [10 * h, 0, 0] }
    },
  },

  // 鼓掌：双臂前收 + 前臂开合 3 次
  clap: {
    duration: 1.6,
    curve: (p) => {
      const e = env(p)
      const s = Math.sin(win(p, 0.14, 0.9) * Math.PI * 6) * smooth(win(p, 0.1, 0.26)) * (1 - win(p, 0.88, 1))
      const pose: PoseDelta = {}
      pose.leftUpperArm = [0, L.fwdY * 40 * e, L.raiseZ * 4 * e]
      pose.rightUpperArm = [0, R.fwdY * 40 * e, R.raiseZ * 4 * e]
      pose.leftLowerArm = [0, L.fwdY * (30 + 20 * s), 0]
      pose.rightLowerArm = [0, R.fwdY * (30 - 20 * s), 0]
      pose.head = [4 * h1(p), 0, 0]
      return pose
    },
  },

  // 耸肩：双肩上提、双臂微张
  shrug: {
    duration: 1.4,
    curve: (p) => {
      const e = env(p)
      const pose: PoseDelta = {}
      pose.leftShoulder = [0, 0, L.raiseZ * 12 * e]
      pose.rightShoulder = [0, 0, R.raiseZ * 12 * e]
      pose.leftUpperArm = [0, 0, L.raiseZ * 14 * e]
      pose.rightUpperArm = [0, 0, R.raiseZ * 14 * e]
      pose.head = [0, 0, -4 * e]
      return pose
    },
  },

  // 思考：右手抬至脸侧 + 微低头
  think: {
    duration: 2.2,
    curve: (p) => {
      const h = hold(p, 0.35, 0.72)
      const pose: PoseDelta = {}
      pose.rightUpperArm = [0, R.fwdY * 52 * h, R.raiseZ * 32 * h]
      pose.rightLowerArm = [0, R.fwdY * 14 * h, R.raiseZ * 88 * h]
      pose.head = [9 * h, 0, 5 * h]
      return pose
    },
  },

  // 指：右臂前伸
  point: {
    duration: 1.6,
    curve: (p) => {
      const h = hold(p, 0.28, 0.62)
      const pose: PoseDelta = {}
      pose.rightUpperArm = [0, R.fwdY * 62 * h, R.raiseZ * 14 * h]
      pose.rightLowerArm = [0, R.fwdY * 8 * h, 0]
      pose.head = [4 * h, 0, 0]
      return pose
    },
  },

  // 蹦跳：两次原地跳（__root 位移 + 收腿）
  jump: {
    duration: 1.6,
    curve: (p) => {
      const hop = Math.max(0, Math.sin(p * Math.PI * 4)) * env(p)
      const pose: PoseDelta = {}
      pose.__root = [0, 0.13 * hop, 0]
      pose.leftUpperLeg = [-10 * hop, 0, 0]
      pose.rightUpperLeg = [-10 * hop, 0, 0]
      pose.leftLowerLeg = [16 * hop, 0, 0]
      pose.rightLowerLeg = [16 * hop, 0, 0]
      pose.leftUpperArm = [0, 0, L.raiseZ * 12 * hop]
      pose.rightUpperArm = [0, 0, R.raiseZ * 12 * hop]
      pose.head = [-4 * hop, 0, 0]
      return pose
    },
  },

  // 叉腰：双肘外张、手至腰侧
  hands_on_hips: {
    duration: 2.2,
    curve: (p) => {
      const h = hold(p, 0.32, 0.72)
      const pose: PoseDelta = {}
      pose.leftUpperArm = [0, L.fwdY * -8 * h, L.raiseZ * -58 * h]
      pose.rightUpperArm = [0, R.fwdY * -8 * h, R.raiseZ * -58 * h]
      pose.leftLowerArm = [0, L.fwdY * -30 * h, L.raiseZ * 58 * h]
      pose.rightLowerArm = [0, R.fwdY * -30 * h, R.raiseZ * 58 * h]
      pose.head = [0, 0, 4 * h]
      return pose
    },
  },

  // 害羞：低头 + 双手收至胸前
  shy: {
    duration: 2.4,
    curve: (p) => {
      const h = hold(p, 0.32, 0.76)
      const pose: PoseDelta = {}
      pose.leftUpperArm = [0, L.fwdY * 42 * h, L.raiseZ * -28 * h]
      pose.rightUpperArm = [0, R.fwdY * 42 * h, R.raiseZ * -28 * h]
      pose.leftLowerArm = [0, L.fwdY * 22 * h, L.raiseZ * 82 * h]
      pose.rightLowerArm = [0, R.fwdY * 22 * h, R.raiseZ * 82 * h]
      pose.head = [20 * h, 0, 7 * h]
      return pose
    },
  },

  // 敬礼：右手至额侧
  salute: {
    duration: 1.6,
    curve: (p) => {
      const h = hold(p, 0.3, 0.62)
      const pose: PoseDelta = {}
      pose.rightUpperArm = [0, R.fwdY * 20 * h, R.raiseZ * 96 * h]
      pose.rightLowerArm = [0, R.fwdY * 12 * h, R.raiseZ * 96 * h]
      pose.head = [-3 * h, 0, 0]
      return pose
    },
  },

  // 比心：双手在胸前合拢
  heart: {
    duration: 2.0,
    curve: (p) => {
      const h = hold(p, 0.3, 0.72)
      const pose: PoseDelta = {}
      pose.leftUpperArm = [0, L.fwdY * 46 * h, L.raiseZ * 32 * h]
      pose.rightUpperArm = [0, R.fwdY * 46 * h, R.raiseZ * 32 * h]
      pose.leftLowerArm = [0, L.fwdY * 38 * h, L.raiseZ * 72 * h]
      pose.rightLowerArm = [0, R.fwdY * 38 * h, R.raiseZ * 72 * h]
      pose.head = [5 * h, 0, 8 * h]
      pose.__root = [0, 0.02 * Math.sin(p * Math.PI * 4) * h, 0]
      return pose
    },
  },

  // 律动：身体左右摆 + 双臂交替
  dance: {
    duration: 2.4,
    curve: (p) => {
      const e = env(p)
      const s = Math.sin(p * Math.PI * 4)
      const pose: PoseDelta = {}
      pose.hips = [0, 10 * s * e, 0]
      pose.chest = [0, -6 * s * e, 0]
      pose.leftUpperArm = [0, 0, L.raiseZ * (28 + 22 * s) * e]
      pose.rightUpperArm = [0, 0, R.raiseZ * (28 - 22 * s) * e]
      pose.head = [0, 6 * Math.sin(p * Math.PI * 4 + Math.PI / 2) * e, 0]
      return pose
    },
  },

  // 伸懒腰：双臂上举 + 挺胸抬头
  stretch: {
    duration: 2.2,
    curve: (p) => {
      const h = hold(p, 0.32, 0.68)
      const pose: PoseDelta = {}
      pose.leftUpperArm = [0, 0, L.raiseZ * 78 * h]
      pose.rightUpperArm = [0, 0, R.raiseZ * 78 * h]
      pose.spine = [-6 * h, 0, 0]
      pose.head = [-8 * h, 0, 0]
      pose.__root = [0, 0.02 * h, 0]
      return pose
    },
  },
}

/** 鼓掌内部用的小包络（避免与外层 env 混淆） */
function h1(p: number): number {
  return win(p, 0, 0.25) * (1 - win(p, 0.8, 1))
}

// ---- 时间轴引擎 ----

export interface ActSpec {
  type: 'gesture' | 'pose'
  gesture?: string
  pose?: {
    bones?: Array<{ bone: string; x?: number; y?: number; z?: number }>
    hold?: number
  }
  at?: number
  times?: number
}

export interface Performance {
  segments: Array<{ start: number; span: number; repeats: number; curve: (p: number) => PoseDelta }>
  /** 全部会被触碰的骨骼（含 __root）——引擎据此记录静止姿态与收敛目标 */
  bones: string[]
  /** 总时长（秒） */
  total: number
}

const clampDeg = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(135, Math.max(-135, v)) : 0

/** 把模型声明的 acts 编译成可采样时间轴；无效项静默跳过（服务端已校验） */
export function buildPerformance(acts: ActSpec[]): Performance {
  const segments: Performance['segments'] = []
  let cursor = 0

  for (const a of acts) {
    const start = typeof a.at === 'number' && Number.isFinite(a.at) ? Math.max(0, a.at) : cursor
    if (a.type === 'gesture') {
      const def = a.gesture ? GESTURES[a.gesture as CharacterGesture] : undefined
      if (!def) continue
      const reps = Math.min(5, Math.max(1, Math.round(a.times ?? 1)))
      segments.push({ start, span: def.duration * reps, repeats: reps, curve: def.curve })
      cursor = start + def.duration * reps
    } else if (a.type === 'pose') {
      const bones = Array.isArray(a.pose?.bones) ? a.pose!.bones! : []
      if (bones.length === 0) continue
      const staticPose: PoseDelta = {}
      for (const b of bones) {
        staticPose[b.bone] = [clampDeg(b.x), clampDeg(b.y), clampDeg(b.z)]
      }
      const span = Math.min(15, Math.max(0.3, a.pose?.hold ?? 2))
      segments.push({ start, span, repeats: 1, curve: () => staticPose })
      cursor = start + span
    }
  }

  // 收集骨骼：对每段曲线多点采样（手势在不同 p 触碰的骨骼集合可能不同）
  const bones = new Set<string>()
  for (const s of segments) {
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      for (const bone of Object.keys(s.curve(p))) bones.add(bone)
    }
  }

  const total = segments.reduce((m, s) => Math.max(m, s.start + s.span), 0)
  return { segments, bones: [...bones], total }
}

/** 采样 t 时刻的合成姿态（同骨骼多段重叠时后者覆盖前者；段外骨骼回落到零增量） */
export function samplePerformance(perf: Performance, t: number): PoseDelta {
  const pose: PoseDelta = {}
  for (const s of perf.segments) {
    if (t < s.start || t >= s.start + s.span) continue
    const local = (t - s.start) / s.span
    const p = s.repeats > 1 ? (local * s.repeats) % 1 : local
    const frame = s.curve(p)
    for (const [bone, e] of Object.entries(frame)) pose[bone] = e
  }
  return pose
}
