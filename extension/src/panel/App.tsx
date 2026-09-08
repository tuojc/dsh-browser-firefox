/**
 * Side panel application: chat with the local dsh agent, plus a settings
 * view. Renders conversation from session history and live session events;
 * browser actions are driven by the model through the bridge tools (the panel
 * only shows tool activity cards).
 *
 * @module
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { BridgeCaps } from 'dsh-browser-firefox/src/protocol.ts'
import type { BridgeState } from '../background/bridge.ts'
import { connectPanel, type PanelApi, type PanelSettings } from './api.ts'
import { renderMarkdown } from './markdown.ts'
import whaleUrl from '../../assets/icons/deepseek-256.png'

/** One rendered conversation row. */
import {
  appendLiveRow,
  completeLastTool,
  mergeHistoryRows,
  rowFromEvent,
  toolSummary,
  type Row,
  type SessionFollowFrameView,
} from './events.ts'

const STATE_LABEL: Record<BridgeState, string> = {
  connected: '已连接',
  connecting: '连接中…',
  reconnecting: '重连中…',
  stopped: '未连接',
  unauthorized: '需要 Token',
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 7.35A2.65 2.65 0 1 0 10 12.65 2.65 2.65 0 0 0 10 7.35Z" />
      <path d="M16.15 11.2a6.4 6.4 0 0 0 0-2.4l1.18-.91-1.5-2.6-1.4.57a6.3 6.3 0 0 0-2.08-1.2L12.15 3h-3l-.2 1.66a6.3 6.3 0 0 0-2.08 1.2l-1.4-.57-1.5 2.6 1.18.91a6.4 6.4 0 0 0 0 2.4l-1.18.91 1.5 2.6 1.4-.57a6.3 6.3 0 0 0 2.08 1.2l.2 1.66h3l.2-1.66a6.3 6.3 0 0 0 2.08-1.2l1.4.57 1.5-2.6-1.18-.91Z" />
    </svg>
  )
}

function PageIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.25 2.75h6.1l3.4 3.4v11.1h-9.5V2.75Z" />
      <path d="M11.25 2.9v3.35h3.35M7.7 10h4.6M7.7 13h4.6" />
    </svg>
  )
}

function SendIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" />
    </svg>
  )
}

function SwapIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.5 5h8l-2.6-2.6M13.5 15h-8l2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

function DownIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.5v11M5.5 11.25 10 15.75 14.5 11.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

function BackIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
    </svg>
  )
}

/**
 * One conversation row body. Memoized: rows are immutable (append/merge copy
 * the array but reuse row objects), so markdown is re-parsed only when a
 * row's text actually changes — typing must not re-render every message.
 */
const MessageBody = memo(function MessageBody({ row }: { row: Row }): React.JSX.Element {
  if (row.kind === 'user' || row.kind === 'assistant') {
    return <div className="body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(row.text) }} />
  }
  return <pre>{row.text}</pre>
})

const ToolActivity = memo(function ToolActivity({ row }: { row: Row }): React.JSX.Element {
  const running = row.status === 'running'
  return (
    <div className={`tool-activity ${running ? 'running' : 'complete'}`} role="status">
      <span className="tool-copy">
        <span className="tool-label">页面操作</span>
        <span className="tool-summary">{row.text}</span>
      </span>
      <span className="tool-state" aria-label={running ? '进行中' : '已完成'}>
        {running ? '进行中' : '完成'}
      </span>
    </div>
  )
})

import { applyWorkspaceFrame, pickCurrentSession, resolveBrowserSessions, type SessionListItem, type SessionView, type WorkspaceFollowFrameView, type WorkspaceView } from './sessions.ts'
import { progressLabel } from './progress.ts'
import { isAtBottom } from './scroll.ts'

