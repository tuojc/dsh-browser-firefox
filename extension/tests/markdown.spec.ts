// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/panel/markdown.ts'

describe('renderMarkdown', () => {
  it('renders common markdown constructs', () => {
    const html = renderMarkdown('# 标题\n\n**加粗** 和 `code`\n\n- 甲\n- 乙\n\n> 引用')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<li>甲</li>')
    expect(html).toContain('<blockquote>')
  })

  it('renders GFM tables and fenced code blocks', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1\n```')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<pre><code')
    expect(html).toContain('const x = 1')
  })

  it('breaks single newlines into <br> (chat-style text)', () => {
    expect(renderMarkdown('第一行\n第二行')).toContain('<br>')
  })

  it('strips scripts and event handlers (XSS defense)', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n**ok**')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).toContain('<strong>ok</strong>')
  })

  it('strips active and layout-altering raw HTML', () => {
    const html = renderMarkdown('<form action="https://evil.example"><button style="position:fixed;inset:0">伪装界面</button></form><img src="https://evil.example/leak">')
    expect(html).toContain('伪装界面')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('evil.example')
  })

  it('opens http(s) links in a new tab and drops javascript: hrefs', () => {
    const html = renderMarkdown('[官网](https://deepseek.com) [坏链](javascript:alert(1)) [邮件](mailto:a@example.com) [相对路径](/panel)')
    expect(html).toContain('href="https://deepseek.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('mailto:')
    expect(html).not.toContain('href="/panel"')
  })

  it('handles empty and plain input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('plain text')).toContain('plain text')
  })
})
