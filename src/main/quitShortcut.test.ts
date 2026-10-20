import { describe, expect, it } from 'vitest'
import { isQuitShortcut, type QuitShortcutInput } from './quitShortcut'

const base: QuitShortcutInput = {
  type: 'keyDown',
  key: 'q',
  control: true,
  alt: false,
  shift: false,
  meta: false
}

describe('isQuitShortcut', () => {
  it('matches Ctrl+Q in either letter case', () => {
    expect(isQuitShortcut(base)).toBe(true)
    expect(isQuitShortcut({ ...base, key: 'Q' })).toBe(true)
  })

  it('ignores key-up, a bare Q, and other modifier combinations', () => {
    expect(isQuitShortcut({ ...base, type: 'keyUp' })).toBe(false)
    expect(isQuitShortcut({ ...base, control: false })).toBe(false)
    expect(isQuitShortcut({ ...base, shift: true })).toBe(false)
    expect(isQuitShortcut({ ...base, alt: true })).toBe(false)
    expect(isQuitShortcut({ ...base, meta: true })).toBe(false)
    expect(isQuitShortcut({ ...base, key: 'w' })).toBe(false)
  })
})
