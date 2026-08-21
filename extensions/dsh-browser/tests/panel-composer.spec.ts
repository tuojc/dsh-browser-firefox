// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { restoreSubmittedImages, restoreSubmittedText } from '../src/panel/composer.ts'

describe('rejected prompt draft restoration', () => {
  it('restores the cleared submission', () => {
    const images = [{ id: 'submitted-image' }]
    expect(restoreSubmittedText('', 'describe this image')).toBe('describe this image')
    expect(restoreSubmittedImages([], images)).toBe(images)
  })

  it('does not overwrite edits made while the rejected request was pending', () => {
    const newerImages = [{ id: 'newer-image' }]
    expect(restoreSubmittedText('newer text', 'submitted text')).toBe('newer text')
    expect(restoreSubmittedImages(newerImages, [{ id: 'submitted-image' }])).toBe(newerImages)
  })
})
