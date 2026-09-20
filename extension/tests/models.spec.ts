// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { PanelRpcError } from '../src/panel/api.ts'
import {
  currentSelection,
  findCatalogModel,
  modelDisplayName,
  modelSelectErrorMessage,
  parseModelCatalog,
  parseModelSelection,
  parseModelSelectionProjection,
  sameSelection,
  type ModelCatalogView,
} from '../src/panel/models.ts'

const CATALOG_JSON = {
  default: { provider: 'deepseek', model: 'deepseek-chat' },
  routableProviders: ['deepseek'],
  groups: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', description: '通用对话' },
        {
          id: 'deepseek-reasoner', name: 'DeepSeek Reasoner',
          reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'low' },
        },
      ],
    },
    { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
  ],
  failures: [{ id: 'anthropic', name: 'Anthropic', message: '未配置密钥' }],
}

describe('parseModelCatalog', () => {
  it('parses the host catalog shape', () => {
    const catalog = parseModelCatalog(CATALOG_JSON)
    expect(catalog).toBeDefined()
    expect(catalog!.defaultSelection).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(catalog!.groups).toHaveLength(2)
    expect(catalog!.groups[0]!.models[1]!.reasoning?.efforts).toHaveLength(2)
    expect(catalog!.groups[0]!.models[1]!.reasoning?.defaultEffort).toBe('low')
    expect(catalog!.failures[0]).toEqual({ id: 'anthropic', name: 'Anthropic', message: '未配置密钥' })
  })

  it('rejects malformed catalogs', () => {
    expect(parseModelCatalog(null)).toBeUndefined()
    expect(parseModelCatalog({ ...CATALOG_JSON, default: { provider: 'x' } })).toBeUndefined()
    expect(parseModelCatalog({ ...CATALOG_JSON, routableProviders: [1] })).toBeUndefined()
    expect(parseModelCatalog({ ...CATALOG_JSON, groups: [{ id: 'g', name: 'G', models: [{ id: 1, name: 'm' }] }] })).toBeUndefined()
    expect(parseModelCatalog({ ...CATALOG_JSON, failures: [{ id: 'x' }] })).toBeUndefined()
  })
})

describe('parseModelSelectionProjection / currentSelection', () => {
  it('prefers next over lastUsed', () => {
    const proj = parseModelSelectionProjection({
      lastUsed: { provider: 'a', model: 'm1' },
      next: { provider: 'b', model: 'm2', reasoningEffort: 'high' },
    })
    expect(proj).toBeDefined()
    expect(currentSelection(proj!)).toEqual({ provider: 'b', model: 'm2', reasoningEffort: 'high' })
    expect(currentSelection(parseModelSelectionProjection({ lastUsed: { provider: 'a', model: 'm1' }, next: null })!))
      .toEqual({ provider: 'a', model: 'm1' })
    expect(currentSelection(parseModelSelectionProjection({ lastUsed: null, next: null })!)).toBeNull()
  })

  it('rejects malformed projections', () => {
    expect(parseModelSelectionProjection(null)).toBeUndefined()
    expect(parseModelSelectionProjection({ lastUsed: { provider: 'a' }, next: null })).toBeUndefined()
    expect(parseModelSelectionProjection({ lastUsed: null })).toBeUndefined()
    expect(parseModelSelectionProjection({ lastUsed: null, next: { provider: 'a', model: 'm', reasoningEffort: 1 } })).toBeUndefined()
  })
})

describe('selection helpers', () => {
  const catalog = parseModelCatalog(CATALOG_JSON) as ModelCatalogView

  it('sameSelection compares provider/model/effort', () => {
    expect(sameSelection({ provider: 'a', model: 'm' }, { provider: 'a', model: 'm' })).toBe(true)
    expect(sameSelection({ provider: 'a', model: 'm' }, { provider: 'a', model: 'm', reasoningEffort: 'low' })).toBe(false)
    expect(sameSelection(null, null)).toBe(true)
    expect(sameSelection(null, { provider: 'a', model: 'm' })).toBe(false)
  })

  it('findCatalogModel looks up entries', () => {
    expect(findCatalogModel(catalog, 'deepseek', 'deepseek-reasoner')?.name).toBe('DeepSeek Reasoner')
    expect(findCatalogModel(catalog, 'deepseek', 'nope')).toBeUndefined()
    expect(findCatalogModel(null, 'deepseek', 'deepseek-chat')).toBeUndefined()
  })

  it('modelDisplayName prefers catalog names and annotates effort', () => {
    expect(modelDisplayName(catalog, { provider: 'deepseek', model: 'deepseek-chat' })).toBe('DeepSeek Chat')
    expect(modelDisplayName(catalog, { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }))
      .toBe('DeepSeek Reasoner · high')
    expect(modelDisplayName(catalog, { provider: 'x', model: 'unknown' })).toBe('unknown')
    expect(modelDisplayName(catalog, null)).toBe('默认模型')
  })
})

describe('parseModelSelection', () => {
  it('requires provider and model strings', () => {
    expect(parseModelSelection({ provider: 'a', model: 'm', reasoningEffort: 'low' }))
      .toEqual({ provider: 'a', model: 'm', reasoningEffort: 'low' })
    expect(parseModelSelection({ provider: 'a' })).toBeUndefined()
    expect(parseModelSelection('nope')).toBeUndefined()
  })
})

describe('modelSelectErrorMessage', () => {
  it('maps host failures to readable copy', () => {
    expect(modelSelectErrorMessage(new PanelRpcError('session/model-unavailable', 'x', { provider: 'openai', model: 'gpt-5' })))
      .toContain('openai/gpt-5')
    expect(modelSelectErrorMessage(new PanelRpcError('session/not-found', 'x', {})))
      .toContain('首条消息')
    expect(modelSelectErrorMessage(new PanelRpcError('gateway/internal', 'boom', {}))).toBe('boom')
    expect(modelSelectErrorMessage(new Error('plain'))).toBe('plain')
    expect(modelSelectErrorMessage('str')).toBe('str')
  })
})

describe('permission short labels', () => {
  it('covers every level with a short label', async () => {
    const { PERMISSION_LEVEL_SHORT, PERMISSION_LEVEL_LABELS, PERMISSION_LEVEL_HINTS } = await import('../src/panel/permissions.ts')
    for (const level of ['locked', 'read', 'readwrite'] as const) {
      expect(PERMISSION_LEVEL_SHORT[level].length).toBeGreaterThan(0)
      expect(PERMISSION_LEVEL_LABELS[level]).toContain(PERMISSION_LEVEL_SHORT[level])
      expect(PERMISSION_LEVEL_HINTS[level].length).toBeGreaterThan(0)
    }
  })
})
