import { useEffect, useRef, useState } from 'react'
import {
  findCatalogModel,
  modelDisplayName,
  sameSelection,
  type ModelCatalogView,
  type ModelSelectionView,
} from './models.ts'

/**
 * 会话栏的模型选择芯片：点击展开按 provider 分组的目录，当前项打勾；
 * 有 reasoning efforts 的当前模型在下方给 effort 次级选择；目录拉取失败
 * 或 provider 未配置密钥（不可路由）时给出对应提示。
 */
export function ModelPicker({
  catalog,
  catalogError,
  selection,
  busy,
  disabled,
  onSelect,
  onRetry,
}: {
  catalog: ModelCatalogView | null
  catalogError: string | null
  /** 当前选择（含 deferred 会话的乐观 pending 值）；null = 宿主默认。 */
  selection: ModelSelectionView | null
  busy: boolean
  disabled: boolean
  onSelect: (selection: ModelSelectionView) => void
  onRetry: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const currentEntry = selection === null ? undefined : findCatalogModel(catalog, selection.provider, selection.model)
  const efforts = currentEntry?.reasoning?.efforts ?? []

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        className={`model-chip${busy ? ' busy' : ''}`}
        onClick={() => { setOpen((value) => !value) }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择模型"
        title={`当前模型：${modelDisplayName(catalog, selection)}`}
      >
        <span className="model-chip-name">{busy ? '切换中…' : modelDisplayName(catalog, selection)}</span>
        <svg viewBox="0 0 10 6" aria-hidden="true" className="model-chip-caret">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="model-menu" role="listbox" aria-label="模型目录">
          {catalog === null && catalogError === null && <div className="model-menu-note">目录加载中…</div>}
          {catalogError !== null && (
            <div className="model-menu-note">
              <span>{catalogError}</span>
              <button className="model-menu-retry" onClick={onRetry}>重试</button>
            </div>
          )}
          {catalog !== null && catalog.groups.map((group) => {
            const routable = catalog.routableProviders.includes(group.id)
            return (
              <div key={group.id} className={`model-group${routable ? '' : ' unroutable'}`}>
                <div className="model-group-name">
                  {group.name}
                  {!routable && <span className="model-group-tag">未配置</span>}
                </div>
                {group.models.map((model) => {
                  const candidate: ModelSelectionView = {
                    provider: group.id,
                    model: model.id,
                    ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
                  }
                  const active = sameSelection(selection, candidate)
                    || (selection !== null && selection.provider === group.id && selection.model === model.id)
                  return (
                    <div key={model.id}>
                      <button
                        className={`model-row${active ? ' active' : ''}`}
                        role="option"
                        aria-selected={active}
                        disabled={!routable || busy}
                        onClick={() => {
                          setOpen(false)
                          // 已选中的模型不重复上行（effort 调整走下面的次级行）。
                          if (!sameSelection(selection, candidate)) onSelect(candidate)
                        }}
                      >
                        <span className="model-row-check" aria-hidden="true">{active ? '✓' : ''}</span>
                        <span className="model-row-text">
                          <strong>{model.name}</strong>
                          {model.description !== undefined && model.description !== '' && <small>{model.description}</small>}
                        </span>
                      </button>
                      {active && efforts.length > 1 && (
                        <div className="model-efforts" role="group" aria-label="推理强度">
                          {efforts.map((effort) => {
                            const effortActive = selection?.reasoningEffort === effort.id
                              || (selection?.reasoningEffort === undefined && currentEntry?.reasoning?.defaultEffort === effort.id)
                            return (
                              <button
                                key={effort.id}
                                className={`model-effort${effortActive ? ' active' : ''}`}
                                disabled={busy}
                                title={effort.description}
                                onClick={() => {
                                  setOpen(false)
                                  if (!effortActive && selection !== null) onSelect({ ...selection, reasoningEffort: effort.id })
                                }}
                              >
                                {effort.name}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
          {catalog !== null && catalog.failures.length > 0 && (
            <div className="model-menu-note">
              {catalog.failures.length} 个提供商目录加载失败：{catalog.failures.map((failure) => failure.name).join('、')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
