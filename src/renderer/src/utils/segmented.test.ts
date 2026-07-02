import { describe, expect, it } from 'vitest'
import { segArrowTarget } from './segmented'

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
