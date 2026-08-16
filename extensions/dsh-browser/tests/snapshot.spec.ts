// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ElementIds } from '../src/content/ids.ts'
import { buildSnapshot, renderSnapshot, type SnapshotBudget } from '../src/content/snapshot.ts'

const BUDGET: SnapshotBudget = { maxItems: 10, maxForms: 5, maxChars: 4_000 }

describe('buildSnapshot', () => {
  it('renders title, url, interactive inventory and masked form values', () => {
    document.body.innerHTML = `
      <h1>示例页</h1>
      <a href="/login">登录</a>
      <button>提交</button>
      <input id="email" type="email" value="user@example.com" />
      <input id="pass" type="password" value="hunter2" />
    `
    document.title = '示例页标题'
    const ids = new ElementIds()
    const view = buildSnapshot(ids, { budget: BUDGET }, null)
    expect(view.version).toBe(1)
    expect(view.url).toBe('http://localhost:3000/')
    expect(view.items.length).toBeGreaterThanOrEqual(3)
    const text = renderSnapshot(view, false)
    expect(text).toContain('Title: 示例页标题')
    expect(text).toContain('Main content:')
    expect(text).toContain('Interactive elements:')
    expect(text).toContain('Form fields:')
    expect(text).toContain('登录')
    expect(text).toContain('user@example.com')
    expect(text).toContain('value="••••"')
    expect(text).not.toContain('hunter2')
  })

  it('increments versions and keeps element ids stable', () => {
    document.body.innerHTML = '<button>甲</button><button>乙</button>'
    const ids = new ElementIds()
    const first = buildSnapshot(ids, { budget: BUDGET }, null)
    const second = buildSnapshot(ids, { budget: BUDGET }, first)
    expect(second.version).toBe(2)
    const firstItems = new Map(first.items.map((item) => [item.name, item.index]))
    for (const item of second.items) {
      if (firstItems.has(item.name)) expect(item.index).toBe(firstItems.get(item.name))
    }
  })

  it('delta mode reports only changed and removed ids', () => {
    document.body.innerHTML = '<button id="a">甲</button><button id="b">乙</button>'
    const ids = new ElementIds()
    const first = buildSnapshot(ids, { delta: true, budget: BUDGET }, null)
    expect(first.changed).toEqual([])

    const a = document.getElementById('a')!
    const bIndex = ids.indexOf(document.getElementById('b')!)!
    a.textContent = '甲已改名'
    const second = buildSnapshot(ids, { delta: true, budget: BUDGET }, first)
    expect(second.changed).toContain(ids.indexOf(a))
    expect(second.changed).not.toContain(bIndex)

    document.getElementById('b')!.remove()
    const third = buildSnapshot(ids, { delta: true, budget: BUDGET }, second)
    expect(third.removed).toContain(bIndex)
    expect(renderSnapshot(third, true)).toContain('Removed elements:')
  })

  it('caps inventory by budget and reports drops', () => {
    document.body.innerHTML = Array.from({ length: 25 }, (_, i) => `<button>按钮${i}</button>`).join('')
    const ids = new ElementIds()
    const view = buildSnapshot(ids, { budget: { ...BUDGET, maxItems: 10 }, region: undefined, delta: false }, null)
    expect(view.items.length).toBe(10)
    expect(view.truncated.itemsDropped).toBe(15)
  })

  it('truncates main content at the budget', () => {
    document.body.innerHTML = `<article><p>${'长'.repeat(5_000)}</p></article>`
    const ids = new ElementIds()
    const view = buildSnapshot(ids, { budget: { ...BUDGET, maxChars: 2_000 }, delta: false, region: undefined }, null)
    expect(view.main.length).toBeLessThanOrEqual(1_001)
    expect(view.truncated.mainChars).toBeGreaterThan(3_000)
  })

  it('supports region-scoped snapshots', () => {
    document.body.innerHTML = `
      <div id="sidebar">侧边栏内容</div>
      <div id="content">主体内容区</div>
    `
    const ids = new ElementIds()
    const view = buildSnapshot(ids, { region: '#content', budget: BUDGET }, null)
    expect(view.main).toContain('主体内容区')
    expect(view.main).not.toContain('侧边栏内容')
  })
})
