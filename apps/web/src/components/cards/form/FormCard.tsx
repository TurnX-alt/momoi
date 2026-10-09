import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '../../ui/input'
import { Textarea } from '../../ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select'
import { Slider } from '../../ui/slider'
import { Switch } from '../../ui/switch'
import { Button } from '../../ui/button'
import { cn } from '../../../lib/utils'
import { emitCardAction, markCardConsumed, useCardConsumed } from '../cardInteractionStore'
import { parseFormula, evaluateFormula } from '@momoi/shared/formula'
import type { FormulaNode } from '@momoi/shared/formula'
import type { CardComponentProps } from '../registry'

// 表单卡（M2）：字段渲染 + 客户端必填校验 + 提交发射。
// 提交经 cardInteractionStore 分发到 useGroupChat 的 handler，合成
// card-action 协议消息走既有发送链路（服务端无新端点，D54 决策 5）。

type FormFieldType = 'text' | 'number' | 'textarea' | 'select' | 'multiselect' | 'slider' | 'checkbox' | 'button-group'

const FIELD_TYPES: readonly FormFieldType[] = [
  'text', 'number', 'textarea', 'select', 'multiselect', 'slider', 'checkbox', 'button-group',
]

interface FieldOption { label: string; value: string }

interface FormField {
  type: FormFieldType
  name: string
  label: string
  required: boolean
  placeholder?: string
  options?: FieldOption[]
  min?: number
  max?: number
  step?: number
}

interface FormCompute {
  ast: FormulaNode
  tables: Record<string, Record<string, number>>
  resultLabel?: string
  resultUnit?: string
}

interface FormData {
  description?: string
  fields: FormField[]
  submitLabel?: string
  /** 本地实时计算配置（有则进入计算模式：结果实时显示、不消耗轮次，按钮变为「发送给 AI」） */
  compute?: FormCompute
}

type FieldValue = string | number | boolean | string[]

function parseProps(raw: Record<string, unknown>): FormData {
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) throw new Error('form.fields 缺失')
  const fields: FormField[] = raw.fields.map((f) => {
    const o = f as Record<string, unknown>
    if (!o || typeof o !== 'object') throw new Error('form.fields 条目无效')
    const type = o.type as FormFieldType
    if (!FIELD_TYPES.includes(type)) throw new Error(`未知字段类型：${String(o.type)}`)
    if (typeof o.name !== 'string' || typeof o.label !== 'string') throw new Error('form.fields 条目缺少 name/label')
    const options = Array.isArray(o.options)
      ? (o.options as Array<Record<string, unknown>>).map((op) => ({
          label: String(op.label ?? ''),
          value: typeof op.value === 'string' && op.value ? op.value : String(op.label ?? ''),
        }))
      : undefined
    return {
      type,
      name: o.name,
      label: o.label,
      required: o.required === true,
      placeholder: typeof o.placeholder === 'string' ? o.placeholder : undefined,
      options,
      min: typeof o.min === 'number' ? o.min : undefined,
      max: typeof o.max === 'number' ? o.max : undefined,
      step: typeof o.step === 'number' ? o.step : undefined,
    }
  })
  let compute: FormCompute | undefined
  const rawCompute = raw.compute as Record<string, unknown> | undefined
  if (rawCompute && typeof rawCompute === 'object') {
    const parsed = parseFormula(String(rawCompute.formula ?? ''))
    if (!parsed.ok) throw new Error(`compute.formula 无效：${parsed.error}`)
    const tables: Record<string, Record<string, number>> = {}
    if (Array.isArray(rawCompute.tables)) {
      for (const t of rawCompute.tables as Array<Record<string, unknown>>) {
        const entries: Record<string, number> = {}
        if (Array.isArray(t.entries)) {
          for (const e of t.entries as Array<Record<string, unknown>>) {
            entries[String(e.key)] = Number(e.value)
          }
        }
        tables[String(t.name)] = entries
      }
    }
    compute = {
      ast: parsed.ast,
      tables,
      resultLabel:
        typeof rawCompute.resultLabel === 'string' && rawCompute.resultLabel ? rawCompute.resultLabel : undefined,
      resultUnit:
        typeof rawCompute.resultUnit === 'string' && rawCompute.resultUnit ? rawCompute.resultUnit : undefined,
    }
  }

  return {
    description: typeof raw.description === 'string' && raw.description ? raw.description : undefined,
    fields,
    submitLabel: typeof raw.submitLabel === 'string' && raw.submitLabel ? raw.submitLabel : undefined,
    compute,
  }
}

