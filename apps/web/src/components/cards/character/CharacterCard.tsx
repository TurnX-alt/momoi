import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation'
import { buildPerformance, samplePerformance, type ActSpec, type PoseDelta, type Performance } from './gestures'
import type { CardComponentProps } from '../registry'

// 3D 角色卡（M5 / D58）：VRM 模型 + 表情 + .vrma 动作动画。
// 分包：three 三件套静态内建于本模块——经 React.lazy 边界独立成块，
// 无 3D 卡的会话永不加载（刻意不做 manualChunks，见 D54 的 Rolldown 教训）。
// 降级策略：WebGL 探测失败 → 内联提示；模型/动画加载失败 → 局部错误视图
// （动画失败静默回落到程序化 idle）；DPR 上限 2；离屏暂停 RAF。

const DEFAULT_HEIGHT = 360
const MIN_HEIGHT = 240
const MAX_HEIGHT = 640
const D2R = Math.PI / 180
const EMPTY_POSE: PoseDelta = {}

/** 内置示例模型：three-vrm 官方示例（VRM 1.0 样例）——零资产时仍可演示 */
const DEFAULT_MODEL_URL =
  'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'

interface ExpressionSpec {
  name: string
  weight: number
}

interface CharData {
  modelUrl: string
  animationUrl?: string
  expression: ExpressionSpec[]
  acts: ActSpec[]
  caption?: string
  height: number
}

/** 文件名 → /vrm/<name>（服务端 public 资产目录）；https 直链原样使用 */
function resolveAssetUrl(v: string): string {
  if (/^https?:\/\//i.test(v)) return v
  const clean = v.replace(/^\/+/, '')
  if (clean.includes('..')) throw new Error('非法资产路径')
  return `/vrm/${clean}`
}

function parseProps(raw: Record<string, unknown>): CharData {
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : undefined
  const animation = typeof raw.animation === 'string' && raw.animation.trim() ? raw.animation.trim() : undefined
  const expression: ExpressionSpec[] = Array.isArray(raw.expression)
    ? (raw.expression as Array<Record<string, unknown>>)
        .map((e) => ({
          name: String(e.name ?? ''),
          weight: typeof e.weight === 'number' && Number.isFinite(e.weight) ? Math.min(1, Math.max(0, e.weight)) : 1,
        }))
        .filter((e) => e.name)
    : []
  const h = typeof raw.height === 'number' && Number.isFinite(raw.height) ? raw.height : DEFAULT_HEIGHT
  const acts: ActSpec[] = Array.isArray(raw.acts)
    ? (raw.acts as unknown[]).filter((a): a is ActSpec => !!a && typeof a === 'object')
    : []
  return {
    modelUrl: model ? resolveAssetUrl(model) : DEFAULT_MODEL_URL,
    animationUrl: animation ? resolveAssetUrl(animation) : undefined,
    expression,
    acts,
    caption: typeof raw.caption === 'string' && raw.caption ? raw.caption : undefined,
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h))),
  }
}

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'no-webgl' }
  | { kind: 'load-failed'; message: string }

