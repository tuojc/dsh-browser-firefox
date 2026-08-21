/** Product copy for local image admission and authoritative Host rejections. */

import { PanelRpcError } from './api.ts'
import { ImageInputError, type ImageAttachmentLimits } from './attachments.ts'
import type { PanelCopy } from './strings.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024) * 10) / 10} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

/** Match dsh's `attachment-error.details.reason` vocabulary without guessing model ids. */
export function imageErrorMessage(
  cause: unknown,
  copy: PanelCopy,
  limits?: ImageAttachmentLimits,
): string {
  if (cause instanceof ImageInputError) {
    const name = cause.imageName ?? copy.app.image
    switch (cause.code) {
      case 'unsupported-type': return copy.app.imageUnsupported(name)
      case 'too-many': return copy.app.imageTooMany(cause.limit ?? 0)
      case 'image-too-large': return copy.app.imageTooLarge(name, formatBytes(cause.limit ?? 0))
      case 'message-too-large': return copy.app.imageMessageTooLarge(formatBytes(cause.limit ?? 0))
      case 'dimension-too-large': return copy.app.imageDimensionTooLarge(name, cause.limit ?? 0)
      case 'too-many-pixels': return copy.app.imagePixelsTooLarge(name, cause.limit ?? 0)
      case 'decode-failed': return copy.app.imageDecodeFailed(name)
    }
  }

  if (!(cause instanceof PanelRpcError) || cause.code !== 'attachment-error') {
    return cause instanceof Error ? cause.message : String(cause)
  }
  const reason = isRecord(cause.details) && typeof cause.details.reason === 'string'
    ? cause.details.reason
    : undefined
  if (reason === undefined) return cause.message

  switch (reason) {
    case 'MODEL_DOES_NOT_SUPPORT_IMAGES': return copy.app.imageModelUnsupported
    case 'SUBAGENT_IMAGE_UNSUPPORTED': return copy.app.imageSubagentUnsupported
    case 'INVALID_IMAGE':
    case 'IMAGE_TYPE_MISMATCH':
    case 'UNSUPPORTED_IMAGE_TYPE': return copy.app.imageUnsupported(copy.app.image)
    case 'TOO_MANY_IMAGES':
      if (limits !== undefined) return copy.app.imageTooMany(limits.maxImagesPerMessage)
      break
    case 'IMAGE_TOO_LARGE':
      if (limits !== undefined) return copy.app.imageTooLarge(copy.app.image, formatBytes(limits.maxImageBytes))
      break
    case 'IMAGES_TOO_LARGE':
      if (limits !== undefined) return copy.app.imageMessageTooLarge(formatBytes(limits.maxMessageImageBytes))
      break
    case 'IMAGE_DIMENSION_TOO_LARGE':
      if (limits !== undefined) return copy.app.imageDimensionTooLarge(copy.app.image, limits.maxImageDimension)
      break
    case 'IMAGE_TOO_MANY_PIXELS':
      if (limits !== undefined) return copy.app.imagePixelsTooLarge(copy.app.image, limits.maxImagePixels)
      break
  }
  return copy.app.imageSendFailed(reason)
}
