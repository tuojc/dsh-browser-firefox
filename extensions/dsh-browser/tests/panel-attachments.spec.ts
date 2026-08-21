// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachmentResponseDataUrl,
  ImageInputError,
  imageRefsFromBlocks,
  parseImageAttachmentLimits,
  prepareImageFiles,
  promptContent,
  type ImageAttachmentLimits,
  type ImageAttachmentRef,
} from '../src/panel/attachments.ts'

const LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 1536,
  maxImagePixels: 1_000_000,
  maxImageDimension: 1200,
  mediaTypes: ['image/png', 'image/jpeg'],
}

afterEach(() => vi.restoreAllMocks())

describe('image capability projection', () => {
  it('accepts only the complete host-owned limits shape', () => {
    expect(parseImageAttachmentLimits(LIMITS)).toEqual(LIMITS)
    expect(parseImageAttachmentLimits({ ...LIMITS, mediaTypes: ['image/svg+xml'] })).toBeNull()
    expect(parseImageAttachmentLimits({ ...LIMITS, maxImageBytes: 0 })).toBeNull()
    expect(parseImageAttachmentLimits(undefined)).toBeNull()
  })
})

describe('prompt image preparation', () => {
  it('encodes a validated browser image for session.prompt', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4234-8234-123456789abc')
    const file = new File([new Uint8Array([1, 2, 3])], 'page.png', { type: 'image/png' })

    const images = await prepareImageFiles([file], [], LIMITS, async () => ({ width: 320, height: 200 }))

    expect(images).toEqual([{
      id: '12345678-1234-4234-8234-123456789abc',
      mediaType: 'image/png',
      data: 'AQID',
      bytes: 3,
      width: 320,
      height: 200,
      name: 'page.png',
    }])
  })

  it('uses the advertised type, count, byte, dimension, and pixel limits', async () => {
    const unsupported = new File(['x'], 'vector.svg', { type: 'image/svg+xml' })
    await expect(prepareImageFiles([unsupported], [], LIMITS)).rejects.toMatchObject({ code: 'unsupported-type' })

    const png = new File(['x'], 'one.png', { type: 'image/png' })
    const existing = [{
      id: 'a', mediaType: 'image/png' as const, data: 'eA==', bytes: 1, width: 1, height: 1,
    }, {
      id: 'b', mediaType: 'image/png' as const, data: 'eA==', bytes: 1, width: 1, height: 1,
    }]
    await expect(prepareImageFiles([png], existing, LIMITS)).rejects.toMatchObject({ code: 'too-many' })
    await expect(prepareImageFiles([png], [], LIMITS, async () => ({ width: 1201, height: 1 })))
      .rejects.toMatchObject({ code: 'dimension-too-large' })
    await expect(prepareImageFiles([png], [], LIMITS, async () => ({ width: 1100, height: 1000 })))
      .rejects.toMatchObject({ code: 'too-many-pixels' })
  })

  it('exposes stable error metadata for localized UI messages', () => {
    expect(new ImageInputError('image-too-large', 'large.png', 42)).toMatchObject({
      name: 'ImageInputError', code: 'image-too-large', imageName: 'large.png', limit: 42,
    })
  })

  it('serializes mixed and image-only drafts to the exact session.prompt union', () => {
    const image = {
      id: 'draft-1', mediaType: 'image/png' as const, data: 'AQID', bytes: 3, width: 2, height: 2, name: 'page.png',
    }
    expect(promptContent('describe this', [image])).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image', mediaType: 'image/png', data: 'AQID', name: 'page.png' },
    ])
    expect(promptContent('', [image])).toEqual([
      { type: 'image', mediaType: 'image/png', data: 'AQID', name: 'page.png' },
    ])
  })
})

describe('durable attachment rendering', () => {
  const attachment: ImageAttachmentRef = {
    attachmentId: 'image-1',
    mediaType: 'image/png',
    bytes: 3,
    width: 2,
    height: 2,
    name: 'page.png',
  }

  it('extracts valid image blocks and ignores malformed references', () => {
    expect(imageRefsFromBlocks([
      { type: 'text', text: 'look' },
      { type: 'image', attachment },
      { type: 'image', attachment: { ...attachment, mediaType: 'image/svg+xml' } },
    ])).toEqual([attachment])
  })

  it('builds a data URL only for a matching, valid session.attachment response', () => {
    expect(attachmentResponseDataUrl({ attachment, data: 'AQID' }, attachment)).toBe('data:image/png;base64,AQID')
    expect(attachmentResponseDataUrl({ attachment: { ...attachment, attachmentId: 'other' }, data: 'AQID' }, attachment)).toBeNull()
    expect(attachmentResponseDataUrl({ attachment, data: '<script>' }, attachment)).toBeNull()
  })
})
