// WorldStatesFields —— 世界状态属性定义编辑器（「新工作流」对话框与「编辑世界」
// 对话框共用）：每行 = 属性名 / 默认值 / 描述；≤12 行（与服务端 MAX_STATE_ATTRS
// 一致，提交前经 normalizeStates 修剪；具体校验以服务端为准）。

import { useTranslation } from 'react-i18next'
import type { WorldStateDef } from '@momoi/shared/types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Plus, X } from 'lucide-react'

/** 与服务端 lib/world-state.ts 的 MAX_STATE_ATTRS 一致 */
export const MAX_STATE_ATTRS = 12

/** 提交前归整：修剪空白、丢弃完全空行、省略空描述（与服务端校验对齐） */
export function normalizeStates(value: WorldStateDef[]): WorldStateDef[] {
  return value
    .map((s) => {
      const name = s.name.trim()
      const def = s.default.trim()
      const desc = (s.description ?? '').trim()
      return { name, default: def, ...(desc ? { description: desc } : {}) }
    })
    .filter((s) => s.name || s.default || s.description)
}

interface WorldStatesFieldsProps {
  value: WorldStateDef[]
  onChange: (value: WorldStateDef[]) => void
  disabled?: boolean
}

export function WorldStatesFields({ value, onChange, disabled }: WorldStatesFieldsProps) {
  const { t } = useTranslation()

  const update = (i: number, patch: Partial<WorldStateDef>) => {
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  const remove = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i))
  }
  const add = () => {
    onChange([...value, { name: '', default: '', description: '' }])
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_1.3fr_auto] items-center gap-2 text-xs text-muted-foreground">
          <span>{t('workflow.stateName')}</span>
          <span>{t('workflow.stateDefault')}</span>
          <span>{t('workflow.stateDesc')}</span>
          <span className="w-8" />
        </div>
      )}
      {value.map((s, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1.3fr_auto] items-center gap-2">
          <Input
            className="h-8"
            value={s.name}
            maxLength={20}
            disabled={disabled}
            placeholder={t('workflow.stateNamePlaceholder')}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <Input
            className="h-8"
            value={s.default}
            maxLength={60}
            disabled={disabled}
            placeholder={t('workflow.stateDefaultPlaceholder')}
            onChange={(e) => update(i, { default: e.target.value })}
          />
          <Input
            className="h-8"
            value={s.description ?? ''}
            maxLength={100}
            disabled={disabled}
            placeholder={t('workflow.stateDescPlaceholder')}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={disabled}
            aria-label={t('workflow.removeState')}
            onClick={() => remove(i)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {value.length < MAX_STATE_ATTRS ? (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={add}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('workflow.addState')}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{t('workflow.statesLimit', { limit: MAX_STATE_ATTRS })}</p>
      )}
    </div>
  )
}
