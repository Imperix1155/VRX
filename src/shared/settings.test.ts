import { describe, it, expect } from 'vitest'
import {
  SETTINGS_VERSION,
  DEFAULT_SETTINGS,
  parseSettings,
  runMigrations,
  shouldPersistSettings,
  type Settings,
  type SettingsMigration
} from './settings'

describe('settings schema', () => {
  it('DEFAULT_SETTINGS materializes every field with sane defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: SETTINGS_VERSION,
      theme: 'system',
      language: 'en',
      density: 'comfortable',
      firstRunDisclaimerAcknowledged: false,
      telemetryEnabled: false,
      labelScheme: 'vrchat',
      hotInstanceThreshold: 2,
      collapsedFriendSections: ['offline'],
      notifyFriendOnline: true,
      notifyFriendInGame: true,
      notifyFriendOffline: false,
      notifyHotInstance: true
    })
  })

  it('fills missing fields with defaults (safe merge)', () => {
    const s = parseSettings({ theme: 'dark' })
    expect(s.theme).toBe('dark')
    expect(s.language).toBe('en')
    expect(s.density).toBe('comfortable')
    expect(s.telemetryEnabled).toBe(false)
  })

  it('strips unknown keys instead of throwing', () => {
    const s = parseSettings({ theme: 'light', bogus: 123, nested: { x: 1 } }) as Settings &
      Record<string, unknown>
    expect(s.theme).toBe('light')
    expect('bogus' in s).toBe(false)
    expect('nested' in s).toBe(false)
  })

  it('falls back to defaults on invalid values (degrades, never throws)', () => {
    const s = parseSettings({ theme: 'neon', density: 'spacious', telemetryEnabled: 'yes' })
    expect(s.theme).toBe('system')
    expect(s.density).toBe('comfortable')
    expect(s.telemetryEnabled).toBe(false)
  })

  it('hotInstanceThreshold: accepts 1–10, defaults missing/out-of-range/non-integer to 2', () => {
    expect(parseSettings({ hotInstanceThreshold: 1 }).hotInstanceThreshold).toBe(1)
    expect(parseSettings({ hotInstanceThreshold: 10 }).hotInstanceThreshold).toBe(10)
    expect(parseSettings({ theme: 'dark' }).hotInstanceThreshold).toBe(2)
    expect(parseSettings({ hotInstanceThreshold: 0 }).hotInstanceThreshold).toBe(2)
    expect(parseSettings({ hotInstanceThreshold: 11 }).hotInstanceThreshold).toBe(2)
    expect(parseSettings({ hotInstanceThreshold: 3.5 }).hotInstanceThreshold).toBe(2)
    expect(parseSettings({ hotInstanceThreshold: '5' }).hotInstanceThreshold).toBe(2)
  })

  it('labelScheme: accepts every scheme, defaults pre-VRX-183 objects and garbage to vrchat', () => {
    expect(parseSettings({ labelScheme: 'chilloutvr' }).labelScheme).toBe('chilloutvr')
    expect(parseSettings({ labelScheme: 'platform-native' }).labelScheme).toBe('platform-native')
    expect(parseSettings({ theme: 'dark' }).labelScheme).toBe('vrchat')
    expect(parseSettings({ labelScheme: 'klingon' }).labelScheme).toBe('vrchat')
  })

  it('collapsedFriendSections: accepts valid sections, defaults missing/invalid to ["offline"]', () => {
    expect(parseSettings({ collapsedFriendSections: [] }).collapsedFriendSections).toEqual([])
    expect(
      parseSettings({ collapsedFriendSections: ['in-game', 'online'] }).collapsedFriendSections
    ).toEqual(['in-game', 'online'])
    expect(parseSettings({ theme: 'dark' }).collapsedFriendSections).toEqual(['offline'])
    expect(parseSettings({ collapsedFriendSections: ['bogus'] }).collapsedFriendSections).toEqual([
      'offline'
    ])
    expect(parseSettings({ collapsedFriendSections: 'offline' }).collapsedFriendSections).toEqual([
      'offline'
    ])
  })

  it('friend notifications: additive defaults are online/in-game on and offline off', () => {
    const legacy = parseSettings({ theme: 'dark' })
    expect(legacy.notifyFriendOnline).toBe(true)
    expect(legacy.notifyFriendInGame).toBe(true)
    expect(legacy.notifyFriendOffline).toBe(false)

    const customized = parseSettings({
      notifyFriendOnline: false,
      notifyFriendInGame: false,
      notifyFriendOffline: true
    })
    expect(customized.notifyFriendOnline).toBe(false)
    expect(customized.notifyFriendInGame).toBe(false)
    expect(customized.notifyFriendOffline).toBe(true)

    const invalid = parseSettings({
      notifyFriendOnline: 'yes',
      notifyFriendInGame: null,
      notifyFriendOffline: 1
    })
    expect(invalid.notifyFriendOnline).toBe(true)
    expect(invalid.notifyFriendInGame).toBe(true)
    expect(invalid.notifyFriendOffline).toBe(false)
  })

  it('hot-instance notifications: additive default is on and invalid values fall back on', () => {
    expect(parseSettings({ theme: 'dark' }).notifyHotInstance).toBe(true)
    expect(parseSettings({ notifyHotInstance: false }).notifyHotInstance).toBe(false)
    expect(parseSettings({ notifyHotInstance: 'no' }).notifyHotInstance).toBe(true)
  })

  it('coerces non-object input to defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(['a'])).toEqual(DEFAULT_SETTINGS)
  })
})

