// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { focusRadioSibling, segArrowTarget } from './segmented'

// Pins the radiogroup keyboard contract (audit W5): arrows move with wrap,
// everything else passes through untouched.
describe('segArrowTarget', () => {
  it.each([
    ['ArrowRight', 0, 1],
    ['ArrowDown', 0, 1],
    ['ArrowLeft', 1, 0],
    ['ArrowUp', 1, 0]
  ])('%s from index %i → %i', (key, index, expected) => {
    expect(segArrowTarget(key, index, 3)).toBe(expected)
  })

  it('wraps forward at the end and backward at the start', () => {
    expect(segArrowTarget('ArrowRight', 2, 3)).toBe(0)
    expect(segArrowTarget('ArrowLeft', 0, 3)).toBe(2)
  })

  it('returns null for non-arrow keys (Tab, Enter, letters)', () => {
    expect(segArrowTarget('Tab', 0, 3)).toBeNull()
    expect(segArrowTarget('Enter', 0, 3)).toBeNull()
    expect(segArrowTarget('a', 0, 3)).toBeNull()
  })
})

describe('focusRadioSibling', () => {
  it('focuses the radio at the target index — even when radios gain wrappers', () => {
    // Radios deliberately WRAPPED in extra elements: the group-scoped lookup
    // (closest radiogroup, not parentElement) must still find them in order.
    document.body.innerHTML = `
      <div role="radiogroup">
        <span aria-hidden="true"></span>
        <span><button role="radio" id="r0"></button></span>
        <span><button role="radio" id="r1"></button></span>
        <span><button role="radio" id="r2"></button></span>
      </div>`
    const r0 = document.getElementById('r0')!

    focusRadioSibling(r0, 2)

    expect(document.activeElement?.id).toBe('r2')
  })

  it('no-ops safely outside any radiogroup', () => {
    document.body.innerHTML = `<button role="radio" id="lone"></button>`
    const lone = document.getElementById('lone')!
    expect(() => focusRadioSibling(lone, 1)).not.toThrow()
  })
})
