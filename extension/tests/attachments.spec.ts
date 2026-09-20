// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_LIMITS,
  MAX_TEXT_ATTACHMENT_CHARS,
  ImageInputError,
  isTextAttachable,
  renderTextAttachment,
  toImageContent,
  validateImageBasics,
  validateImageDimensions,
  type DraftImage,
  type DraftText,
} from '../src/panel/attachments.ts'

const { maxImageBytes, maxImageDimension } = DEFAULT_IMAGE_LIMITS

describe('validateImageBasics', () => {
  it('accepts the four supported media types under the byte cap', () => {
    expect(() => validateImageBasics('image/png', 100)).not.toThrow()
    expect(() => validateImageBasics('image/jpeg', maxImageBytes)).not.toThrow()
    expect(() => validateImageBasics('image/webp', 1)).not.toThrow()
    expect(() => validateImageBasics('image/gif', 1)).not.toThrow()
  })

  it('rejects unsupported types and oversized files', () => {
    expect(() => validateImageBasics('image/svg+xml', 10)).toThrowError(ImageInputError)
    expect(() => validateImageBasics('application/pdf', 10)).toThrowError(/不支持的图片类型/)
    expect(() => validateImageBasics('image/png', maxImageBytes + 1)).toThrowError(/上限/)
  })
})

describe('validateImageDimensions', () => {
  it('accepts dimensions at the cap and rejects beyond', () => {
    expect(() => validateImageDimensions(maxImageDimension, 10)).not.toThrow()
    expect(() => validateImageDimensions(maxImageDimension + 1, 10)).toThrowError(/尺寸/)
    expect(() => validateImageDimensions(10, maxImageDimension + 1)).toThrowError(/尺寸/)
  })
})

describe('toImageContent', () => {
  it('maps the draft to an image content block', () => {
    const draft: DraftImage = {
      kind: 'image', id: 'x', mediaType: 'image/png', data: 'aGk=', bytes: 2, width: 10, height: 10, name: 'hi.png',
    }
    expect(toImageContent(draft)).toEqual({ type: 'image', mediaType: 'image/png', data: 'aGk=', name: 'hi.png' })
  })

  it('omits name when absent', () => {
    const draft: DraftImage = { kind: 'image', id: 'x', mediaType: 'image/png', data: 'aGk=', bytes: 2, width: 10, height: 10 }
    const content = toImageContent(draft)
    expect('name' in content).toBe(false)
  })
})

describe('isTextAttachable', () => {
  it('accepts text mimes, json/xml, and known code extensions', () => {
    expect(isTextAttachable('notes', 'text/plain')).toBe(true)
    expect(isTextAttachable('data.bin', 'application/json')).toBe(true)
    expect(isTextAttachable('main.ts', 'application/octet-stream')).toBe(true)
    expect(isTextAttachable('log.yaml', '')).toBe(true)
  })

  it('rejects binaries and unknown types', () => {
    expect(isTextAttachable('a.pdf', 'application/pdf')).toBe(false)
    expect(isTextAttachable('archive.zip', 'application/zip')).toBe(false)
    expect(isTextAttachable('noext', '')).toBe(false)
  })
})

describe('renderTextAttachment', () => {
  it('renders a fenced block with the file name', () => {
    const draft: DraftText = { kind: 'text', id: 'x', name: 'a.md', text: 'hello', truncated: 0 }
    expect(renderTextAttachment(draft)).toBe('\n\n附件 a.md：\n```\nhello\n```')
  })

  it('marks truncation', () => {
    const draft: DraftText = { kind: 'text', id: 'x', name: 'big.log', text: 'partial', truncated: 123 }
    expect(renderTextAttachment(draft)).toContain('已截断 123 字符')
  })
})

describe('readDraftText size cap', () => {
  it('truncates beyond the character cap', async () => {
    const { readDraftText } = await import('../src/panel/attachments.ts')
    const big = new File(['x'.repeat(MAX_TEXT_ATTACHMENT_CHARS + 500)], 'big.txt', { type: 'text/plain' })
    const draft = await readDraftText(big)
    expect(draft.text.length).toBe(MAX_TEXT_ATTACHMENT_CHARS)
    expect(draft.truncated).toBe(500)
  })
})

