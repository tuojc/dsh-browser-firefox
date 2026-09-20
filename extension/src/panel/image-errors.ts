/**
 * 附件相关错误的展示文案：本地校验错误（ImageInputError）已带中文消息；
 * 宿主权威拒绝走 Remote 错误的 details.reason 词表（alpha 线的错误码是
 * session/attachment-invalid）。
 *
 * @module
 */

import { PanelRpcError } from './api.ts'
import { ImageInputError, type ImageAttachmentLimits } from './attachments.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024) * 10) / 10}MB`
  return `${Math.ceil(bytes / 1024)}KB`
}

/** 附件发送/校验失败的友好文案（本地错误直接透传消息，宿主错误按 reason 映射）。 */
export function imageErrorMessage(cause: unknown, limits?: ImageAttachmentLimits): string {
  if (cause instanceof ImageInputError) return cause.message

  // alpha 线：session/attachment-invalid；保留 attachment-error 以兼容上游词表。
  if (!(cause instanceof PanelRpcError)
    || (cause.code !== 'session/attachment-invalid' && cause.code !== 'attachment-error')) {
    return cause instanceof Error ? cause.message : String(cause)
  }
  const reason = isRecord(cause.details) && typeof cause.details.reason === 'string'
    ? cause.details.reason
    : undefined
  if (reason === undefined) return cause.message

  switch (reason) {
    case 'MODEL_DOES_NOT_SUPPORT_IMAGES':
      return '当前模型不支持图片输入，请切换到支持视觉的模型后再发图片。'
    case 'SUBAGENT_IMAGE_UNSUPPORTED':
      return '子代理的模型不支持图片输入，图片未能发送。'
    case 'INVALID_IMAGE':
    case 'IMAGE_TYPE_MISMATCH':
    case 'UNSUPPORTED_IMAGE_TYPE':
      return '图片无法识别（文件可能损坏或类型不受支持）。'
    case 'TOO_MANY_IMAGES':
      return limits !== undefined ? `每条消息最多 ${limits.maxImagesPerMessage} 张图片。` : '图片数量超出上限。'
    case 'IMAGE_TOO_LARGE':
      return limits !== undefined ? `图片超过 ${formatBytes(limits.maxImageBytes)} 上限。` : '图片体积超出上限。'
    case 'IMAGES_TOO_LARGE':
      return limits !== undefined ? `一条消息的图片总量超过 ${formatBytes(limits.maxMessageImageBytes)} 上限。` : '图片总量超出上限。'
    case 'IMAGE_DIMENSION_TOO_LARGE':
      return limits !== undefined ? `图片边长超过 ${limits.maxImageDimension}px 上限。` : '图片尺寸超出上限。'
    case 'IMAGE_TOO_MANY_PIXELS':
      return limits !== undefined ? `图片像素超过上限（${limits.maxImagePixels}）。` : '图片像素超出上限。'
  }
  return `图片发送失败（${reason}）。`
}
