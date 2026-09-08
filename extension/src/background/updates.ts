/**
 * AMO 更新检查：向 addons.mozilla.org 查已上架版本的最新号，与本地 manifest
 * 版本比较，有新版本时在面板提示。自检失败（未上架/网络错误）一律静默。
 *
 * @module
 */

const AMO_ADDON_ID = 'dsh-browser-firefox@tjc3500.163.com'
const AMO_API_URL = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(AMO_ADDON_ID)}/`
export const AMO_ADDON_PAGE = 'https://addons.mozilla.org/firefox/addon/dsh-browser-firefox/'

/** 语义化比较：a > b 返回正数。只比较数值段，后缀（-beta 等）忽略。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('-')[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export interface AmoUpdateInfo {
  version: string
  url: string
}

/**
 * 查询 AMO 最新版本；有更新返回信息，否则/失败返回 undefined（静默）。
 * @param currentVersion - manifest 版本。
 */
export async function checkAmoUpdate(currentVersion: string): Promise<AmoUpdateInfo | undefined> {
  try {
    const response = await fetch(AMO_API_URL, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return undefined
    const body = await response.json() as { current_version?: { version?: unknown } }
    const latest = body.current_version?.version
    if (typeof latest !== 'string') return undefined
    if (compareVersions(latest, currentVersion) > 0) {
      return { version: latest, url: AMO_ADDON_PAGE }
    }
  } catch {
    // 未上架（404）/离线/CSP 拦截：更新检查是锦上添花，静默。
  }
  return undefined
}
