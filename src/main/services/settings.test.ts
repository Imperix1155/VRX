/**
 * loadSettings "never throws" contract (2026-07 audit W7 review, finding M1).
 *
 * conf's `store` getter RETHROWS on a corrupted settings.json (only ENOENT is
 * swallowed). With the throw escaping loadSettings, the W7 bootstrap .catch
 * would exit-loop the app on every launch until the user hand-deleted the file.
 * Pins: a throwing store read falls back to in-memory defaults.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { FriendAlerts } from './friendAlerts'

const storeState = vi.hoisted(
  (): {
    throwOnRead: boolean
    readError: Error | null
    throwOnWrite: boolean
    reads: number
    data: Record<string, unknown>
    written: Record<string, unknown>[]
  } => ({
    throwOnRead: false,
    readError: null,
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
      if (storeState.throwOnRead) {
        throw storeState.readError ?? new SyntaxError('Unexpected token in JSON at position 0')
      }
      return storeState.data
    }
    set store(value: Record<string, unknown>) {
      if (storeState.throwOnWrite) throw new Error('disk full')
      storeState.written.push(value)
    }
  }
}))

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => userData.dir } }))

import {
  flushPendingSettingsSave,
  getSettingsSnapshot,
  hasPendingSettingsSave,
  loadSettings,
  saveSettings
} from './settings'

beforeEach(() => {
  storeState.throwOnRead = false
  storeState.readError = null
  storeState.throwOnWrite = false
  storeState.data = {}
  flushPendingSettingsSave()
  storeState.reads = 0
  storeState.data = {}
  storeState.written = []
})

afterEach(() => vi.useRealTimers())

describe('loadSettings (W7 M1)', () => {
  it('falls back to defaults instead of throwing when the store read throws (corrupted file)', () => {
    storeState.throwOnRead = true
    expect(() => loadSettings()).not.toThrow()
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('moves a corrupt settings file aside so later saves can succeed', async () => {
    userData.dir = mkdtempSync(join(tmpdir(), 'vrx-settings-'))
    try {
      writeFileSync(join(userData.dir, 'settings.json'), '{"theme": "light",')
      storeState.throwOnRead = true

      expect(loadSettings()).toEqual(DEFAULT_SETTINGS)

      const files = readdirSync(userData.dir)
      expect(files).not.toContain('settings.json')
      const kept = files.find((name) => /^settings\.corrupt-\d+\.json$/.test(name))
      expect(kept).toBeDefined()
      expect(readFileSync(join(userData.dir, kept!), 'utf8')).toBe('{"theme": "light",')

      // The fresh store reads no file (conf returns an empty object for ENOENT),
      // but this is not a new install, so the welcome setup stays off.
      storeState.throwOnRead = false
      expect(loadSettings().setupPending).toBe(false)
      const saved = saveSettings({ theme: 'light' })
      flushPendingSettingsSave()
      await expect(saved).resolves.toMatchObject({ theme: 'light' })
    } finally {
      rmSync(userData.dir, { recursive: true, force: true })
      userData.dir = ''
    }
  })

  it('leaves the settings file in place when the read fails for another reason', () => {
    userData.dir = mkdtempSync(join(tmpdir(), 'vrx-settings-'))
    try {
      writeFileSync(join(userData.dir, 'settings.json'), '{}')
      storeState.throwOnRead = true
      storeState.readError = new Error('EACCES: permission denied')

      expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
      expect(readdirSync(userData.dir)).toEqual(['settings.json'])
    } finally {
      rmSync(userData.dir, { recursive: true, force: true })
      userData.dir = ''
    }
  })

  it('parses a valid persisted file', () => {
    storeState.data = { ...DEFAULT_SETTINGS, theme: 'light' }
    expect(loadSettings().theme).toBe('light')
  })

  it.each([
    ['current', { ...DEFAULT_SETTINGS, theme: 'light', allowJoinInstances: false }],
    ['legacy', { theme: 'light', allowJoinInstances: false }]
  ])(
    'preserves %s settings when normalization cannot be written, with an explicit flush retry',
    (_label, raw) => {
      vi.useFakeTimers()
      storeState.data = raw
      storeState.throwOnWrite = true

      const loaded = loadSettings()

      expect(loaded).toMatchObject({ theme: 'light', allowJoinInstances: false })
      expect(getSettingsSnapshot()).toEqual(loaded)
      expect(hasPendingSettingsSave()).toBe(true)
      expect(storeState.written).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
      const readsAfterLoad = storeState.reads
      expect(loadSettings()).toEqual(loaded)
      expect(storeState.reads).toBe(readsAfterLoad)

      storeState.throwOnWrite = false
      flushPendingSettingsSave()

      expect(storeState.written).toEqual([loaded])
      expect(hasPendingSettingsSave()).toBe(false)
    }
  )

  it('preserves loaded preferences when a later unrelated edit retries failed normalization', async () => {
    storeState.data = { ...DEFAULT_SETTINGS, theme: 'light', allowJoinInstances: false }
    storeState.throwOnWrite = true
    loadSettings()
    storeState.throwOnWrite = false

    const pending = saveSettings({ density: 'compact' })
    flushPendingSettingsSave()

    await expect(pending).resolves.toMatchObject({
      theme: 'light',
      allowJoinInstances: false,
      density: 'compact'
    })
    expect(storeState.written).toEqual([
      expect.objectContaining({ theme: 'light', allowJoinInstances: false, density: 'compact' })
    ])
    expect(hasPendingSettingsSave()).toBe(false)
  })

  it('does not let a failed normalization retry overwrite a newer-version file', () => {
    storeState.data = { ...DEFAULT_SETTINGS, theme: 'light' }
    storeState.throwOnWrite = true
    loadSettings()
    storeState.throwOnWrite = false
    storeState.data = { ...DEFAULT_SETTINGS, version: 9999, futureField: 'keep-me' }

    flushPendingSettingsSave()

    expect(storeState.written).toEqual([])
    expect(hasPendingSettingsSave()).toBe(true)
    expect(getSettingsSnapshot().theme).toBe('light')
  })

  it('queues the welcome setup only when no settings file exists yet', () => {
    // An empty store is electron-store's view of a missing settings.json.
    const fresh = loadSettings()

    expect(fresh).toEqual({ ...DEFAULT_SETTINGS, setupPending: true })
    expect(storeState.written).toEqual([fresh])

    // The next launch reads that written file and keeps the queued setup until
    // the wizard clears it; an existing default-only file never starts it.
    storeState.data = { ...DEFAULT_SETTINGS }
    expect(loadSettings().setupPending).toBe(false)
    storeState.data = { theme: 'light' }
    expect(loadSettings().setupPending).toBe(false)
  })

  it('does not queue setup when the settings file cannot be read', () => {
    storeState.throwOnRead = true
    expect(loadSettings().setupPending).toBe(false)
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

  it('updates the in-memory snapshot synchronously when settings are saved', async () => {
    vi.useFakeTimers()
    storeState.data = { ...DEFAULT_SETTINGS, notifyFriendOffline: false }
    loadSettings()

    const pending = saveSettings({ notifyFriendOffline: true })

    expect(getSettingsSnapshot().notifyFriendOffline).toBe(true)
    flushPendingSettingsSave()
    await pending
    vi.useRealTimers()
  })

  it('keeps the validated in-memory snapshot when persistence fails, while rejecting', async () => {
    vi.useFakeTimers()
    storeState.data = { ...DEFAULT_SETTINGS, notifyFriendOnline: false }
    loadSettings()
    storeState.throwOnWrite = true

    const pending = saveSettings({ notifyFriendOnline: true })
    expect(getSettingsSnapshot().notifyFriendOnline).toBe(true)
    const rejection = expect(pending).rejects.toThrow('disk full')
    flushPendingSettingsSave()
    await rejection
    vi.useRealTimers()
  })

  it('applies the patch in memory even when the settings file cannot be read', () => {
    storeState.data = { ...DEFAULT_SETTINGS, notifyFriendOnline: true }
    loadSettings()
    storeState.written = []
    storeState.throwOnRead = true

    expect(() => saveSettings({ notifyFriendOnline: false })).toThrow('Unexpected token')
    // Native policy (e.g. notifications) must follow the UI, not the unreadable file.
    expect(getSettingsSnapshot().notifyFriendOnline).toBe(false)
    expect(storeState.written).toHaveLength(0)
    expect(hasPendingSettingsSave()).toBe(false)
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

  it('coalesces rapid snapshots into one delayed disk write owned by main', async () => {
    vi.useFakeTimers()
    storeState.data = { ...DEFAULT_SETTINGS }
    loadSettings()
    storeState.written = []

    const first = saveSettings({ theme: 'light' })
    const second = saveSettings({ density: 'compact' })

    expect(storeState.written).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(249)
    expect(storeState.written).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)

    await expect(first).resolves.toMatchObject({ theme: 'light', density: 'compact' })
    await expect(second).resolves.toMatchObject({ theme: 'light', density: 'compact' })
    expect(storeState.written).toEqual([
      expect.objectContaining({ theme: 'light', density: 'compact' })
    ])
    vi.useRealTimers()
  })

  it('serves a pending save during reload and keeps snapshot aligned after flush', async () => {
    vi.useFakeTimers()
    storeState.data = { ...DEFAULT_SETTINGS, notifyFriendOnline: false }
    loadSettings()
    storeState.written = []

    const pending = saveSettings({ notifyFriendOnline: true })
    const readsAfterSave = storeState.reads

    expect(loadSettings().notifyFriendOnline).toBe(true)
    expect(storeState.reads).toBe(readsAfterSave)
    expect(storeState.written).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(250)
    await expect(pending).resolves.toMatchObject({ notifyFriendOnline: true })
    expect(getSettingsSnapshot()).toEqual(storeState.written[0])
    expect(storeState.written[0]).toMatchObject({ notifyFriendOnline: true })
    vi.useRealTimers()
  })

  it('flushes the pending settings write synchronously for the before-quit path', async () => {
    vi.useFakeTimers()
    storeState.data = { ...DEFAULT_SETTINGS }
    loadSettings()
    storeState.written = []
    const pending = saveSettings({ theme: 'light' })
    flushPendingSettingsSave()

    await expect(pending).resolves.toMatchObject({ theme: 'light' })
    expect(storeState.written).toEqual([expect.objectContaining({ theme: 'light' })])
    await vi.advanceTimersByTimeAsync(250)
    expect(storeState.written).toHaveLength(1)
    vi.useRealTimers()
  })

  it('does not let a delayed write overwrite a newer-version file', async () => {
    vi.useFakeTimers()
    storeState.data = { ...DEFAULT_SETTINGS }
    loadSettings()
    storeState.written = []
    const pending = saveSettings({ theme: 'light' })
    const rejection = expect(pending).rejects.toThrow(
      'refusing to overwrite settings written by a newer version'
    )

    storeState.data = { ...DEFAULT_SETTINGS, version: 9999, futureField: 'keep-me' }
    flushPendingSettingsSave()

    await rejection
    expect(storeState.written).toHaveLength(0)
    vi.useRealTimers()
  })
})

it('retains a failed snapshot for explicit flush retry', async () => {
  loadSettings()
  storeState.throwOnWrite = true
  const failed = saveSettings({ theme: 'light' })
  const rejection = expect(failed).rejects.toThrow('disk full')
  flushPendingSettingsSave()
  await rejection
  expect(loadSettings().theme).toBe('light')
  storeState.throwOnWrite = false
  storeState.written = []
  flushPendingSettingsSave()
  expect(storeState.written).toEqual([expect.objectContaining({ theme: 'light' })])
})

it('replaces a failed pending snapshot with the latest edit before retrying disk', async () => {
  loadSettings()
  storeState.throwOnWrite = true
  const first = saveSettings({ theme: 'light' })
  const rejection = expect(first).rejects.toThrow('disk full')
  flushPendingSettingsSave()
  await rejection
  const latest = saveSettings({ theme: 'dark', density: 'compact' })
  storeState.throwOnWrite = false
  storeState.written = []
  flushPendingSettingsSave()
  await expect(latest).resolves.toMatchObject({ theme: 'dark', density: 'compact' })
  expect(storeState.written).toEqual([
    expect.objectContaining({ theme: 'dark', density: 'compact' })
  ])
})