function initValues(fields: FormField[]): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {}
  for (const f of fields) {
    values[f.name] =
      f.type === 'multiselect' ? [] :
      f.type === 'checkbox' ? false :
      f.type === 'slider' ? (f.min ?? 0) :
      ''
  }
  return values
}

function isMissing(f: FormField, v: FieldValue | undefined): boolean {
  if (!f.required) return false
  if (f.type === 'checkbox') return v !== true
  if (f.type === 'slider') return v == null
  if (f.type === 'multiselect') return !Array.isArray(v) || v.length === 0
  return typeof v !== 'string' || v.trim() === ''
}

/** 结果格式化：整数原样，小数去除浮点噪声（最多 6 位） */
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)))
}

function buildPayload(fields: FormField[], values: Record<string, FieldValue>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const f of fields) {
    const v = values[f.name]
    if (f.type === 'number') {
      if (typeof v === 'string' && v.trim() === '') continue
      const n = Number(v)
      payload[f.name] = Number.isFinite(n) ? n : v
    } else if (f.type === 'checkbox') {
      payload[f.name] = v === true
    } else if (f.type === 'slider') {
      payload[f.name] = Number(v)
    } else if (f.type === 'multiselect') {
      payload[f.name] = Array.isArray(v) ? v : []
    } else {
      if (typeof v === 'string' && v.trim() === '') continue
      payload[f.name] = v
    }
  }
  return payload
}