export function App(): React.JSX.Element {
  const [api] = useState<PanelApi>(() => connectPanel())
  const [state, setState] = useState<BridgeState>('stopped')
  const [caps, setCaps] = useState<BridgeCaps | null>(null)
  const [settings, setSettings] = useState<PanelSettings | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([])
  const [sessionViews, setSessionViews] = useState<SessionView[]>([])
  /** 本会话内新建、尚未出现在 session/list 里的会话（deferred：首个 prompt 才落库）。 */
  const [localNew, setLocalNew] = useState<SessionListItem[]>([])
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [hostPermission, setHostPermission] = useState<boolean | null>(null)
  const [showJump, setShowJump] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [working, setWorking] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const sessionRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)
  const stickToBottomRef = useRef(true)
  /** 当前会话的 session/follow 订阅关闭函数。 */
  const followCloseRef = useRef<(() => void) | null>(null)
  /** 当前会话的 follow 流是否已死（provisional 会话未物化 / 流失败）。 */
  const followDeadRef = useRef(false)

  const nextSeq = (): number => { seqRef.current += 1; return seqRef.current }

  /** 面板会话列表 = 本地新建（未落库） ∪ browser-sessions 工作区里的宿主会话。 */
  const sessions = useMemo(() => {
    const listed = resolveBrowserSessions(workspaces, sessionViews)
    const known = new Set(listed.map((s) => s.sessionId))
    return [...localNew.filter((s) => !known.has(s.sessionId)), ...listed]
  }, [workspaces, sessionViews, localNew])

  // Firefox MV3：host 权限是可选权限，读取页面前需已授予。
  useEffect(() => {
    void browser.permissions.contains({ origins: ['<all_urls>'] }).then(setHostPermission).catch(() => setHostPermission(null))
  }, [])

  async function grantHostPermission(): Promise<void> {
    try {
      const granted = await browser.permissions.request({ origins: ['<all_urls>'] })
      setHostPermission(granted)
    } catch (error) {
      console.error('[dsh-browser] host permission request failed:', error)
    }
  }

  // Settings: seed from storage, then let the panel own the form.
  useEffect(() => {
    void browser.storage.local.get('dshSettings').then((stored) => {
      const raw = stored.dshSettings as Partial<PanelSettings> | undefined
      setSettings({
        bridgeUrl: raw?.bridgeUrl ?? '',
        token: raw?.token ?? '',
        sharePageContent: raw?.sharePageContent ?? 'ask',
      })
    })
  }, [])

  // 断线重连/设置变更会重置连接；每次进入 connected 或 stopped 都推进 epoch，
  // 驱动会话列表重载与流重订（follow 流是连接代的，重连后必须重开）。
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const lastStateRef = useRef<BridgeState | null>(null)
  useEffect(() => {
    const offStatus = api.onStatus((next, nextCaps) => {
      setState(next)
      setCaps(nextCaps)
      const previous = lastStateRef.current
      lastStateRef.current = next
      if (next === previous) return
      if (next === 'connected') {
        setSessionEpoch((epoch) => epoch + 1)
      } else if (previous !== null && next === 'stopped') {
        followCloseRef.current?.()
        followCloseRef.current = null
        sessionRef.current = null
        setRows([])
        setWorking(false)
        setWorkspaceReady(false)
        setSessionsLoaded(false)
        setSessionEpoch((epoch) => epoch + 1)
      }
    })
    api.requestStatus()
    return () => { offStatus() }
  }, [api])

  /**
   * 带重试的流订阅：首帧到达即视为健康（重置重试）；连续失败 5 次后放弃
   * （onFatalError）。provisional 会话的 session/follow 在物化前必然失败，
   * 首个 prompt 成功后由 send() 主动重开。
   */
  function subscribeWithRetry(
    method: string,
    args: Record<string, unknown>,
    onFrame: (frame: unknown) => void,
    onFatalError: (message: string) => void,
  ): () => void {
    let closed = false
    let retries = 0
    let closeCurrent: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const open = (): void => {
      if (closed) return
      closeCurrent = api.openStream(method, args,
        (frame) => { retries = 0; onFrame(frame) },
        (message) => {
          if (closed) return
          retries += 1
          if (retries > 5) { onFatalError(message); return }
          timer = setTimeout(open, 1_000)
        })
    }
    open()
    return () => {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      closeCurrent?.()
    }
  }

  // workspace 列表：连上后订阅 workspace/follow，本地折 baseline/upsert/remove/order。
  useEffect(() => {
    if (state !== 'connected') return
    const close = subscribeWithRetry('workspace/follow', {},
      (frame) => {
        const f = frame as WorkspaceFollowFrameView
        setWorkspaces((prev) => applyWorkspaceFrame(prev, f))
        if (f.type === 'baseline') setWorkspaceReady(true)
      },
      (message) => { setError(`workspace/follow: ${message}`) })
    return close
    // subscribeWithRetry 每次渲染重建，但它只在挂载时调用；依赖只认连接代。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, sessionEpoch])

  // 会话列表：连上后拉 session/list（args 键是 `_request`）。
  useEffect(() => {
    if (state !== 'connected') return
    let stale = false
    api.rpc<{ items: SessionView[] }>('session/list', { _request: {} })
      .then((result) => {
        if (stale) return
        setSessionViews(result.items)
        setSessionsLoaded(true)
      })
      .catch((cause: unknown) => { if (!stale) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { stale = true }
  }, [state, sessionEpoch])

  // 自动选择当前会话：列表数据（baseline + session/list）齐备后每个 epoch 选一次。
  const pickedEpochRef = useRef(-1)
  useEffect(() => {
    if (state !== 'connected' || !workspaceReady || !sessionsLoaded) return
    if (pickedEpochRef.current === sessionEpoch) return
    pickedEpochRef.current = sessionEpoch
    void (async () => {
      const persisted = await restorePersistedSessionId()
      const current = pickCurrentSession(sessions, persisted)
      if (current !== null) {
        selectSession(current.sessionId)
      } else {
        sessionRef.current = null
        setRows([])
        setCurrentSessionId(null)
      }
    })()
    // selectSession/sessions 的重建不触发重选：epoch 守卫只认连接代。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, sessionEpoch, workspaceReady, sessionsLoaded, sessions])

  // 会话历史与实时事件：session/follow 的首帧 snapshot 渲染历史，后续
  // event 帧实时追加；流无缺口，turn/end 不再需要 history 对账。
  function onFollowFrame(sessionId: string, frame: unknown): void {
    if (sessionRef.current !== sessionId) return
    const f = frame as SessionFollowFrameView
    if (f.type === 'snapshot') {
      followDeadRef.current = false
      setRows(mergeHistoryRows((f.records ?? []).map((record) => record.event), nextSeq))
      return
    }
    const event = f.event
    if (f.type !== 'event' || event === undefined) return
    if (event.type === 'turn/start') {
      setWorking(true)
      return
    }
    const row = rowFromEvent(event)
    if (row !== null) {
      setRows((prev) => appendLiveRow(prev, row.kind, row.text, nextSeq()))
      if (row.kind === 'assistant') setWorking(false)
      return
    }
    if (event.type === 'tool/call') {
      setWorking(true)
      const name = event.data?.name ?? 'tool'
      if (name === 'run_code') return // 内层页面操作由 tool/code-dispatch-start 提供
      const summary = toolSummary(name, event.data?.arguments)
      setRows((prev) => appendLiveRow(prev, 'tool', summary, nextSeq()))
      return
    }
    if (event.type === 'tool/code-dispatch-start') {
      // run_code 内部的真实页面操作（browser_navigate / browser_snapshot …）。
      setWorking(true)
      const summary = toolSummary(event.data?.name ?? 'tool', event.data?.arguments)
      setRows((prev) => appendLiveRow(prev, 'tool', summary, nextSeq()))
      return
    }
    if (event.type === 'tool/result') {
      // 运行中的工具行标记完成；纯代码 run_code（无内层操作）补一行「执行代码」（连续纯代码去重）。
      setRows((prev) => {
        const last = prev[prev.length - 1]
        if (last?.kind === 'tool' && last.status === 'running') return completeLastTool(prev, nextSeq())
        if (last?.kind === 'tool' && last.text.endsWith('执行代码')) return prev
        return completeLastTool(appendLiveRow(prev, 'tool', '执行代码', nextSeq()), nextSeq())
      })
      return
    }
    if (event.type === 'turn/end') {
      setWorking(false)
    }
  }

  /** 打开（或重开）当前会话的 session/follow 订阅。 */
  function openFollow(id: string): void {
    followCloseRef.current?.()
    followDeadRef.current = false
    followCloseRef.current = subscribeWithRetry('session/follow',
      { request: { address: { kind: 'session', sessionId: id } } },
      (frame) => { onFollowFrame(id, frame) },
      (message) => {
        // 重试耗尽：标记为死（首个 prompt 成功后 send() 会重开）。
        followDeadRef.current = true
        console.warn('[dsh-browser] session/follow failed:', message)
      })
  }

  // 断线重连后：当前会话的 follow 是旧连接代的，必须重开。
  useEffect(() => {
    if (state !== 'connected') return
    const id = sessionRef.current
    if (id === null) return
    openFollow(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, sessionEpoch])

  /** 切换当前会话并打开其 follow 流（snapshot 即历史）。 */
  function selectSession(id: string): void {
    sessionRef.current = id
    setCurrentSessionId(id)
    void persistSessionId(id)
    setRows([])
    setWorking(false)
    openFollow(id)
  }

  /** 在 browser-sessions 新建一个会话并置为当前（deferred 到首次 prompt）。 */
  async function createSession(): Promise<void> {
    try {
      const created = await api.rpc<{ sessionId: string }>('session/create', { request: {} })
      sessionRef.current = created.sessionId
      setCurrentSessionId(created.sessionId)
      setRows([])
      setWorking(false)
      void persistSessionId(created.sessionId)
      setLocalNew((prev) => [{ sessionId: created.sessionId, title: '新会话', updatedAt: Date.now() }, ...prev])
      setSessionPickerOpen(false)
      // provisional 会话的 follow 必然先失败几次（物化前），重试足够覆盖到首个 prompt。
      openFollow(created.sessionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const lastRowText = rows[rows.length - 1]?.text

  // Auto-scroll to the newest row, but only while the user is already at the
  // bottom — scrolling up to read history must not yank the view back down.
  useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = scrollRef.current
    if (el === null) return
    // 用 'instant' 而非 'auto'：'.messages' 是 scroll-behavior:smooth，
    // 'auto' 会跟随平滑动画导致内容持续流入时滚动条滞后、到不了最底部。
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
  }, [rows, working, lastRowText])

  // 兜底：内容高度变化（新增行/换行回排/异步加载）时若仍贴底，则重新钉到最底部。
  useEffect(() => {
    const el = scrollRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const body = bodyRef.current
    if (body === null) return
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
    })
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  function onMessagesScroll(): void {
    const el = scrollRef.current
    if (el === null) return
    const atBottom = isAtBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
    stickToBottomRef.current = atBottom
    setShowJump(!atBottom)
  }

  function jumpToBottom(): void {
    const el = scrollRef.current
    if (el === null) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
    stickToBottomRef.current = true
    setShowJump(false)
  }

  // 会话下拉：点击卡片外或按 Escape 关闭。
  useEffect(() => {
    if (!sessionPickerOpen) return
    const onPointerDown = (e: PointerEvent): void => {
      if (cardRef.current !== null && !cardRef.current.contains(e.target as Node)) setSessionPickerOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSessionPickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [sessionPickerOpen])

  async function restorePersistedSessionId(): Promise<string | null> {
    try {
      const stored = await browser.storage.local.get('dshPanelSessionId')
      const id = stored.dshPanelSessionId
      return typeof id === 'string' && id !== '' ? id : null
    } catch {
      return null
    }
  }

  function persistSessionId(id: string): void {
    void browser.storage.local.set({ dshPanelSessionId: id }).catch(() => {})
  }

  const sendingRef = useRef(false)
  async function send(textOverride?: string): Promise<void> {
    const text = (textOverride ?? input).trim()
    // busy state 是异步的：连续回车可能都通过 state 检查——用 ref 同步锁。
    if (text === '' || busy || sendingRef.current || sessionRef.current === null) return
    sendingRef.current = true
    setInput('')
    setBusy(true)
    setWorking(true)
    setError(null)
    // 不渲染乐观行：live user/message 事件即时回显，避免同一消息出现两行。
    try {
      await api.rpc('session/prompt', {
        request: {
          sessionId: sessionRef.current,
          requestId: crypto.randomUUID(),
          mode: 'queue',
          content: [{ type: 'text', text }],
        },
      })
      // 首个 prompt 会物化 deferred 会话：若此前的 follow 已死（物化前必然
      // 失败），现在重开即可拿到含该消息的 snapshot 与后续 live 帧。
      if (followDeadRef.current && sessionRef.current !== null) openFollow(sessionRef.current)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setWorking(false)
    } finally {
      setBusy(false)
      sendingRef.current = false
    }
  }

  /** 终止当前回合（session/cancel），并把面板恢复为可输入。 */
  async function cancelTurn(): Promise<void> {
    const id = sessionRef.current
    if (id === null) return
    try {
      await api.rpc('session/cancel', { request: { sessionId: id } })
    } catch (error) {
      console.error('[dsh-browser] session/cancel failed:', error)
    } finally {
      setWorking(false)
      setBusy(false)
    }
  }

  function saveSettings(): void {
    if (settings === null) return
    api.updateSettings(settings)
    setShowSettings(false)
  }

  // 状态栏只显示连接状态；快照上限是技术细节，在设置页说明（见 hint）。
  const statusText = useMemo(() => STATE_LABEL[state], [state])
  const currentSessionTitle = useMemo(() => {
    if (currentSessionId === null) return null
    return sessions.find((s) => s.sessionId === currentSessionId)?.title ?? '新会话'
  }, [sessions, currentSessionId])

  if (showSettings) {
    return (
      <div className="settings">
        <div className="settings-heading">
          <button className="icon-button" onClick={() => setShowSettings(false)} aria-label="返回对话"><BackIcon /></button>
          <div>
            <span className="eyebrow">偏好设置</span>
            <h1>连接与隐私</h1>
          </div>
        </div>
        <div className="settings-panel">
          <label>
            <span>桥地址</span>
            <small>留空时自动检测本机服务</small>
            <input
              value={settings?.bridgeUrl ?? ''}
              onChange={(e) => setSettings((prev) => prev === null ? prev : { ...prev, bridgeUrl: e.target.value })}
              placeholder="自动检测 3080 / 3081 / 3090"
            />
          </label>
          <label>
            <span>Token</span>
            <small>Firefox 必填：复制 ~/.dsh/ext-bridge-token 文件内容</small>
            <input
              type="password"
              value={settings?.token ?? ''}
              onChange={(e) => setSettings((prev) => prev === null ? prev : { ...prev, token: e.target.value })}
              placeholder="~/.dsh/ext-bridge-token 的内容"
            />
          </label>
          <label>
            <span>页面内容共享</span>
            <small>控制助手何时可以读取页面文字</small>
            <select
              value={settings?.sharePageContent ?? 'ask'}
              onChange={(e) => setSettings((prev) => prev === null ? prev : { ...prev, sharePageContent: e.target.value as PanelSettings['sharePageContent'] })}
            >
              <option value="ask">每次询问</option>
              <option value="auto">自动共享</option>
              <option value="off">关闭</option>
            </select>
          </label>
        </div>
        <div className="settings-actions">
          <button className="primary" onClick={saveSettings}>保存并连接</button>
          <button className="secondary" onClick={() => setShowSettings(false)}>取消</button>
        </div>
        <p className="hint">页面快照上限为 {caps?.snapshotMaxChars ?? 12000} 字符，超出内容会被截断。可在 dsh 插件中调整 snapshotMaxChars。</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><img src={whaleUrl} alt="" /></span>
          <span className="brand-copy"><strong>浏览助手</strong><small>页面副驾驶</small></span>
        </div>
        <span className="connection" role="status"><span className={`dot ${state}`} />{statusText}</span>
        <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="打开设置" title="设置"><SettingsIcon /></button>
      </header>
      {state === 'unauthorized' && (
        <div className="auth-banner" role="alert">
          连接被拒绝：需要访问令牌。请打开设置，将 <code>~/.dsh/ext-bridge-token</code> 文件的内容粘贴到 Token 一栏后保存。
          <button className="secondary" onClick={() => setShowSettings(true)}>打开设置</button>
        </div>
      )}
      {hostPermission === false && (
        <div className="auth-banner permission-banner" role="alert">
          需要授权「访问所有网站数据」才能读取页面内容。
          <button className="secondary" onClick={() => { void grantHostPermission() }}>授权</button>
        </div>
      )}
      <section className="context-card" aria-label="当前会话" ref={cardRef}>
        <span className="context-icon"><PageIcon /></span>
        <span className="context-copy">
          <small>当前会话</small>
          <strong title={currentSessionTitle ?? undefined}>{currentSessionTitle ?? '未选择会话'}</strong>
        </span>
        <button className="context-switcher" onClick={() => setSessionPickerOpen((v) => !v)}
          aria-haspopup="listbox" aria-expanded={sessionPickerOpen} aria-label="切换会话" title="切换会话">
          <SwapIcon />
        </button>
        {sessionPickerOpen && (
          <div className="session-picker" role="listbox" aria-label="会话列表">
            <button className="session-picker-new" onClick={() => { void createSession() }}>
              ＋ 新建会话
            </button>
            {sessions.map((s) => (
              <button key={s.sessionId} role="option" aria-selected={s.sessionId === currentSessionId}
                className={s.sessionId === currentSessionId ? 'active' : ''}
                onClick={() => { setSessionPickerOpen(false); void selectSession(s.sessionId) }}>
                {s.title}
              </button>
            ))}
            {sessions.length === 0 && <span className="session-picker-empty">暂无会话</span>}
          </div>
        )}
      </section>
      <div className="messages" ref={scrollRef} onScroll={onMessagesScroll}>
        <div className="messages-body" ref={bodyRef}>
        {rows.length === 0 && !working && (
          <div className="empty">
            <span className="empty-logo"><img src={whaleUrl} alt="" /></span>
            <div>
              <h1>{sessionRef.current === null ? '从一个会话开始' : '把这个页面交给我'}</h1>
              <p>我可以阅读页面、查找信息，也可以替你点击、填写和导航。</p>
            </div>
            {sessionRef.current === null && (
              <button disabled={state !== 'connected'} onClick={() => { void createSession() }}>
                ＋ 新建会话
              </button>
            )}
          </div>
        )}
        {rows.map((row) => (
          <div key={row.seq} className={`row ${row.kind}`}>
            {row.kind === 'assistant' && <span className="assistant-avatar"><img src={whaleUrl} alt="助手" /></span>}
            {row.kind === 'tool' ? <ToolActivity row={row} /> : <MessageBody row={row} />}
          </div>
        ))}
        {working && (
          <div className="ai-progress" role="status" aria-label="助手正在处理">
            <span className="assistant-avatar"><img src={whaleUrl} alt="" /></span>
            <span className="progress-dots" aria-hidden="true"><i /><i /><i /></span>
            <span>{progressLabel(rows)}</span>
          </div>
        )}
        </div>
        {showJump && (
          <button className="jump-bottom" onClick={jumpToBottom} aria-label="回到底部" title="回到底部"><DownIcon /></button>
        )}
      </div>
      {error !== null && <div className="error">{error}</div>}
      <footer className="composer">
        <div className="composer-box">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // isComposing：输入法组词中的回车是确认选字，不是发送。
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={state === 'connected' ? '告诉我你想在这个会话里做什么…' : '连接 dsh 后即可开始'}
            disabled={state !== 'connected'}
            rows={2}
          />
          <div className="composer-actions">
            <span>Enter 发送 · Shift + Enter 换行</span>
            {working ? (
              <button className="stop" onClick={() => { void cancelTurn() }} aria-label="停止" title="停止生成">■</button>
            ) : (
              <button onClick={() => void send()} disabled={state !== 'connected' || busy || input.trim() === ''} aria-label="发送消息"><SendIcon /></button>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}
