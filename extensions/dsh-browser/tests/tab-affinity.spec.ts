// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  TabAffinityController,
  type AffinityTab,
} from '../src/background/tab-affinity.ts'

function tab(tabId: number, title = `Tab ${tabId}`): AffinityTab {
  return { tabId, windowId: 1, title, url: `https://example.com/${tabId}` }
}

describe('TabAffinityController', () => {
  it('binds the first tool target and follows metadata updates in place', () => {
    const affinity = new TabAffinityController()
    affinity.observeActive(tab(1))
    expect(affinity.resolveTarget()).toEqual({ kind: 'initial' })

    expect(affinity.bindInitial(tab(1))).toBe(true)
    expect(affinity.snapshot()).toMatchObject({ status: 'following', controlled: { tabId: 1 } })

    affinity.observeTab(tab(1, 'Updated title'))
    expect(affinity.resolveTarget()).toMatchObject({ kind: 'target', tab: { tabId: 1, title: 'Updated title' } })
  })

  it('keeps operating the bound tab in background by default on manual switch', () => {
    const affinity = new TabAffinityController()
    affinity.observeActive(tab(1))
    affinity.bindInitial(tab(1))
    affinity.observeActive(tab(2))
    const state = affinity.snapshot()

    expect(state).toMatchObject({ status: 'background', controlled: { tabId: 1 }, active: { tabId: 2 } })
    expect(affinity.resolveTarget()).toMatchObject({ kind: 'target', tab: { tabId: 1 } })

    expect(affinity.decide('follow', state.revision)).toBe(true)
    expect(affinity.snapshot()).toMatchObject({ status: 'following', controlled: { tabId: 2 } })
  })

  it('supports explicit rebindActive when starting new chat', () => {
    const affinity = new TabAffinityController()
    affinity.observeActive(tab(1))
    affinity.bindInitial(tab(1))
    affinity.observeActive(tab(2))

    expect(affinity.rebindActive(tab(2))).toBe(true)
    expect(affinity.snapshot()).toMatchObject({ status: 'following', controlled: { tabId: 2 }, active: { tabId: 2 } })
    expect(affinity.resolveTarget()).toMatchObject({ kind: 'target', tab: { tabId: 2 } })
  })

  it('does not silently rebind after the controlled tab closes', () => {
    const affinity = new TabAffinityController()
    affinity.observeActive(tab(1))
    affinity.bindInitial(tab(1))
    affinity.observeActive(tab(2))

    expect(affinity.removeTab(1)).toBe(true)
    expect(affinity.snapshot()).toMatchObject({ status: 'lost', controlled: null, active: { tabId: 2 } })
    expect(affinity.resolveTarget()).toEqual({ kind: 'lost' })
    expect(affinity.bindInitial(tab(2))).toBe(false)

    const lost = affinity.snapshot()
    expect(affinity.decide('follow', lost.revision)).toBe(true)
    expect(affinity.snapshot()).toMatchObject({ status: 'following', controlled: { tabId: 2 } })
  })

  it('preserves a following tab when Chrome replaces its identity', () => {
    const affinity = new TabAffinityController()
    affinity.observeActive(tab(1))
    affinity.bindInitial(tab(1))
    const before = affinity.snapshot()

    expect(affinity.replaceTab(1, 9)).toBe(true)
    expect(affinity.snapshot()).toMatchObject({
      revision: before.revision + 1,
      status: 'following',
      controlled: { tabId: 9 },
      active: { tabId: 9 },
    })
    expect(affinity.tracks(1)).toBe(false)
    expect(affinity.allowsTarget(9)).toBe(true)

    affinity.observeTab(tab(9, 'Replacement metadata'))
    expect(affinity.snapshot()).toMatchObject({
      controlled: { tabId: 9, title: 'Replacement metadata' },
      active: { tabId: 9, title: 'Replacement metadata' },
    })
  })

  it('preserves background affinity when either tracked tab is replaced', () => {
    const affinity = new TabAffinityController()
    affinity.observeActive(tab(1))
    affinity.bindInitial(tab(1))
    affinity.observeActive(tab(2))

    expect(affinity.replaceTab(1, 10)).toBe(true)
    expect(affinity.snapshot()).toMatchObject({
      status: 'background',
      controlled: { tabId: 10 },
      active: { tabId: 2 },
    })

    expect(affinity.replaceTab(2, 20)).toBe(true)
    expect(affinity.snapshot()).toMatchObject({
      status: 'background',
      controlled: { tabId: 10 },
      active: { tabId: 20 },
    })
    expect(affinity.allowsTarget(10)).toBe(true)
    expect(affinity.replaceTab(999, 30)).toBe(false)
  })

  it('returns to following status if the user returns to the controlled tab', () => {
    const affinity = new TabAffinityController()
    affinity.observeActive(tab(1))
    affinity.bindInitial(tab(1))
    affinity.observeActive(tab(2))
    affinity.observeActive(tab(1, 'Tab 1 again'))

    expect(affinity.snapshot()).toMatchObject({ status: 'following', controlled: { title: 'Tab 1 again' } })
  })

  it('rehydrates controlled and lost states without allowing a fresh automatic bind', () => {
    const restored = new TabAffinityController()
    expect(restored.restoreControlled(tab(4))).toBe(true)
    restored.observeActive(tab(5))
    expect(restored.snapshot()).toMatchObject({ status: 'background', controlled: { tabId: 4 }, active: { tabId: 5 } })

    const lost = new TabAffinityController()
    expect(lost.restoreLost()).toBe(true)
    lost.observeActive(tab(5))
    expect(lost.resolveTarget()).toEqual({ kind: 'lost' })
    expect(lost.bindInitial(tab(5))).toBe(false)
  })
})
