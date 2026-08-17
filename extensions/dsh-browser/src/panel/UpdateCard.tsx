import { useEffect, useState } from 'react'
import type { PanelCopy } from './strings.ts'
import {
  checkForExtensionUpdate,
  checkoutInstallCommand,
  readExtensionInstallInfo,
  UPDATE_COMMAND,
  type ExtensionInstallInfo,
} from './updates.ts'

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
  const [installInfo, setInstallInfo] = useState<ExtensionInstallInfo | null>(null)

  useEffect(() => {
    let current = true
    void readExtensionInstallInfo(chrome.runtime.getURL('install-info.json')).then((info) => {
      if (current) setInstallInfo(info)
    })
    return () => { current = false }
  }, [])

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
    const command = installInfo?.mode === 'managed'
      ? UPDATE_COMMAND
      : installInfo?.mode === 'checkout'
        ? checkoutInstallCommand(installInfo.sourceRoot)
        : null
    if (command === null) return
    try {
      await navigator.clipboard.writeText(command)
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
  const availableBody = installInfo === null
    ? copy.availableLoadingBody
    : installInfo.mode === 'managed'
      ? copy.availableManagedBody
      : installInfo.mode === 'checkout'
        ? copy.availableCheckoutBody
        : copy.availableUnknownBody
  const statusBody = checkState.status === 'idle'
    ? copy.idleBody
    : checkState.status === 'checking'
      ? copy.checkingBody
      : checkState.status === 'current'
        ? copy.currentBody(checkState.latestVersion)
        : checkState.status === 'available'
          ? availableBody
          : copy.errorBody
  const installMode = installInfo?.mode ?? 'loading'
  const installLabel = installMode === 'managed'
    ? copy.managedInstall
    : installMode === 'checkout'
      ? copy.checkoutInstall
      : installMode === 'unknown'
        ? copy.unknownInstall
        : copy.loadingInstall
  const updateCommandAvailable = installInfo?.mode === 'managed' || installInfo?.mode === 'checkout'
  const copyLabel = installInfo?.mode === 'checkout' ? copy.copyCheckoutCommand : copy.copyManagedCommand

  return (
    <section className={`update-card update-${checkState.status}`} aria-labelledby="update-card-title">
      <div className="update-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="update-card-title">{copy.title}</h2>
        </div>
        <div className="update-meta">
          <span className={`install-pill install-${installMode}`}>{installLabel}</span>
          <span className="version-pill">v{currentVersion}</span>
        </div>
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
        {checkState.status === 'available' && updateCommandAvailable && (
          <button type="button" className="update-copy" onClick={() => { void copyCommand() }}>
            {copyState === 'copied' ? copy.copied : copyLabel}
          </button>
        )}
      </div>
      {copyState === 'error' && <small className="update-copy-error">{copy.copyError}</small>}
    </section>
  )
}