describe('migration runner', () => {
  it('loads a legacy versionless (v0.10-style) file without crashing, stamping the current version', () => {
    const legacy = { theme: 'dark', someRemovedSetting: true } // no version field
    const s = parseSettings(legacy)
    expect(s.version).toBe(SETTINGS_VERSION)
    expect(s.theme).toBe('dark')
    expect('someRemovedSetting' in (s as Record<string, unknown>)).toBe(false)
  })

  it('applies registered migrations in order on a version mismatch', () => {
    // A synthetic registry proves the runner mechanism independently of the
    // production v1 → v2 identity migration.
    const migrations: Record<number, SettingsMigration> = {
      0: (prev) => ({ ...prev, theme: 'dark', version: 1 }),
      1: (prev) => ({ ...prev, density: 'compact', version: 2 })
    }
    const out = runMigrations({ version: 0, theme: 'light' }, migrations, 2)
    expect(out.version).toBe(2)
    expect(out.theme).toBe('dark')
    expect(out.density).toBe('compact')
  })

  it('treats a pre-versioning (v0) file as a no-op step and stamps the current version', () => {
    const out = runMigrations({ version: 0 }, {}, SETTINGS_VERSION)
    expect(out.version).toBe(SETTINGS_VERSION)
  })

  it('throws on a missing migration BETWEEN released versions (never silently stamps)', () => {
    expect(() => runMigrations({ version: 1 }, {}, 2)).toThrow(/no migration/i)
  })

  it('migrates v1 → v2 without losing or changing any existing field', () => {
    const v1: Settings = {
      version: 1,
      theme: 'dark',
      language: 'ja',
      density: 'compact',
      firstRunDisclaimerAcknowledged: true,
      telemetryEnabled: true,
      labelScheme: 'chilloutvr',
      hotInstanceThreshold: 7,
      collapsedFriendSections: ['in-game', 'online'],
      notifyFriendOnline: false,
      notifyFriendInGame: false,
      notifyFriendOffline: true,
      notifyHotInstance: false
    }

    expect(parseSettings(v1)).toEqual({ ...v1, version: 2 })
  })

  it('preserves a newer-version file in memory without down-leveling (rollback-safe)', () => {
    const fromFuture = { version: 99, theme: 'light', futureSetting: 'x' }
    const s = parseSettings(fromFuture)
    expect(s.version).toBe(99) // NOT down-leveled to current
    expect(s.theme).toBe('light')
    expect('futureSetting' in (s as Record<string, unknown>)).toBe(false) // sanitized in-memory view
  })

  it('does not mutate the input object', () => {
    const input = { version: 0, theme: 'light' }
    const snapshot = { ...input }
    runMigrations(input, { 0: (p) => ({ ...p, version: 1 }) }, 1)
    expect(input).toEqual(snapshot)
  })
})

describe('shouldPersistSettings (rollback safety)', () => {
  it('allows persisting current and legacy/versionless files', () => {
    expect(shouldPersistSettings({ version: SETTINGS_VERSION })).toBe(true)
    expect(shouldPersistSettings({})).toBe(true)
    expect(shouldPersistSettings('garbage')).toBe(true)
  })

  it('refuses to persist a file written by a newer build', () => {
    expect(shouldPersistSettings({ version: SETTINGS_VERSION + 1 })).toBe(false)
    expect(shouldPersistSettings({ version: 99 })).toBe(false)
  })

  it('makes an older v1 build refuse a v2 file', () => {
    expect(shouldPersistSettings({ ...DEFAULT_SETTINGS, version: 2 }, 1)).toBe(false)
  })

  it('prevents the reviewer strip-and-rewrite downgrade round-trip from losing the choice', () => {
    let disk: Record<string, unknown> = {
      ...DEFAULT_SETTINGS,
      version: 2,
      notifyHotInstance: false
    }
    const oldV1Normalized = { ...disk, version: 1 }
    Reflect.deleteProperty(oldV1Normalized, 'notifyHotInstance')

    // This is the old build's load-and-tidy write. The v2 boundary must block
    // the write that would otherwise strip notifyHotInstance from disk.
    if (shouldPersistSettings(disk, 1)) disk = oldV1Normalized

    expect(disk.notifyHotInstance).toBe(false)
    expect(parseSettings(disk).notifyHotInstance).toBe(false)
  })
})