export function FormCard({ props, cardId, cardTitle, ownerAgentName }: CardComponentProps) {
  const { t } = useTranslation()
  const data = useMemo(() => parseProps(props), [props])
  const consumed = useCardConsumed(cardId)
  const [values, setValues] = useState<Record<string, FieldValue>>(() => initValues(data.fields))
  const [attempted, setAttempted] = useState(false)

  const setField = (name: string, v: FieldValue) => {
    setValues((prev) => ({ ...prev, [name]: v }))
  }

  const toggleOption = (f: FormField, value: string) => {
    setValues((prev) => {
      if (f.type === 'multiselect') {
        const arr = Array.isArray(prev[f.name]) ? (prev[f.name] as string[]) : []
        return { ...prev, [f.name]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] }
      }
      // button-group：再点一次取消选择
      return { ...prev, [f.name]: prev[f.name] === value ? '' : value }
    })
  }

  const invalid = (f: FormField): boolean => attempted && isMissing(f, values[f.name])
  const anyMissing = attempted && data.fields.some((f) => isMissing(f, values[f.name]))

  // 本地实时计算：任何输入变化即求值；失败（缺值/非数/除零）显示占位符，绝不回传
  const result = useMemo(
    () =>
      data.compute
        ? evaluateFormula(data.compute.ast, { valueOf: (f) => values[f], tables: data.compute.tables })
        : null,
    [data.compute, values],
  )

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!cardId || consumed) return
    setAttempted(true)
    if (data.fields.some((f) => isMissing(f, values[f.name]))) return
    const ok = emitCardAction({
      cardId,
      component: 'form',
      action: 'submit',
      label: data.compute ? t('chat.cardSendToAI') : (data.submitLabel ?? t('chat.cardFormSubmit')),
      payload: buildPayload(data.fields, values),
      result: data.compute && result != null ? result : undefined,
      cardTitle,
      ownerAgentName,
    })
    // 计算模式 = 常驻小工具（可反复调参、随时再发送）——不锁定已消费
    if (ok && !data.compute) markCardConsumed(cardId)
  }

  const renderField = (f: FormField) => {
    const v = values[f.name]
    const bad = invalid(f)

    switch (f.type) {
      case 'text':
      case 'number':
        return (
          <Input
            type={f.type === 'number' ? 'number' : 'text'}
            value={typeof v === 'string' ? v : ''}
            placeholder={f.placeholder}
            disabled={consumed}
            aria-invalid={bad || undefined}
            className={cn(bad && 'border-destructive')}
            onChange={(e) => setField(f.name, e.target.value)}
          />
        )
      case 'textarea':
        return (
          <Textarea
            rows={3}
            value={typeof v === 'string' ? v : ''}
            placeholder={f.placeholder}
            disabled={consumed}
            aria-invalid={bad || undefined}
            className={cn(bad && 'border-destructive')}
            onChange={(e) => setField(f.name, e.target.value)}
          />
        )
      case 'select':
        return (
          <Select
            value={typeof v === 'string' ? v : ''}
            onValueChange={(val) => setField(f.name, val)}
            disabled={consumed}
          >
            <SelectTrigger className={cn('w-full', bad && 'border-destructive')}>
              <SelectValue placeholder={f.placeholder ?? t('chat.cardFormSelectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(f.options ?? []).map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      case 'multiselect':
      case 'button-group':
        return (
          <div className={cn('flex flex-wrap gap-1.5', bad && 'rounded-md ring-1 ring-destructive/50 p-1')}>
            {(f.options ?? []).map((op) => {
              const active =
                f.type === 'multiselect'
                  ? Array.isArray(v) && v.includes(op.value)
                  : v === op.value
              return (
                <button
                  key={op.value}
                  type="button"
                  disabled={consumed}
                  onClick={() => toggleOption(f, op.value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-60',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-muted/40 hover:bg-muted',
                  )}
                >
                  {op.label}
                </button>
              )
            })}
          </div>
        )
      case 'slider':
        return (
          <div className="flex items-center gap-3">
            <Slider
              min={f.min ?? 0}
              max={f.max ?? 100}
              step={f.step ?? 1}
              value={typeof v === 'number' ? v : Number(v) || 0}
              onValueChange={(n) => setField(f.name, n)}
              disabled={consumed}
              className="flex-1"
            />
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
              {typeof v === 'number' ? v : ''}
            </span>
          </div>
        )
      case 'checkbox':
        return (
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm">
              {f.label}
              {f.required && <span className="ml-0.5 text-destructive">*</span>}
            </span>
            <Switch
              checked={v === true}
              onCheckedChange={(checked) => setField(f.name, checked)}
              disabled={consumed}
            />
          </label>
        )
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {data.description && <p className="text-xs text-muted-foreground">{data.description}</p>}

      {data.fields.map((f) => (
        <div key={f.name}>
          {f.type !== 'checkbox' && (
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {f.label}
              {f.required && <span className="ml-0.5 text-destructive">*</span>}
            </label>
          )}
          {renderField(f)}
        </div>
      ))}

      {anyMissing && <div className="text-xs text-destructive">{t('chat.cardFormRequired')}</div>}

      {data.compute && (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {data.compute.resultLabel ?? t('chat.cardComputeResult')}
          </span>
          {result != null ? (
            <span className="text-base font-semibold tabular-nums">
              {formatNumber(result)}
              {data.compute.resultUnit && (
                <span className="ml-0.5 text-sm font-medium text-muted-foreground">{data.compute.resultUnit}</span>
              )}
            </span>
          ) : (
            <span
              className="text-base font-semibold text-muted-foreground"
              title={t('chat.cardComputeInvalid')}
            >
              —
            </span>
          )}
        </div>
      )}

      <Button
        type="submit"
        size="sm"
        variant={data.compute ? 'secondary' : 'default'}
        disabled={consumed}
        className="w-full"
      >
        {consumed
          ? t('chat.cardFormSubmitted')
          : data.compute
            ? t('chat.cardSendToAI')
            : (data.submitLabel ?? t('chat.cardFormSubmit'))}
      </Button>
    </form>
  )
}
