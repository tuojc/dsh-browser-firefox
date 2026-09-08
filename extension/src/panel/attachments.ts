/**
 * 附件草稿：回形针菜单添加的图片/文本文件，随 session/prompt 的 content
 * 一起发送（图片走宿主多模态块，文本 fenced 拼入消息文本）。
 *
 * 纯校验逻辑不依赖 DOM；readDraftImage/readDraftText 用 FileReader/Image
 * （panel 侧调用）。
 *
 * @module
 */

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type ImageMediaType = typeof IMAGE_MEDIA_TYPES[number]

/** 本地默认限制（宿主未下发 imageLimits 时使用；与上游默认值对齐）。 */
export const MAX_IMAGES_PER_MESSAGE = 4
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 8_000
/** 每条消息的图片+文本附件合计上限。 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4
/** 文本附件上限（超出截断并在内容里标注）。 */
export const MAX_TEXT_ATTACHMENT_CHARS = 20_000

/** 可作为文本附件读取的扩展名（mime 不可靠时用文件名兜底）。 */
const TEXT_FILE_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'log', 'csv', 'tsv', 'xml', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'conf', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'sh',
  'css', 'html', 'htm', 'sql', 'diff', 'patch',
])

export interface DraftImage {
  kind: 'image'
  id: string
  mediaType: ImageMediaType
  /** base64（不含 data: 前缀）。 */
  data: string
  bytes: number
  width: number
  height: number
  name?: string
}

export interface DraftText {
  kind: 'text'
  id: string
  name: string
  /** 文件文本（可能已截断）。 */
  text: string
  /** 截断掉的字符数（0 = 完整）。 */
  truncated: number
}

export type Draft = DraftImage | DraftText

export class ImageInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageInputError'
  }
}

/** 校验媒体类型与字节数（尺寸在 decode 后校验）。 */
export function validateImageBasics(mediaType: string, bytes: number): asserts mediaType is ImageMediaType {
  if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    throw new ImageInputError(`不支持的图片类型 ${mediaType}（支持 PNG/JPEG/WebP/GIF）`)
  }
  if (bytes > MAX_IMAGE_BYTES) {
    throw new ImageInputError(`图片超过 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
  }
}

/** decode 后的尺寸校验。 */
export function validateImageDimensions(width: number, height: number): void {
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new ImageInputError(`图片尺寸 ${width}×${height} 超过 ${MAX_IMAGE_DIMENSION}px 上限`)
  }
}

/** 从 File 读取图片草稿（dataURL → base64 + 尺寸）。 */
export async function readDraftImage(file: File): Promise<DraftImage> {
  validateImageBasics(file.type, file.size)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => { reject(new ImageInputError('图片读取失败')) }
    reader.readAsDataURL(file)
  })
  const comma = dataUrl.indexOf(',')
  if (comma === -1) throw new ImageInputError('图片编码失败')
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => { reject(new ImageInputError('图片解码失败')) }
    img.src = dataUrl
  })
  validateImageDimensions(width, height)
  return {
    kind: 'image',
    id: crypto.randomUUID(),
    mediaType: file.type,
    data: dataUrl.slice(comma + 1),
    bytes: file.size,
    width,
    height,
    ...(file.name !== '' ? { name: file.name } : {}),
  }
}

/** 判断一个文件能否按文本附件读取（mime 或扩展名命中其一）。 */
export function isTextAttachable(name: string, mediaType: string): boolean {
  if (mediaType.startsWith('text/')) return true
  if (mediaType === 'application/json' || mediaType === 'application/xml') return true
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return TEXT_FILE_EXTENSIONS.has(ext)
}

/** 从 File 读取文本草稿（超长截断并记录截断量）。 */
export async function readDraftText(file: File): Promise<DraftText> {
  if (!isTextAttachable(file.name, file.type)) {
    throw new ImageInputError(`不支持的文件类型 ${file.type || file.name}（文本附件支持 txt/md/json/log/csv/代码文件等）`)
  }
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => { reject(new ImageInputError('文件读取失败')) }
    reader.readAsText(file)
  })
  const truncated = Math.max(0, text.length - MAX_TEXT_ATTACHMENT_CHARS)
  return {
    kind: 'text',
    id: crypto.randomUUID(),
    name: file.name === '' ? '未命名.txt' : file.name,
    text: truncated > 0 ? text.slice(0, MAX_TEXT_ATTACHMENT_CHARS) : text,
    truncated,
  }
}

/** 图片草稿转 prompt image content 块。 */
export function toImageContent(draft: DraftImage): { type: 'image'; mediaType: ImageMediaType; data: string; name?: string } {
  return {
    type: 'image',
    mediaType: draft.mediaType,
    data: draft.data,
    ...(draft.name !== undefined ? { name: draft.name } : {}),
  }
}

/** 文本附件渲染为 fenced block（拼入消息文本；标注文件名与截断）。 */
export function renderTextAttachment(draft: DraftText): string {
  const note = draft.truncated > 0 ? `（已截断 ${draft.truncated} 字符）` : ''
  return `\n\n附件 ${draft.name}${note}：\n\`\`\`\n${draft.text}\n\`\`\``
}

/** 把一个 File 读成草稿（图片或文本，按类型分流）。 */
export async function readDraft(file: File): Promise<Draft> {
  if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type)) return readDraftImage(file)
  return readDraftText(file)
}