export function CharacterCard({ props }: CardComponentProps) {
  const { t } = useTranslation()
  const data = useMemo(() => parseProps(props), [props])
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let renderer: THREE.WebGLRenderer | undefined
    let mixer: THREE.AnimationMixer | undefined
    let vrm: VRM | undefined
    let raf = 0
    let visible = true
    const clock = new THREE.Clock()

    // 实时表演（D59）：animation 优先；其缺省/失败时跑 acts；都没有则纯 idle。
    // 表演层 = 静止姿态 ∘ 欧拉增量，逐帧向目标指数平滑（进出场自然软化）；
    // '__root' 通道为整体位移（米）。
    const perf: Performance | null = data.acts.length > 0 ? buildPerformance(data.acts) : null
    const restBones = new Map<string, { node: THREE.Object3D; rest: THREE.Quaternion }>()
    let rootRestY = 0
    let perfStart = -1
    const _deltaQ = new THREE.Quaternion()
    const _targetQ = new THREE.Quaternion()
    const _euler = new THREE.Euler()

    const prepPerformance = () => {
      if (!vrm || !perf) return
      for (const bone of perf.bones) {
        if (bone === '__root') continue
        // 骨骼名已由 shared 常量约束（CHARACTER_POSE_BONES / 手势库）
        const node = vrm.humanoid?.getNormalizedBoneNode(bone as never)
        if (node) restBones.set(bone, { node, rest: node.quaternion.clone() })
      }
      rootRestY = vrm.scene.position.y
      perfStart = clock.elapsedTime
    }

    const applyPerformance = (pose: PoseDelta, d: number) => {
      const k = 1 - Math.exp(-11 * d)
      for (const [bone, entry] of restBones) {
        const deg = pose[bone]
        _euler.set((deg?.[0] ?? 0) * D2R, (deg?.[1] ?? 0) * D2R, (deg?.[2] ?? 0) * D2R)
        _deltaQ.setFromEuler(_euler)
        _targetQ.copy(entry.rest).multiply(_deltaQ)
        entry.node.quaternion.slerp(_targetQ, k)
      }
      if (vrm && perf?.bones.includes('__root')) {
        const rz = pose['__root']
        const tx = Math.min(2, Math.max(-2, rz?.[0] ?? 0))
        const ty = Math.min(2, Math.max(-2, rz?.[1] ?? 0))
        const tz = Math.min(2, Math.max(-2, rz?.[2] ?? 0))
        vrm.scene.position.x += (tx - vrm.scene.position.x) * k
        vrm.scene.position.y += (rootRestY + ty - vrm.scene.position.y) * k
        vrm.scene.position.z += (tz - vrm.scene.position.z) * k
      }
    }

    // WebGL 探测：失败 → 内联降级视图（不 throw，避免触发卡片错误边界）
    const probe = document.createElement('canvas')
    const glCtx = probe.getContext('webgl2') ?? probe.getContext('webgl')
    if (!glCtx) {
      setStatus({ kind: 'no-webgl' })
      return
    }
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      setStatus({ kind: 'no-webgl' })
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30)
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.2)
    dirLight.position.set(1, 1.6, 1.2)
    scene.add(dirLight)
    scene.add(new THREE.AmbientLight(0xffffff, 0.7))

    const applySize = () => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer!.setSize(w, h, false)
    }
    applySize()

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const delta = clock.getDelta()
      if (vrm) {
        if (mixer) {
          mixer.update(delta)
        } else {
          // 程序化 idle：呼吸（Y 缩放）+ 微摆（Z 旋转）——零资产也有生命感
          const tt = clock.elapsedTime
          vrm.scene.scale.y = 1 + Math.sin(tt * 1.7) * 0.005
          vrm.scene.rotation.z = Math.sin(tt * 0.45) * 0.012
          // 实时表演层（D59）：目标姿态经指数平滑趋近
          if (perf && perfStart >= 0) {
            const T = tt - perfStart
            applyPerformance(T < perf.total ? samplePerformance(perf, T) : EMPTY_POSE, delta)
          }
        }
        vrm.update(delta)
      }
      renderer!.render(scene, camera)
    }

    const load = async () => {
      const loader = new GLTFLoader()
      loader.register((parser) => new VRMLoaderPlugin(parser))
      loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

      const gltf = await loader.loadAsync(data.modelUrl)
      if (disposed) return
      const loadedVrm = (gltf.userData as { vrm?: VRM }).vrm
      if (!loadedVrm) throw new Error('文件不是有效的 VRM 模型')
      vrm = loadedVrm
      try {
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        VRMUtils.removeUnnecessaryJoints(gltf.scene)
      } catch {
        // 顶点优化失败不致命
      }
      vrm.scene.traverse((obj) => {
        obj.frustumCulled = false
      })
      scene.add(vrm.scene)

      // 朝向：VRM0 模型经官方工具转至 +Z 朝向（VRM1 为 no-op，规范模型天生面向 +Z）
      VRMUtils.rotateVRM0(vrm)
      const box = new THREE.Box3().setFromObject(vrm.scene)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const dist = (size.y / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.25
      camera.position.set(0, center.y * 0.98, Math.min(Math.max(dist, 0.8), 10))
      camera.lookAt(0, center.y, 0)

      // 表情：setValue 对模型不认识的名称静默忽略
      for (const ex of data.expression) {
        try {
          vrm.expressionManager?.setValue(ex.name, ex.weight)
        } catch {
          // 忽略未知表情
        }
      }

      // 动作动画（.vrma）：加载失败静默回落到 acts / 程序化 idle
      if (data.animationUrl) {
        try {
          const animGltf = await loader.loadAsync(data.animationUrl)
          if (!disposed) {
            const vrmAnimation = (animGltf.userData as { vrmAnimations?: VRMAnimation[] }).vrmAnimations?.[0]
            if (vrmAnimation) {
              mixer = new THREE.AnimationMixer(vrm.scene)
              mixer.clipAction(createVRMAnimationClip(vrmAnimation, vrm)).play()
            }
          }
        } catch (err) {
          console.warn('[card3d] animation load failed, falling back to acts/idle:', err)
        }
      }

      // 无 .vrma（缺省/失败）→ 启动 acts 实时表演（时间轴锚定在就绪后）
      if (!disposed && !mixer) prepPerformance()

      if (!disposed) setStatus({ kind: 'ready' })
    }

    // 尺寸自适应（容器随卡片布局变化）
    const ro = new ResizeObserver(applySize)
    ro.observe(container)

    // 离屏暂停 RAF（流式滚动中的卡片不空转渲染）
    const io = new IntersectionObserver(
      (entries) => {
        const nextVisible = entries.some((e) => e.isIntersecting)
        if (nextVisible === visible) return
        visible = nextVisible
        if (visible) {
          clock.getDelta() // 丢弃暂停期间累积的时间差
          raf = requestAnimationFrame(tick)
        } else {
          cancelAnimationFrame(raf)
        }
      },
      { threshold: 0.01 },
    )
    io.observe(container)

    raf = requestAnimationFrame(tick)
    load().catch((err) => {
      if (!disposed) {
        setStatus({ kind: 'load-failed', message: err instanceof Error ? err.message : String(err) })
      }
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      try {
        mixer?.stopAllAction()
      } catch {
        // noop
      }
      if (vrm) {
        try {
          VRMUtils.deepDispose(vrm.scene)
        } catch {
          // noop
        }
      }
      try {
        renderer?.dispose()
      } catch {
        // noop
      }
      if (renderer && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
    // 卡片描述符不可变：data 引用稳定，等价于 per-card 一次性初始化
  }, [data])

  return (
    <div className="relative overflow-hidden rounded-md border border-border/60 bg-gradient-to-b from-muted/40 to-muted/10">
      <div ref={containerRef} style={{ height: data.height }} />
      {status.kind === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}
      {status.kind === 'no-webgl' && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {t('chat.card3dUnsupported')}
        </div>
      )}
      {status.kind === 'load-failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
          <div className="text-xs text-destructive">{t('chat.card3dLoadFailed')}</div>
          <div className="max-w-full break-all text-[11px] text-muted-foreground">{status.message}</div>
        </div>
      )}
      {data.caption && (
        <div className="border-t border-border/40 px-3 py-2 text-center text-xs text-muted-foreground">
          {data.caption}
        </div>
      )}
    </div>
  )
}
