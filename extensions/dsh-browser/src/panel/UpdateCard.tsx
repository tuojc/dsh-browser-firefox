import { useState } from 'react'
import type { PanelCopy } from './strings.ts'
import { checkForExtensionUpdate, UPDATE_COMMAND } from './updates.ts'

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; latestVersion: string }
  | { status: 'available'; latestVersion: string }
  | { status: 'error' }

type CopyState = 'idle' | 'copied' | 'error'

/** Read-only update check plus the existing managed installer handoff. */
export function UpdateCard({ copy }: { copy: PanelCopy['update'] }): React.JSX.Element {
  const currentVersion = chrome.runtime.getManifest().version
  const [checkState, setCheckState] = useState<CheckState>({ status: 'idle' })
  const [copyState, setCopyState] = useState<CopyState>('idle')

  async function check(): Promise<void> {
    if (checkState.status === 'checking') return
    setCheckState({ status: 'checking' })
    setCopyState('idle')
    try {
      const result = await checkForExtensionUpdate(currentVersion)
      setCheckState(result.updateAvailable
        ? { status: 'available', latestVersion: result.latestVersion }
        : { status: 'current', latestVersion: result.latestVersion })
    } catch {
      setCheckState({ status: 'error' })
    }
  }

  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  const statusTitle = checkState.status === 'idle'
    ? copy.idleTitle
    : checkState.status === 'checking'
      ? copy.checking
      : checkState.status === 'current'
        ? copy.currentTitle
        : checkState.status === 'available'
          ? copy.availableTitle(checkState.latestVersion)
          : copy.errorTitle
  const statusBody = checkState.status === 'idle'
    ? copy.idleBody
    : checkState.status === 'checking'
      ? copy.checkingBody
      : checkState.status === 'current'
        ? copy.currentBody(checkState.latestVersion)
        : checkState.status === 'available'
          ? copy.availableBody
          : copy.errorBody

  return (
    <section className={`update-card update-${checkState.status}`} aria-labelledby="update-card-title">
      <div className="update-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="update-card-title">{copy.title}</h2>
        </div>
        <span className="version-pill">v{currentVersion}</span>
      </div>
      <div className="update-status" role="status" aria-live="polite" aria-busy={checkState.status === 'checking'}>
        <span className="update-beacon" aria-hidden="true" />
        <span>
          <strong>{statusTitle}</strong>
          <small>{statusBody}</small>
        </span>
      </div>
      {checkState.status === 'available' && (
        <div className="update-reload-reminder">
          <span className="update-reload-glyph" aria-hidden="true">↻</span>
          <strong>{copy.reloadReminder}</strong>
        </div>
      )}
      <div className="update-actions">
        <button type="button" className="update-check" disabled={checkState.status === 'checking'}
          onClick={() => { void check() }}>
          {checkState.status === 'checking' ? copy.checking : copy.check}
        </button>
        {checkState.status === 'available' && (
          <button type="button" className="update-copy" onClick={() => { void copyCommand() }}>
            {copyState === 'copied' ? copy.copied : copy.copyCommand}
          </button>
        )}
      </div>
      {copyState === 'error' && <small className="update-copy-error">{copy.copyError}</small>}
    </section>
  )
}
