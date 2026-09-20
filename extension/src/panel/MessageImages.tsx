import { memo, useEffect, useMemo, useState } from 'react'
import type { PanelApi } from './api.ts'
import { attachmentResponseDataUrl, type ImageAttachmentRefView } from './attachments.ts'

/** 历史/回显消息里的图片：按 attachmentId 经 session/attachment 回读字节渲染，点击放大。 */

function imageFit(attachment: ImageAttachmentRefView): { width: number; height: number; objectPosition: string } {
  const width = attachment.width ?? 0
  const height = attachment.height ?? 0
  const naturalRatio = width > 0 && height > 0 ? width / height : 1
  const ratio = Math.min(4, Math.max(0.25, naturalRatio))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  const scale = width > 0 && height > 0 ? Math.min(1, width / box.width, height / box.height) : 1
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: naturalRatio < 0.25 ? 'center top' : naturalRatio > 4 ? 'left center' : 'center',
  }
}

const MessageImage = memo(function MessageImage({
  attachment,
  sessionId,
  api,
  single,
}: {
  attachment: ImageAttachmentRefView
  sessionId: string
  api: PanelApi
  single: boolean
}): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const fit = useMemo(() => imageFit(attachment), [attachment])
  const label = attachment.name ?? '图片'

  useEffect(() => {
    let current = true
    setSrc(null)
    setFailed(false)
    void api.rpc('session/attachment', {
      request: { sessionId, attachmentId: attachment.attachmentId },
    }).then((value) => {
      if (!current) return
      const url = attachmentResponseDataUrl(value, attachment)
      if (url === undefined) setFailed(true)
      else setSrc(url)
    }).catch(() => { if (current) setFailed(true) })
    return () => { current = false }
  }, [api, attachment, attempt, sessionId])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close) }
  }, [open])

  if (failed) {
    return (
      <button type="button" className="message-image-error" onClick={() => { setAttempt((value) => value + 1) }}>
        图片加载失败，点击重试
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        className={`message-image ${single ? 'single' : 'tile'}`}
        style={single ? { width: fit.width, height: fit.height } : undefined}
        disabled={src === null}
        title="查看大图"
        aria-label={`查看图片 ${label}`}
        onClick={() => { setOpen(true) }}
      >
        {src === null
          ? <span>图片加载中…</span>
          : <img src={src} alt={label} style={single ? { objectPosition: fit.objectPosition } : undefined} />}
      </button>
      {open && src !== null && (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览"
          onClick={() => { setOpen(false) }}>
          <button type="button" aria-label="关闭预览" onClick={() => { setOpen(false) }}>×</button>
          <img src={src} alt={label} onClick={(event) => { event.stopPropagation() }} />
        </div>
      )}
    </>
  )
})

export const MessageImages = memo(function MessageImages({
  images,
  sessionId,
  api,
  align,
}: {
  images: readonly ImageAttachmentRefView[]
  sessionId: string
  api: PanelApi
  align: 'start' | 'end'
}): React.JSX.Element | null {
  if (images.length === 0) return null
  return (
    <div className={`message-images ${align}`}>
      {images.map((attachment, index) => (
        <MessageImage
          key={`${attachment.attachmentId}:${index}`}
          attachment={attachment}
          sessionId={sessionId}
          api={api}
          single={images.length === 1}
        />
      ))}
    </div>
  )
})
