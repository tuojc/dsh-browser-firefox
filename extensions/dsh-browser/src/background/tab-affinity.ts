/**
 * Pure state machine for binding browser tools to one user-visible tab.
 *
 * The controller separates Chrome event handling from affinity rules.
 * By default, tools stay bound to the original controlled tab in the background
 * when the user switches tabs, avoiding interruption. Users can explicitly
 * rebind/follow when starting a new chat or when the controlled tab is lost.
 *
 * @module
 */

/** Minimal, panel-safe metadata for one Chrome tab. */
export interface AffinityTab {
  tabId: number
  windowId: number
  title: string
  url: string
}

export type TabAffinityStatus = 'unbound' | 'following' | 'handoff' | 'background' | 'lost'
export type TabAffinityDecision = 'keep' | 'follow'

/** Serializable state sent from the service worker to every side panel. */
export interface TabAffinityState {
  revision: number
  status: TabAffinityStatus
  controlled: AffinityTab | null
  active: AffinityTab | null
}

export type TabTargetResolution =
  | { kind: 'initial' }
  | { kind: 'target'; tab: AffinityTab }
  | { kind: 'handoff' }
  | { kind: 'lost' }

function sameTab(left: AffinityTab | null, right: AffinityTab | null): boolean {
  return left?.tabId === right?.tabId
    && left?.windowId === right?.windowId
    && left?.title === right?.title
    && left?.url === right?.url
}

/** Owns the controlled-tab lifecycle for one extension/bridge connection. */
export class TabAffinityController {
  private controlled: AffinityTab | null = null
  private active: AffinityTab | null = null
  private hasBound = false
  private lost = false
  private revision = 0

  snapshot(): TabAffinityState {
    return {
      revision: this.revision,
      status: this.status(),
      controlled: this.controlled === null ? null : { ...this.controlled },
      active: this.active === null ? null : { ...this.active },
    }
  }

  /** Observe the active tab after a user tab/window focus change. */
  observeActive(tab: AffinityTab): boolean {
    const previousActive = this.active
    const previousControlled = this.controlled
    this.active = { ...tab }
    if (this.controlled?.tabId === tab.tabId) {
      this.controlled = { ...tab }
    }
    return this.bumpIfChanged(previousActive, previousControlled)
  }

  /** Refresh title/URL metadata without interpreting it as a tab switch. */
  observeTab(tab: AffinityTab): boolean {
    const previousActive = this.active
    const previousControlled = this.controlled
    if (this.active?.tabId === tab.tabId) this.active = { ...tab }
    if (this.controlled?.tabId === tab.tabId) this.controlled = { ...tab }
    return this.bumpIfChanged(previousActive, previousControlled)
  }

  /** Bind the first prompt/direct browser call to the then-active tab. */
  bindInitial(tab: AffinityTab): boolean {
    if (this.controlled !== null || this.hasBound || this.lost) return false
    this.active = { ...tab }
    this.controlled = { ...tab }
    this.hasBound = true
    this.revision += 1
    return true
  }

  /** Explicitly rebind to the active tab (e.g. when starting a new session). */
  rebindActive(tab: AffinityTab): boolean {
    this.active = { ...tab }
    this.controlled = { ...tab }
    this.hasBound = true
    this.lost = false
    this.revision += 1
    return true
  }

  /** Rehydrate a still-live controlled tab after an MV3 worker restart. */
  restoreControlled(tab: AffinityTab): boolean {
    if (this.controlled !== null || this.hasBound || this.lost) return false
    this.controlled = { ...tab }
    this.hasBound = true
    this.revision += 1
    return true
  }

  /** Rehydrate the fail-closed state when the prior controlled tab was lost. */
  restoreLost(): boolean {
    if (this.controlled !== null || this.hasBound || this.lost) return false
    this.hasBound = true
    this.lost = true
    this.revision += 1
    return true
  }

  /** Remove stale state when Chrome closes a tracked tab. */
  removeTab(tabId: number): boolean {
    if (this.controlled?.tabId !== tabId && this.active?.tabId !== tabId) return false
    const previousActive = this.active
    const previousControlled = this.controlled
    if (this.controlled?.tabId === tabId) {
      this.controlled = null
      this.hasBound = true
      this.lost = true
    }
    if (this.active?.tabId === tabId) this.active = null
    return this.bumpIfChanged(previousActive, previousControlled)
  }

  /** Transfer tracked identity when Chrome replaces a tab without a user switch. */
  replaceTab(removedTabId: number, addedTabId: number): boolean {
    if (removedTabId === addedTabId) return false
    if (this.controlled?.tabId !== removedTabId && this.active?.tabId !== removedTabId) return false
    const previousActive = this.active
    const previousControlled = this.controlled
    if (this.controlled?.tabId === removedTabId) {
      this.controlled = { ...this.controlled, tabId: addedTabId }
    }
    if (this.active?.tabId === removedTabId) {
      this.active = { ...this.active, tabId: addedTabId }
    }
    return this.bumpIfChanged(previousActive, previousControlled)
  }

  /** Apply a panel choice only if it still describes the visible revision. */
  decide(decision: TabAffinityDecision, revision: number): boolean {
    if (revision !== this.revision) return false
    const currentStatus = this.status()
    if (decision === 'keep') {
      this.revision += 1
      return true
    }
    if (this.active === null || (currentStatus !== 'background' && currentStatus !== 'lost' && currentStatus !== 'handoff')) {
      return false
    }
    this.controlled = { ...this.active }
    this.hasBound = true
    this.lost = false
    this.revision += 1
    return true
  }

  /** Resolve whether a tool may run and, if so, which tab owns it. */
  resolveTarget(): TabTargetResolution {
    switch (this.status()) {
      case 'unbound': return { kind: 'initial' }
      case 'lost': return { kind: 'lost' }
      case 'handoff': return { kind: 'handoff' }
      case 'following':
      case 'background':
        return { kind: 'target', tab: { ...this.controlled! } }
    }
  }

  tracks(tabId: number): boolean {
    return this.controlled?.tabId === tabId || this.active?.tabId === tabId
  }

  /** Final dispatch guard for async calls that began before a tab switch. */
  allowsTarget(tabId: number): boolean {
    const resolution = this.resolveTarget()
    return resolution.kind === 'target' && resolution.tab.tabId === tabId
  }

  private status(): TabAffinityStatus {
    if (this.controlled === null) return this.lost ? 'lost' : 'unbound'
    if (this.active?.tabId === this.controlled.tabId) return 'following'
    return 'background'
  }

  private bumpIfChanged(
    previousActive: AffinityTab | null,
    previousControlled: AffinityTab | null,
  ): boolean {
    const changed = !sameTab(previousActive, this.active) || !sameTab(previousControlled, this.controlled)
    if (changed) this.revision += 1
    return changed
  }
}
