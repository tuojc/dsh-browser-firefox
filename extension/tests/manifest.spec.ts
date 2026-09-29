// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Manifest {
  version?: string
  permissions?: string[]
  content_security_policy?: { extension_pages?: string }
  browser_specific_settings?: { gecko?: { id?: string } }
}

function read(file: string): Manifest {
  // vitest 以扩展包目录为 cwd（manifest 就在那里）。
  return JSON.parse(readFileSync(join(process.cwd(), file), 'utf8')) as Manifest
}

/**
 * 模板 manifest 漂移回归：0.4.7 前 example 缺 webNavigation 与 AMO CSP 源，
 * 照抄模板的用户会静默失去 iframe 聚合快照与更新检查。
 */
describe('manifest.example.json 与真实 manifest 一致', () => {
  const real = read('manifest.json')
  const example = read('manifest.example.json')

  it('权限集合一致', () => {
    expect(example.permissions).toEqual(real.permissions)
  })

  it('CSP 除本地私有端口外一致（AMO 更新检查源必须在）', () => {
    const strip = (csp: string | undefined): string => (csp ?? '')
      .replace(/ ?(http|ws):\/\/127\.0\.0\.1:(14389|43189)/g, '')
    expect(strip(example.content_security_policy?.extension_pages)).toBe(strip(real.content_security_policy?.extension_pages))
    expect(example.content_security_policy?.extension_pages).toContain('https://addons.mozilla.org')
    expect(example.permissions).toContain('webNavigation')
  })

  it('版本同步、gecko.id 仍是模板占位', () => {
    expect(example.version).toBe(real.version)
    expect(example.browser_specific_settings?.gecko?.id).toBe('dsh-browser-firefox@example.com')
  })
})
