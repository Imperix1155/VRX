import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainCss = readFileSync(
  new URL('../src/renderer/src/assets/main.css', import.meta.url),
  'utf8'
)

describe('status text tokens', () => {
  it('defines dark and light companion text tokens for every status hue', () => {
    // Dark lifts the two darkest hues toward white so the drawer's status word
    // clears 4.5:1 on the glass; the rest already do.
    expect(mainCss).toMatch(
      /:root\s*{[\s\S]*--st-joinme-text:\s*color-mix\(in srgb, var\(--st-joinme\) 85%, white\)/
    )
    expect(mainCss).toMatch(/:root\s*{[\s\S]*--st-online-text:\s*var\(--st-online\)/)
    expect(mainCss).toMatch(/:root\s*{[\s\S]*--st-askme-text:\s*var\(--st-askme\)/)
    expect(mainCss).toMatch(
      /:root\s*{[\s\S]*--st-dnd-text:\s*color-mix\(in srgb, var\(--st-dnd\) 68%, white\)/
    )
    for (const token of ['--ingame-text', '--active-text', '--offline-text']) {
      expect(mainCss).toMatch(new RegExp(`:root\\s*{[\\s\\S]*${token}:`))
      expect(mainCss).toMatch(new RegExp(`\\[data-theme='light'\\]\\s*{[\\s\\S]*${token}:`))
    }
    expect(mainCss).toMatch(
      /\[data-theme='light'\]\s*{[\s\S]*--st-joinme-text:\s*#124e91;[\s\S]*--st-online-text:\s*#0f6e35;[\s\S]*--st-askme-text:\s*#91480e;[\s\S]*--st-dnd-text:\s*#8d2428;/
    )
  })
})
