import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Owner, 2026-11-06: cards, rows, sheets and dialogs carry their platform
// through the frosted tint and the VRC/CVR pill only. No solid colored line
// along a card's top or left edge; it read as unpolished.
const componentsDir = dirname(fileURLToPath(import.meta.url))
const mainCss = readFileSync(join(componentsDir, '../assets/main.css'), 'utf8')
const components = readdirSync(componentsDir)
  .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
  .map((name) => ({ name, source: readFileSync(join(componentsDir, name), 'utf8') }))

describe('platform edge stripes', () => {
  it('no component paints a solid platform-colored edge stripe', () => {
    const offenders = components
      .filter(({ source }) =>
        /linear-gradient\(90deg, var\(--(?:vrc|cvr)\), transparent\)/.test(source)
      )
      .map(({ name }) => name)
    expect(offenders).toEqual([])
  })

  it('platform rows have no solid bar on their left edge', () => {
    expect(mainCss).not.toMatch(/\.platform-row(?:--[a-z]+)?::before/)
  })
})
