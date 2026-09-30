// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Manifest {
  manifest_version?: number
  version?: string
  permissions?: string[]
  content_security_policy?: { extension_pages?: string }
  browser_specific_settings?: { gecko?: { id?: string } }
  [key: string]: unknown
}

/** 扩展包目录（vitest 的 cwd 就是它）；先自检，路径不对时大声失败。 */
const packageDir = process.cwd()
const examplePath = join(packageDir, 'manifest.example.json')
const personalPath = join(packageDir, 'manifest.json')
const packagePath = join(packageDir, 'package.json')

function read(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}

/** 构建/加载必需的清单键：少一个就不是可安装的扩展。 */
const EXTENSION_MANIFEST_KEYS = [
  'name',
  'description',
  'browser_specific_settings',
  'permissions',
  'host_permissions',
  'background',
  'action',
  'sidebar_action',
  'content_scripts',
  'icons',
  'content_security_policy',
] as const

/** 代码实际需要的权限：漏一个就是功能静默降级（webNavigation→iframe 聚合，alarms→保活）。 */
const REQUIRED_PERMISSIONS = [
  'storage',
  'tabs',
  'activeTab',
  'scripting',
  'alarms',
  'tabGroups',
  'webNavigation',
] as const

/** 桥的自动检测端口：CSP 必须同时放行 http 与 ws，否则发现/连接被拦。 */
const BRIDGE_PORTS = [3080, 3081, 3090] as const

/** 去掉个人 manifest 里可能存在的私有端口，便于与模板比较。 */
function stripPrivatePorts(csp: string | undefined): string {
  return (csp ?? '').replace(/ ?(http|ws):\/\/127\.0\.0\.1:(14389|43189)/g, '')
}

/**
 * 模板 manifest 守卫。
 *
 * 下面第一组**不依赖** `manifest.json`（个人文件，含 gecko.id，被 .gitignore
 * 排除，CI 里不存在），因此 CI 也能抓住模板漂移——0.4.7 前 example 就漏过
 * webNavigation 与 AMO CSP 源，照抄模板的用户会静默失去 iframe 聚合与更新检查。
 * 第二组只在本地（该文件存在时）执行更严格的逐项比对。
 */
describe('manifest.example.json 自洽性（CI 无个人 manifest 也要跑）', () => {
  it('测试运行在扩展包目录，且模板与 package.json 都在', () => {
    expect(existsSync(examplePath), `找不到模板：${examplePath}`).toBe(true)
    expect(existsSync(packagePath), `找不到 package.json：${packagePath}`).toBe(true)
  })

  const example = read(examplePath)

  it('是 MV3 且必需键齐全', () => {
    expect(example.manifest_version).toBe(3)
    for (const key of EXTENSION_MANIFEST_KEYS) {
      expect(example[key], `模板缺 ${key}`).toBeDefined()
    }
  })

  it('覆盖代码所需的全部权限（含 webNavigation 与 alarms）', () => {
    expect(example.permissions).toEqual(expect.arrayContaining([...REQUIRED_PERMISSIONS]))
  })

  it('CSP 放行桥端口与 AMO（http/ws 都要有）', () => {
    const csp = example.content_security_policy?.extension_pages
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("object-src 'self'")
    for (const port of BRIDGE_PORTS) {
      expect(csp, `CSP 缺 http://127.0.0.1:${port}`).toContain(`http://127.0.0.1:${port}`)
      expect(csp, `CSP 缺 ws://127.0.0.1:${port}`).toContain(`ws://127.0.0.1:${port}`)
    }
    // AMO 更新检查（background fetch）需要该源，否则被 CSP 拦掉
    expect(csp).toContain('https://addons.mozilla.org')
  })

  it('版本与 package.json 同步，gecko.id 仍是模板占位', () => {
    expect(example.version).toBe(read(packagePath).version)
    expect(example.browser_specific_settings?.gecko?.id).toBe('dsh-browser-firefox@example.com')
  })
})

/**
 * 个人 manifest（本地专属）：存在时做逐项严格比对，CI 无此文件则显式跳过。
 * 构建不需要它——vite.shared.ts 在缺失时回退到 manifest.example.json。
 */
const hasPersonalManifest = existsSync(personalPath)

describe.skipIf(!hasPersonalManifest)('manifest.example.json 与真实 manifest 逐项一致（仅本地）', () => {
  // 惰性读取：describe 的回调在收集阶段仍会执行，不能在这里碰磁盘
  // （CI 无该文件时会直接 ENOENT，整个文件变成 0 test）。
  const real = (): Manifest => read(personalPath)
  const example = (): Manifest => read(examplePath)

  it('权限集合与真实 manifest 完全一致', () => {
    expect(example().permissions).toEqual(real().permissions)
  })

  it('CSP 除本地私有端口外与真实 manifest 一致', () => {
    expect(stripPrivatePorts(example().content_security_policy?.extension_pages))
      .toBe(stripPrivatePorts(real().content_security_policy?.extension_pages))
  })

  it('版本与真实 manifest 一致', () => {
    expect(example().version).toBe(real().version)
  })
})
