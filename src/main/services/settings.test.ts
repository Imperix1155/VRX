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

const storeState = vi.hoisted(
  (): {
    throwOnRead: boolean
    data: Record<string, unknown>
    written: Record<string, unknown>[]
  } => ({
    throwOnRead: false,
    data: {},
    written: []
  })
)

vi.mock('electron-store', () => ({
  default: class {
    get store(): Record<string, unknown> {
      if (storeState.throwOnRead) throw new SyntaxError('Unexpected token in JSON at position 0')
      return storeState.data
    }
    set store(value: Record<string, unknown>) {
      storeState.written.push(value)
    }
  }
}))

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { loadSettings } from './settings'

beforeEach(() => {
  storeState.throwOnRead = false
  storeState.data = {}
  storeState.written = []
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

  it('persists the normalized form back for a legacy (version-less) file', () => {
    // Raw legacy shape: no version field → readVersion 0 ≤ SETTINGS_VERSION →
    // loadSettings writes the migrated+validated form back to disk.
    storeState.data = { theme: 'light' }

    const settings = loadSettings()

    expect(settings.theme).toBe('light')
    expect(storeState.written).toHaveLength(1)
    expect(storeState.written[0]).toEqual(settings)
  })

  it('does NOT overwrite a file written by a newer build (forward fields preserved)', () => {
    storeState.data = { ...DEFAULT_SETTINGS, version: 9999, futureField: 'keep-me' }

    const settings = loadSettings()

    // Persisting would strip futureField and lose data on a rollback.
    expect(storeState.written).toHaveLength(0)
    // And the in-memory view keeps the file's original version (not down-leveled)
    // — the other half of parseSettings's newer-build contract.
    expect(settings.version).toBe(9999)
  })
})
