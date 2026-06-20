import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainCss = readFileSync(
  new URL('../src/renderer/src/assets/main.css', import.meta.url),
  'utf8'
)

describe('status text tokens', () => {
  it('defines dark and light companion text tokens for every status hue', () => {
    expect(mainCss).toMatch(/:root\s*{[\s\S]*--st-joinme-text:\s*var\(--st-joinme\)/)
    expect(mainCss).toMatch(/:root\s*{[\s\S]*--st-online-text:\s*var\(--st-online\)/)
    expect(mainCss).toMatch(/:root\s*{[\s\S]*--st-askme-text:\s*var\(--st-askme\)/)
    expect(mainCss).toMatch(/:root\s*{[\s\S]*--st-dnd-text:\s*var\(--st-dnd\)/)
    expect(mainCss).toMatch(
      /\[data-theme='light'\]\s*{[\s\S]*--st-joinme-text:\s*#124e91;[\s\S]*--st-online-text:\s*#0f6e35;[\s\S]*--st-askme-text:\s*#91480e;[\s\S]*--st-dnd-text:\s*#8d2428;/
    )
  })
})
