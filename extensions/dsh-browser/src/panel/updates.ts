/**
 * Release checks for the unpacked browser extension.
 *
 * The managed installer follows the repository's main branch, so that
 * branch's manifest is the update source of truth. The check is deliberately
 * read-only: Chrome does not let an unpacked extension replace itself.
 */

export const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/Lum1104/dsh-browser/refs/heads/main/extensions/dsh-browser/manifest.json'

export const UPDATE_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/Lum1104/dsh-browser/refs/heads/main/scripts/install.sh | bash'

export interface ExtensionUpdateResult {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
}

function versionParts(version: string): number[] {
  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) throw new Error('invalid extension version')
  return version.split('.').map((part) => Number(part))
}

/** Compare Chrome's one-to-four-part numeric extension versions. */
export function compareExtensionVersions(left: string, right: string): number {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

/** Fetch the main-branch manifest and compare it with the running extension. */
export async function checkForExtensionUpdate(
  currentVersion: string,
  request: typeof fetch = fetch,
): Promise<ExtensionUpdateResult> {
  versionParts(currentVersion)
  const response = await request(UPDATE_MANIFEST_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error(`update manifest request failed (${response.status})`)

  const manifest = await response.json() as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('update manifest has no version')
  versionParts(manifest.version)

  return {
    currentVersion,
    latestVersion: manifest.version,
    updateAvailable: compareExtensionVersions(currentVersion, manifest.version) < 0,
  }
}