describe('parseImageAttachmentLimits', () => {
  it('parses the host projection and rejects partial shapes', async () => {
    const { parseImageAttachmentLimits } = await import('../src/panel/attachments.ts')
    const limits = parseImageAttachmentLimits({
      maxImageBytes: 10, maxImagesPerMessage: 2, maxMessageImageBytes: 20,
      maxImagePixels: 100, maxImageDimension: 8, mediaTypes: ['image/png'],
    })
    expect(limits).toEqual({
      maxImageBytes: 10, maxImagesPerMessage: 2, maxMessageImageBytes: 20,
      maxImagePixels: 100, maxImageDimension: 8, mediaTypes: ['image/png'],
    })
    expect(parseImageAttachmentLimits({ maxImageBytes: 10 })).toBeUndefined()
    expect(parseImageAttachmentLimits({
      maxImageBytes: 0, maxImagesPerMessage: 2, maxMessageImageBytes: 20,
      maxImagePixels: 100, maxImageDimension: 8, mediaTypes: ['image/png'],
    })).toBeUndefined()
    expect(parseImageAttachmentLimits(null)).toBeUndefined()
  })
})

describe('host limits override local validation', () => {
  it('a generous host projection admits what defaults reject', async () => {
    const { parseImageAttachmentLimits, validateImageBasics, DEFAULT_IMAGE_LIMITS } = await import('../src/panel/attachments.ts')
    const generous = parseImageAttachmentLimits({
      maxImageBytes: DEFAULT_IMAGE_LIMITS.maxImageBytes * 10,
      maxImagesPerMessage: 8, maxMessageImageBytes: 100 * 1024 * 1024,
      maxImagePixels: 64_000_000, maxImageDimension: 8_000, mediaTypes: ['image/png'],
    })!
    const bytes = DEFAULT_IMAGE_LIMITS.maxImageBytes + 1
    expect(() => validateImageBasics('image/png', bytes)).toThrowError(/上限/)
    expect(() => validateImageBasics('image/png', bytes, generous)).not.toThrow()
  })
})

describe('assertImageBudget', () => {
  it('enforces per-message image count and aggregate bytes', async () => {
    const { assertImageBudget, DEFAULT_IMAGE_LIMITS } = await import('../src/panel/attachments.ts')
    const image = (bytes: number): import('../src/panel/attachments.ts').DraftImage => ({
      kind: 'image', id: 'x', mediaType: 'image/png', data: '', bytes, width: 1, height: 1,
    })
    const four = Array.from({ length: 4 }, () => image(1))
    expect(() => assertImageBudget(four, [image(1)])).toThrowError(/最多/)
    expect(() => assertImageBudget([], [image(DEFAULT_IMAGE_LIMITS.maxMessageImageBytes), image(1)]))
      .toThrowError(/总量/)
    expect(() => assertImageBudget([image(1)], [image(1)])).not.toThrow()
  })
})

describe('imageRefsFromBlocks / attachmentResponseDataUrl', () => {
  it('extracts image refs from content blocks', async () => {
    const { imageRefsFromBlocks } = await import('../src/panel/attachments.ts')
    const blocks = [
      { type: 'text', text: 'hi' },
      { type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png' } },
      { type: 'image', attachment: { mediaType: 'image/png' } }, // 无 attachmentId：丢弃
      { type: 'image', attachment: 'nope' },
    ]
    expect(imageRefsFromBlocks(blocks)).toEqual([{ attachmentId: 'a1', mediaType: 'image/png' }])
    expect(imageRefsFromBlocks('nope')).toEqual([])
  })

  it('validates the session/attachment response before building a data URL', async () => {
    const { attachmentResponseDataUrl } = await import('../src/panel/attachments.ts')
    const expected = { attachmentId: 'a1', mediaType: 'image/png' }
    expect(attachmentResponseDataUrl(
      { attachment: { attachmentId: 'a1', mediaType: 'image/png' }, data: 'aGk=' }, expected,
    )).toBe('data:image/png;base64,aGk=')
    // 串图 / 非 base64 / 缺字段一律拒绝。
    expect(attachmentResponseDataUrl(
      { attachment: { attachmentId: 'a2', mediaType: 'image/png' }, data: 'aGk=' }, expected,
    )).toBeUndefined()
    expect(attachmentResponseDataUrl(
      { attachment: { attachmentId: 'a1' }, data: 'not base64!' }, expected,
    )).toBeUndefined()
    expect(attachmentResponseDataUrl({ attachment: { attachmentId: 'a1' } }, expected)).toBeUndefined()
  })
})
