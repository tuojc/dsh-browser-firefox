/**
 * Shared tab helpers for the background: page-readiness waits that the
 * navigate/link-click and tool-dispatch paths both need. A background tab the
 * user switched to may be discarded (unloaded) by Firefox or still loading,
 * and the content script cannot inject until the document is complete.
 *
 * @module
 */

/** Wait for a tab to reach the complete status (bounded); already-complete or absent tabs return immediately. */
export async function waitForTabComplete(tabId: number, timeoutMs = 15_000): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  if (tab === undefined || tab.status === 'complete') return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeoutMs)
    function done(): void {
      clearTimeout(timer)
      browser.tabs.onUpdated.removeListener(onUpdated)
      resolve()
    }
    function onUpdated(updatedTabId: number, changeInfo: { status?: string }): void {
      if (updatedTabId === tabId && changeInfo.status === 'complete') done()
    }
    browser.tabs.onUpdated.addListener(onUpdated)
  })
}
