import { describe, expect, it } from 'vitest'
import { ExtensionSessionRegistry, shouldBridgeOwnQuestion } from '../src/extension-sessions.ts'

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
