// LawsEditor —— 「编辑世界」对话框：法则 / 状态 两个分页。
//
// 状态页 = 定义编辑（WorldStatesFields）+ 当前值网格（手动修正：叙事者直接干预，
// 兜底纠正结算偏差）。保存一次 PATCH 提交三个可变项（laws / states / values）。
// 世界不需要额外描述：Agent 的人设本身就是身份，法则就是约束，状态就是事实。

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorldStateDef, WorldStateValues } from '@momoi/shared/types'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { WorldStatesFields, normalizeStates } from './WorldStatesFields'

/** 保存载荷：三个可变项一次性提交（服务端逐项校验/对账） */
export interface WorldEditDraft {
  laws: string
  states: WorldStateDef[]
  values: WorldStateValues
}

interface LawsEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  laws: string
  states: WorldStateDef[]
  values: WorldStateValues
  /** 当前世界成员（当前值网格的行） */
  members: Array<{ id: string; name: string }>
  saving: boolean
  onSave: (draft: WorldEditDraft) => Promise<void>
}

export function LawsEditor({ open, onOpenChange, laws, states, values, members, saving, onSave }: LawsEditorProps) {
  const { t } = useTranslation()
  const [draftLaws, setDraftLaws] = useState(laws)
  const [draftStates, setDraftStates] = useState<WorldStateDef[]>(states)
  const [draftValues, setDraftValues] = useState<WorldStateValues>(values)

  // 仅「打开」瞬间对齐到服务端的当前值：避免上一次未保存的草稿在重开后残留；
  // 打开期间的 props 更新（状态卡触发的 worldInfo 刷新）不得清掉正在编辑的草稿
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDraftLaws(laws)
      setDraftStates(states)
      setDraftValues(values)
    }
    wasOpenRef.current = open
  }, [open, laws, states, values])

  const cleanStates = useMemo(() => normalizeStates(draftStates), [draftStates])
  const attrNames = useMemo(() => cleanStates.map((s) => s.name), [cleanStates])

  // 提交形态的当前值：按当前成员 × 当前定义裁剪（草稿里删掉的属性不留孤儿键，
  // 否则服务端校验会以「属性未定义」拒绝）
  const prunedValues = useMemo(() => {
    const attrSet = new Set(attrNames)
    const out: WorldStateValues = {}
    for (const m of members) {
      const row: Record<string, string> = {}
      for (const [k, v] of Object.entries(draftValues[m.id] ?? {})) {
        if (attrSet.has(k)) row[k] = v
      }
      out[m.id] = row
    }
    return out
  }, [members, draftValues, attrNames])

  const dirty = useMemo(() => {
    if (draftLaws !== laws) return true
    if (JSON.stringify(cleanStates) !== JSON.stringify(states)) return true
    // 当前值逐格比较（对键序不敏感）：草稿格 vs 服务端格（缺省回退为定义默认值）
    for (const m of members) {
      const server = values[m.id] ?? {}
      const draft = draftValues[m.id] ?? {}
      for (const s of cleanStates) {
        const a = draft[s.name] ?? s.default
        const b = server[s.name] ?? s.default
        if (a !== b) return true
      }
    }
    return false
  }, [draftLaws, laws, cleanStates, states, members, draftValues, values])

  const setValue = (agentId: string, attr: string, v: string) => {
    setDraftValues((prev) => ({ ...prev, [agentId]: { ...(prev[agentId] ?? {}), [attr]: v } }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('workflow.editWorld')}</DialogTitle>
          <DialogDescription>{t('workflow.worldEditorHint')}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="laws">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="laws">{t('workflow.worldLaws')}</TabsTrigger>
            <TabsTrigger value="states">{t('workflow.worldStates')}</TabsTrigger>
          </TabsList>

          <TabsContent value="laws" className="mt-3">
            <Textarea
              value={draftLaws}
              onChange={(e) => setDraftLaws(e.target.value)}
              rows={6}
              placeholder={t('workflow.lawsPlaceholder')}
              disabled={saving}
            />
          </TabsContent>

          <TabsContent value="states" className="mt-3 space-y-4">
            <div className="space-y-1.5">
              <WorldStatesFields value={draftStates} onChange={setDraftStates} disabled={saving} />
            </div>

            <div className="space-y-1.5 overflow-x-auto">
              <div className="text-xs font-medium text-muted-foreground">{t('workflow.currentValues')}</div>
              {members.length === 0 || attrNames.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('workflow.currentValuesHint')}</p>
              ) : (
                <div className="min-w-[380px] space-y-1.5">
                  <div
                    className="grid items-center gap-2 text-xs text-muted-foreground"
                    style={{ gridTemplateColumns: `110px repeat(${attrNames.length}, minmax(90px, 1fr))` }}
                  >
                    <span />
                    {attrNames.map((n) => (
                      <span key={n} className="truncate">
                        {n}
                      </span>
                    ))}
                  </div>
                  {members.map((m) => (
                    <div
                      key={m.id}
                      className="grid items-center gap-2"
                      style={{ gridTemplateColumns: `110px repeat(${attrNames.length}, minmax(90px, 1fr))` }}
                    >
                      <span className="truncate text-sm">{m.name}</span>
                      {attrNames.map((n) => (
                        <Input
                          key={n}
                          className="h-8"
                          maxLength={60}
                          disabled={saving}
                          value={draftValues[m.id]?.[n] ?? cleanStates.find((s) => s.name === n)?.default ?? ''}
                          onChange={(e) => setValue(m.id, n, e.target.value)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!dirty || saving}
            onClick={async () => {
              await onSave({ laws: draftLaws, states: cleanStates, values: prunedValues })
              onOpenChange(false)
            }}
          >
            {saving ? t('workflow.saving') : t('workflow.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
