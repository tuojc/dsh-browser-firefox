// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  canAcceptImageSelection,
  emptyComposerDraft,
  restoreSubmittedDraft,
} from '../src/panel/composer.ts'

describe('image picker admission', () => {
  it('rejects a picker result that returns during prompt admission', () => {
    expect(canAcceptImageSelection(false, true)).toBe(false)
    expect(canAcceptImageSelection(true, false)).toBe(false)
    expect(canAcceptImageSelection(false, false)).toBe(true)
  })
})

describe('rejected prompt draft restoration', () => {
  const submitted = {
    text: 'describe this image',
    images: [{ id: 'submitted-image' }],
  }

  it('restores the complete submission when the composer is still empty', () => {
    expect(restoreSubmittedDraft(emptyComposerDraft(), submitted)).toBe(submitted)
  })

  it('does not mix rejected images into a newer text-only draft', () => {
    const newer = { text: 'newer text', images: [] as { id: string }[] }
    expect(restoreSubmittedDraft(newer, submitted)).toBe(newer)
  })

  it('does not mix rejected text into a newer image-only draft', () => {
    const newer = { text: '', images: [{ id: 'newer-image' }] }
    expect(restoreSubmittedDraft(newer, submitted)).toBe(newer)
  })
})
