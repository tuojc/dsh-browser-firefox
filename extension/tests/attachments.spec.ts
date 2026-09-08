// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
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

describe('validateImageBasics', () => {
  it('accepts the four supported media types under the byte cap', () => {
    expect(() => validateImageBasics('image/png', 100)).not.toThrow()
    expect(() => validateImageBasics('image/jpeg', MAX_IMAGE_BYTES)).not.toThrow()
    expect(() => validateImageBasics('image/webp', 1)).not.toThrow()
    expect(() => validateImageBasics('image/gif', 1)).not.toThrow()
  })

  it('rejects unsupported types and oversized files', () => {
    expect(() => validateImageBasics('image/svg+xml', 10)).toThrowError(ImageInputError)
    expect(() => validateImageBasics('application/pdf', 10)).toThrowError(/不支持的图片类型/)
    expect(() => validateImageBasics('image/png', MAX_IMAGE_BYTES + 1)).toThrowError(/上限/)
  })
})

describe('validateImageDimensions', () => {
  it('accepts dimensions at the cap and rejects beyond', () => {
    expect(() => validateImageDimensions(MAX_IMAGE_DIMENSION, 10)).not.toThrow()
    expect(() => validateImageDimensions(MAX_IMAGE_DIMENSION + 1, 10)).toThrowError(/尺寸/)
    expect(() => validateImageDimensions(10, MAX_IMAGE_DIMENSION + 1)).toThrowError(/尺寸/)
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
