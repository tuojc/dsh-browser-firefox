import { describe, expect, it } from 'vitest'
import {
  ExtensionSessionRegistry,
  FollowedSessions,
  owningSessionId,
  resolveInteractionOwnership,
  shouldBridgeOwnQuestion,
} from '../src/extension-sessions.ts'

describe('ExtensionSessionRegistry', () => {
  it('notes and checks session ids', () => {
    const registry = new ExtensionSessionRegistry()
    expect(registry.has('s1')).toBe(false)
    registry.note('s1')
    expect(registry.has('s1')).toBe(true)
    expect(registry.has('s2')).toBe(false)
    registry.clear()
    expect(registry.has('s1')).toBe(false)
  })

  it('ignores undefined and empty ids', () => {
    const registry = new ExtensionSessionRegistry()
    registry.note(undefined)
    registry.note('')
    expect(registry.has(undefined)).toBe(false)
    expect(registry.has('')).toBe(false)
  })
})

describe('shouldBridgeOwnQuestion', () => {
  const registry = new ExtensionSessionRegistry()
  registry.note('owned')

  it('claims only connected + capable + extension-owned sessions', () => {
    expect(shouldBridgeOwnQuestion({
      hasExtensionConnection: true, clientSupportsQuestions: true, sessionId: 'owned', extensionSessions: registry,
    })).toBe(true)
  })

  it('defers when any gate fails', () => {
    expect(shouldBridgeOwnQuestion({
      hasExtensionConnection: false, clientSupportsQuestions: true, sessionId: 'owned', extensionSessions: registry,
    })).toBe(false)
    expect(shouldBridgeOwnQuestion({
      hasExtensionConnection: true, clientSupportsQuestions: false, sessionId: 'owned', extensionSessions: registry,
    })).toBe(false)
    expect(shouldBridgeOwnQuestion({
      hasExtensionConnection: true, clientSupportsQuestions: true, sessionId: 'foreign', extensionSessions: registry,
    })).toBe(false)
    expect(shouldBridgeOwnQuestion({
      hasExtensionConnection: true, clientSupportsQuestions: true, sessionId: undefined, extensionSessions: registry,
    })).toBe(false)
  })
})

describe('FollowedSessions', () => {
  it('owns a session while a follow stream is open, reference-counted', () => {
    const followed = new FollowedSessions()
    expect(followed.has('s1')).toBe(false)
    followed.open('s1')
    expect(followed.has('s1')).toBe(true)
    followed.open('s1')
    followed.close('s1')
    expect(followed.has('s1')).toBe(true)
    followed.close('s1')
    expect(followed.has('s1')).toBe(false)
  })

  it('ignores empty ids, tolerates stray closes, and clears wholesale', () => {
    const followed = new FollowedSessions()
    followed.open(undefined)
    followed.open('')
    followed.close('missing')
    expect(followed.has('')).toBe(false)
    followed.open('s1')
    followed.clear()
    expect(followed.has('s1')).toBe(false)
  })
})

describe('owningSessionId', () => {
  const registry = new ExtensionSessionRegistry()
  registry.note('root')
  const followed = new FollowedSessions()
  const sources = { driven: registry, followed }
  const parents: Record<string, string> = { child: 'root', grandchild: 'child', deep1: 'deep2', deep2: 'deep3' }
  const parentOf = (id: string): string | undefined => parents[id]

  it('returns the asking session when it is owned directly', () => {
    expect(owningSessionId('root', sources, parentOf)).toBe('root')
  })

  it('inherits an owned ancestor for subagent child sessions', () => {
    expect(owningSessionId('child', sources, parentOf)).toBe('root')
    expect(owningSessionId('grandchild', sources, parentOf)).toBe('root')
  })

  it('never claims an unrelated chain', () => {
    expect(owningSessionId('stranger', sources, parentOf)).toBeUndefined()
    expect(owningSessionId(undefined, sources, parentOf)).toBeUndefined()
  })

  it('honours followed sessions as owners', () => {
    followed.open('watched')
    expect(owningSessionId('watched', sources, parentOf)).toBe('watched')
    followed.close('watched')
    expect(owningSessionId('watched', sources, parentOf)).toBeUndefined()
  })

  it('works without a parent lookup and stops at the depth cap', () => {
    expect(owningSessionId('child', sources)).toBeUndefined()
    expect(owningSessionId('deep1', sources, parentOf)).toBeUndefined()
  })

  it('survives a parent cycle', () => {
    const cyclic = (id: string): string | undefined => (id === 'a' ? 'b' : 'a')
    expect(owningSessionId('a', sources, cyclic)).toBeUndefined()
  })
})

describe('resolveInteractionOwnership', () => {
  const registry = new ExtensionSessionRegistry()
  registry.note('root')
  const sources = { driven: registry }
  const parentOf = (id: string): string | undefined => (id === 'child' ? 'root' : undefined)

  it('reports the owned session id and the failing gate', () => {
    expect(resolveInteractionOwnership({
      hasExtensionConnection: true, clientSupports: true, sessionId: 'child', sources, parentOf,
    })).toEqual({ owned: true, sessionId: 'root' })
    expect(resolveInteractionOwnership({
      hasExtensionConnection: false, clientSupports: true, sessionId: 'root', sources, parentOf,
    })).toEqual({ owned: false, reason: 'no-connection' })
    expect(resolveInteractionOwnership({
      hasExtensionConnection: true, clientSupports: false, sessionId: 'root', sources, parentOf,
    })).toEqual({ owned: false, reason: 'unsupported-client' })
    expect(resolveInteractionOwnership({
      hasExtensionConnection: true, clientSupports: true, sessionId: 'foreign', sources, parentOf,
    })).toEqual({ owned: false, reason: 'not-owned' })
  })
})
