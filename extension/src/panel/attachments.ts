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

/**
 * 宿主下发的权威图片限制（session/follow snapshot 的
 * projections.values.imageLimits）。未拿到投影前用本地默认值。
 */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}

/** 本地默认限制（宿主投影未到达时使用；比宿主默认值更保守）。 */
export const DEFAULT_IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 5 * 1024 * 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 20 * 1024 * 1024,
  maxImagePixels: 64_000_000,
  maxImageDimension: 8_000,
  mediaTypes: IMAGE_MEDIA_TYPES,
}

/** 每条消息的附件合计上限（图片+文本，本地 UX 限制）。 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4
/** 文本附件上限（超出截断并在内容里标注）。 */
export const MAX_TEXT_ATTACHMENT_CHARS = 20_000

/** 历史消息里图片块的持久化引用（session/attachment 回读字节）。 */
export interface ImageAttachmentRefView {
  attachmentId: string
  mediaType?: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}

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

/** 校验媒体类型与字节数（尺寸在 decode 后校验）。limits 缺省用本地默认。 */
export function validateImageBasics(mediaType: string, bytes: number, limits: ImageAttachmentLimits = DEFAULT_IMAGE_LIMITS): asserts mediaType is ImageMediaType {
  if (!limits.mediaTypes.includes(mediaType as ImageMediaType)) {
    throw new ImageInputError(`不支持的图片类型 ${mediaType}（支持 PNG/JPEG/WebP/GIF）`)
  }
  if (bytes > limits.maxImageBytes) {
    throw new ImageInputError(`图片超过 ${formatBytes(limits.maxImageBytes)} 上限`)
  }
}

/** decode 后的尺寸与像素校验。 */
export function validateImageDimensions(width: number, height: number, limits: ImageAttachmentLimits = DEFAULT_IMAGE_LIMITS): void {
  if (width > limits.maxImageDimension || height > limits.maxImageDimension) {
    throw new ImageInputError(`图片尺寸 ${width}×${height} 超过 ${limits.maxImageDimension}px 上限`)
  }
  if (width * height > limits.maxImagePixels) {
    throw new ImageInputError(`图片像素 ${width}×${height} 超出上限`)
  }
}

/** 消息级预算：图片张数与聚合字节（随宿主投影收紧/放宽）。 */
export function assertImageBudget(
  current: readonly DraftImage[],
  adding: readonly DraftImage[],
  limits: ImageAttachmentLimits = DEFAULT_IMAGE_LIMITS,
): void {
  if (current.length + adding.length > limits.maxImagesPerMessage) {
    throw new ImageInputError(`每条消息最多 ${limits.maxImagesPerMessage} 张图片`)
  }
  const total = [...current, ...adding].reduce((sum, image) => sum + image.bytes, 0)
  if (total > limits.maxMessageImageBytes) {
    throw new ImageInputError(`一条消息的图片总量超过 ${formatBytes(limits.maxMessageImageBytes)} 上限`)
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024) * 10) / 10}MB`
  return `${Math.ceil(bytes / 1024)}KB`
}

/** 从 File 读取图片草稿（dataURL → base64 + 尺寸）。 */
export async function readDraftImage(file: File, limits: ImageAttachmentLimits = DEFAULT_IMAGE_LIMITS): Promise<DraftImage> {
  validateImageBasics(file.type, file.size, limits)
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
  validateImageDimensions(width, height, limits)
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
export async function readDraft(file: File, limits: ImageAttachmentLimits = DEFAULT_IMAGE_LIMITS): Promise<Draft> {
  if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type)) return readDraftImage(file, limits)
  return readDraftText(file)
}

// ---- 宿主投影与历史图片 ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isImageMediaType(value: unknown): value is ImageMediaType {
  return typeof value === 'string' && (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}

/** 解析宿主下发的 imageLimits 投影（不信任流数据，逐字段校验）。 */
export function parseImageAttachmentLimits(value: unknown): ImageAttachmentLimits | undefined {
  if (!isRecord(value)
    || !isPositiveInteger(value.maxImageBytes)
    || !isPositiveInteger(value.maxImagesPerMessage)
    || !isPositiveInteger(value.maxMessageImageBytes)
    || !isPositiveInteger(value.maxImagePixels)
    || !isPositiveInteger(value.maxImageDimension)
    || !Array.isArray(value.mediaTypes)
    || value.mediaTypes.length === 0
    || !value.mediaTypes.every(isImageMediaType)) return undefined
  return {
    maxImageBytes: value.maxImageBytes,
    maxImagesPerMessage: value.maxImagesPerMessage,
    maxMessageImageBytes: value.maxMessageImageBytes,
    maxImagePixels: value.maxImagePixels,
    maxImageDimension: value.maxImageDimension,
    mediaTypes: [...new Set(value.mediaTypes)],
  }
}

/** 解析内容块里的持久化图片引用（attachmentId 必需，其余字段宽松）。 */
export function parseImageAttachmentRef(value: unknown): ImageAttachmentRefView | undefined {
  if (!isRecord(value) || typeof value.attachmentId !== 'string' || value.attachmentId === '') return undefined
  if (value.mediaType !== undefined && typeof value.mediaType !== 'string') return undefined
  if (value.bytes !== undefined && !isPositiveInteger(value.bytes)) return undefined
  if (value.width !== undefined && !isPositiveInteger(value.width)) return undefined
  if (value.height !== undefined && !isPositiveInteger(value.height)) return undefined
  if (value.name !== undefined && typeof value.name !== 'string') return undefined
  return {
    attachmentId: value.attachmentId,
    ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType as string }),
    ...(value.bytes === undefined ? {} : { bytes: value.bytes as number }),
    ...(value.width === undefined ? {} : { width: value.width as number }),
    ...(value.height === undefined ? {} : { height: value.height as number }),
    ...(value.name === undefined ? {} : { name: value.name as string }),
  }
}

/** 从消息内容块中提取全部图片引用（历史渲染用）。 */
export function imageRefsFromBlocks(blocks: unknown): ImageAttachmentRefView[] {
  if (!Array.isArray(blocks)) return []
  const images: ImageAttachmentRefView[] = []
  for (const block of blocks) {
    if (!isRecord(block) || block.type !== 'image') continue
    const attachment = parseImageAttachmentRef(block.attachment)
    if (attachment !== undefined) images.push(attachment)
  }
  return images
}

/** 校验 session/attachment 响应后再放进 img src（防串图/防注入）。 */
export function attachmentResponseDataUrl(value: unknown, expected: ImageAttachmentRefView): string | undefined {
  if (!isRecord(value) || typeof value.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) return undefined
  const attachment = parseImageAttachmentRef(value.attachment)
  if (attachment === undefined || attachment.attachmentId !== expected.attachmentId) return undefined
  const mediaType = attachment.mediaType ?? expected.mediaType ?? 'image/png'
  return `data:${mediaType};base64,${value.data}`
}
