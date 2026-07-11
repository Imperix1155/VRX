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
import { FriendAlerts } from './friendAlerts'

const storeState = vi.hoisted(
  (): {
    throwOnRead: boolean
    throwOnWrite: boolean
    reads: number
    data: Record<string, unknown>
    written: Record<string, unknown>[]
  } => ({
    throwOnRead: false,
    throwOnWrite: false,
    reads: 0,
    data: {},
    written: []
  })
)

vi.mock('electron-store', () => ({
  default: class {
    get store(): Record<string, unknown> {
      storeState.reads += 1
      if (storeState.throwOnRead) throw new SyntaxError('Unexpected token in JSON at position 0')
      return storeState.data
    }
    set store(value: Record<string, unknown>) {
      if (storeState.throwOnWrite) throw new Error('disk full')
      storeState.written.push(value)
    }
  }
}))

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { getSettingsSnapshot, loadSettings, saveSettings } from './settings'

beforeEach(() => {
  storeState.throwOnRead = false
  storeState.throwOnWrite = false
  storeState.reads = 0
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

  it('serves alert decisions from the in-memory snapshot without a store read per event', () => {
    storeState.data = { ...DEFAULT_SETTINGS, notifyFriendOnline: true }
    loadSettings()
    const readsAfterStartup = storeState.reads
    const engine = new FriendAlerts({
      notify: vi.fn(),
      clock: () => 0,
      isEnabled: () => getSettingsSnapshot().notifyFriendOnline,
      resolveName: () => 'Friend Name'
    })
    const baseFriend = {
      platformUserId: 'usr_friend',
      platform: 'vrchat' as const,
      displayName: 'Friend Name',
      avatarUrl: null,
      instance: null,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null,
      status: 'online' as const,
      statusDescription: null,
      trustRank: null
    }

    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: { ...baseFriend, presence: { state: 'offline' } }
    })
    engine.consume({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: { ...baseFriend, presence: { state: 'active' } }
    })

    expect(storeState.reads).toBe(readsAfterStartup)
  })

  it('updates the in-memory snapshot synchronously when settings are saved', () => {
    storeState.data = { ...DEFAULT_SETTINGS, notifyFriendOffline: false }
    loadSettings()

    saveSettings({ notifyFriendOffline: true })

    expect(getSettingsSnapshot().notifyFriendOffline).toBe(true)
  })

  it('keeps the validated in-memory snapshot when persistence fails, while rethrowing', () => {
    storeState.data = { ...DEFAULT_SETTINGS, notifyFriendOnline: false }
    loadSettings()
    storeState.throwOnWrite = true

    expect(() => saveSettings({ notifyFriendOnline: true })).toThrow('disk full')
    expect(getSettingsSnapshot().notifyFriendOnline).toBe(true)
  })

  it('keeps native policy aligned with the UI when a newer-version file refuses persistence', () => {
    storeState.data = {
      ...DEFAULT_SETTINGS,
      version: 9999,
      notifyFriendInGame: false,
      futureField: 'keep-me'
    }
    loadSettings()

    expect(() => saveSettings({ notifyFriendInGame: true })).toThrow(
      'refusing to overwrite settings written by a newer version'
    )
    expect(getSettingsSnapshot().notifyFriendInGame).toBe(true)
    expect(getSettingsSnapshot().version).toBe(9999)
    expect(storeState.written).toHaveLength(0)
  })
})
