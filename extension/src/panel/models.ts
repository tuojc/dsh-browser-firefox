/**
 * 模型选择器数据层：session/modelCatalog 目录与 modelSelection 投影的
 * 解析（逐字段校验，不信任流数据），以及错误文案映射。
 *
 * 宿主合同（0.1.2 线 typert.host.js 核实）：
 *  - session/modelCatalog() → ModelCatalog
 *  - session/selectModel {request:{sessionId, provider, model, reasoningEffort?}} → {selected}
 *  - follow snapshot projections.values.modelSelection: {lastUsed, next}
 *
 * @module
 */

import { PanelRpcError } from './api.ts'

export interface ModelReasoningEffortView {
  id: string
  name: string
  description?: string
}

export interface ModelCatalogModelView {
  id: string
  name: string
  description?: string
  reasoning?: { efforts: ModelReasoningEffortView[]; defaultEffort?: string }
}

export interface ModelGroupView {
  id: string
  name: string
  models: ModelCatalogModelView[]
}

export interface ModelCatalogView {
  defaultSelection: ModelSelectionView
  routableProviders: string[]
  groups: ModelGroupView[]
  failures: { id: string; name: string; message: string }[]
}

export interface ModelSelectionView {
  provider: string
  model: string
  reasoningEffort?: string
}

/** follow 投影的 modelSelection 值。 */
export interface ModelSelectionProjectionView {
  lastUsed: ModelSelectionView | null
  next: ModelSelectionView | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析一个 ModelSelection（provider/model 必填，reasoningEffort 可选）。 */
export function parseModelSelection(value: unknown): ModelSelectionView | undefined {
  if (!isRecord(value) || typeof value.provider !== 'string' || typeof value.model !== 'string') return undefined
  if (value.reasoningEffort !== undefined && typeof value.reasoningEffort !== 'string') return undefined
  return {
    provider: value.provider,
    model: value.model,
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort as string }),
  }
}

/** 当前生效/将生效的选择：next（下一轮用）优先，其次 lastUsed。 */
export function currentSelection(proj: ModelSelectionProjectionView): ModelSelectionView | null {
  return proj.next ?? proj.lastUsed
}

/** 解析 follow snapshot 投影里的 modelSelection。 */
export function parseModelSelectionProjection(value: unknown): ModelSelectionProjectionView | undefined {
  if (!isRecord(value)) return undefined
  let lastUsed: ModelSelectionView | null
  if (value.lastUsed === null) lastUsed = null
  else {
    const parsed = parseModelSelection(value.lastUsed)
    if (parsed === undefined) return undefined
    lastUsed = parsed
  }
  let next: ModelSelectionView | null
  if (value.next === null) next = null
  else {
    const parsed = parseModelSelection(value.next)
    if (parsed === undefined) return undefined
    next = parsed
  }
  return { lastUsed, next }
}

/** 解析 session/modelCatalog 响应。 */
export function parseModelCatalog(value: unknown): ModelCatalogView | undefined {
  if (!isRecord(value)) return undefined
  const defaultSelection = parseModelSelection(value.default)
  if (defaultSelection === undefined) return undefined
  if (!Array.isArray(value.routableProviders) || value.routableProviders.some((p) => typeof p !== 'string')) return undefined
  if (!Array.isArray(value.groups) || !Array.isArray(value.failures)) return undefined

  const groups: ModelGroupView[] = []
  for (const rawGroup of value.groups) {
    if (!isRecord(rawGroup) || typeof rawGroup.id !== 'string' || typeof rawGroup.name !== 'string'
      || !Array.isArray(rawGroup.models)) return undefined
    const models: ModelCatalogModelView[] = []
    for (const rawModel of rawGroup.models) {
      if (!isRecord(rawModel) || typeof rawModel.id !== 'string' || typeof rawModel.name !== 'string') return undefined
      if (rawModel.description !== undefined && typeof rawModel.description !== 'string') return undefined
      let reasoning: ModelCatalogModelView['reasoning']
      if (rawModel.reasoning !== undefined) {
        if (!isRecord(rawModel.reasoning) || !Array.isArray(rawModel.reasoning.efforts)) return undefined
        const efforts: ModelReasoningEffortView[] = []
        for (const rawEffort of rawModel.reasoning.efforts) {
          if (!isRecord(rawEffort) || typeof rawEffort.id !== 'string' || typeof rawEffort.name !== 'string') return undefined
          if (rawEffort.description !== undefined && typeof rawEffort.description !== 'string') return undefined
          efforts.push({
            id: rawEffort.id,
            name: rawEffort.name,
            ...(rawEffort.description === undefined ? {} : { description: rawEffort.description as string }),
          })
        }
        if (rawModel.reasoning.defaultEffort !== undefined && typeof rawModel.reasoning.defaultEffort !== 'string') return undefined
        reasoning = {
          efforts,
          ...(rawModel.reasoning.defaultEffort === undefined ? {} : { defaultEffort: rawModel.reasoning.defaultEffort as string }),
        }
      }
      models.push({
        id: rawModel.id,
        name: rawModel.name,
        ...(rawModel.description === undefined ? {} : { description: rawModel.description as string }),
        ...(reasoning === undefined ? {} : { reasoning }),
      })
    }
    groups.push({ id: rawGroup.id, name: rawGroup.name, models })
  }

  const failures: ModelCatalogView['failures'] = []
  for (const rawFailure of value.failures) {
    if (!isRecord(rawFailure) || typeof rawFailure.id !== 'string'
      || typeof rawFailure.name !== 'string' || typeof rawFailure.message !== 'string') return undefined
    failures.push({ id: rawFailure.id, name: rawFailure.name, message: rawFailure.message })
  }

  return {
    defaultSelection,
    routableProviders: value.routableProviders as string[],
    groups,
    failures,
  }
}

/** 两个选择是否指向同一路由（比较 provider/model/effort）。 */
export function sameSelection(a: ModelSelectionView | null, b: ModelSelectionView | null): boolean {
  if (a === null || b === null) return a === b
  return a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort
}

/** 在目录中查找模型条目（用于 effort 行与展示名）。 */
export function findCatalogModel(
  catalog: ModelCatalogView | null,
  provider: string,
  model: string,
): ModelCatalogModelView | undefined {
  return catalog?.groups.find((group) => group.id === provider)?.models.find((entry) => entry.id === model)
}

/** selectModel 失败的友好文案。 */
export function modelSelectErrorMessage(cause: unknown): string {
  if (cause instanceof PanelRpcError) {
    if (cause.code === 'session/model-unavailable') {
      const details = cause.details
      const where = typeof details.provider === 'string' && typeof details.model === 'string'
        ? `${details.provider}/${details.model}`
        : '所选模型'
      return `模型不可用：${where}（可能未配置密钥或已被移除）。`
    }
    if (cause.code === 'session/not-found') return '会话尚未在宿主创建，发送首条消息后会自动应用该模型。'
    return cause.message
  }
  return cause instanceof Error ? cause.message : String(cause)
}

/** 芯片上的短展示名：模型 id（目录里找得到则用 name）。 */
export function modelDisplayName(
  catalog: ModelCatalogView | null,
  selection: ModelSelectionView | null,
): string {
  if (selection === null) return '默认模型'
  const entry = findCatalogModel(catalog, selection.provider, selection.model)
  const base = entry?.name ?? selection.model
  return selection.reasoningEffort === undefined ? base : `${base} · ${selection.reasoningEffort}`
}
