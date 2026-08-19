// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('panel layout styles', () => {
  it('keeps the settings view within the viewport so overflowing content scrolls', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const settingsRule = styles.match(/\.settings\s*\{([^}]*)\}/)?.[1]

    expect(settingsRule).toBeDefined()
    expect(settingsRule).toMatch(/(?:^|\n)\s*height:\s*100vh;/)
    expect(settingsRule).toMatch(/(?:^|\n)\s*height:\s*100dvh;/)
    expect(settingsRule).toMatch(/(?:^|\n)\s*overflow-y:\s*auto;/)
    expect(settingsRule).toMatch(/(?:^|\n)\s*overscroll-behavior:\s*contain;/)
  })
})
