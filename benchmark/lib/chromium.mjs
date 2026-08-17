import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const workspaceRequire = createRequire(new URL('../../packages/browser/bridge-browser/package.json', import.meta.url))
export const { chromium } = workspaceRequire('playwright-core')

async function executable(path) {
  if (typeof path !== 'string' || path.trim() === '') return undefined
  try {
    await access(path, constants.X_OK)
    return path
  } catch {
    return undefined
  }
}

async function newestPlaywrightChromium() {
  const cacheRoot = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  let entries
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true })
  } catch {
    return undefined
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory() && /^(?:chromium|chromium_headless_shell)-/u.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name))
  const relativeExecutables = [
    ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ['chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ['chrome-linux', 'chrome'],
    ['chrome-win', 'chrome.exe'],
    ['headless-shell-mac-arm64', 'headless_shell'],
    ['headless-shell-mac', 'headless_shell'],
    ['headless-shell-linux', 'headless_shell'],
    ['headless-shell-win', 'headless_shell.exe'],
  ]
  for (const entry of candidates) {
    for (const parts of relativeExecutables) {
      const found = await executable(join(cacheRoot, entry.name, ...parts))
      if (found !== undefined) return found
    }
  }
  return undefined
}

export async function findChromiumExecutable(override = process.env.PLAYWRIGHT_CHROMIUM_PATH) {
  const explicit = await executable(override)
  if (explicit !== undefined) return explicit
  const bundled = await executable(chromium.executablePath())
  if (bundled !== undefined) return bundled
  for (const candidate of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    const found = await executable(candidate)
    if (found !== undefined) return found
  }
  return newestPlaywrightChromium()
}
