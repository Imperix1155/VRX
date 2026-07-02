/**
 * loadSettings "never throws" contract (2026-07 audit W7 review, finding M1).
 *
 * conf's `store` getter RETHROWS on a corrupted settings.json (only ENOENT is
 * swallowed). With the throw escaping loadSettings, the W7 bootstrap .catch
 * would exit-loop the app on every launch until the user hand-deleted the file.
 * Pins: a throwing store read falls back to in-memory defaults.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'

const storeState = vi.hoisted((): { throwOnRead: boolean; data: Record<string, unknown> } => ({
  throwOnRead: false,
  data: {}
}))

vi.mock('electron-store', () => ({
  default: class {
    get store(): Record<string, unknown> {
      if (storeState.throwOnRead) throw new SyntaxError('Unexpected token in JSON at position 0')
      return storeState.data
    }
    set store(_value: Record<string, unknown>) {
      /* persisted-back path — not under test */
    }
  }
}))

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { loadSettings } from './settings'

beforeEach(() => {
  storeState.throwOnRead = false
  storeState.data = {}
})

describe('loadSettings (W7 M1)', () => {
  it('falls back to defaults instead of throwing when the store read throws (corrupted file)', () => {
    storeState.throwOnRead = true
    expect(() => loadSettings()).not.toThrow()
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('parses a valid persisted file', () => {
    storeState.data = { ...DEFAULT_SETTINGS, theme: 'light' }
    expect(loadSettings().theme).toBe('light')
  })
})
