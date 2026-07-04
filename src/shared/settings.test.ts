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
      labelScheme: 'vrchat'
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

  it('labelScheme: accepts every scheme, defaults pre-VRX-183 objects and garbage to vrchat', () => {
    expect(parseSettings({ labelScheme: 'chilloutvr' }).labelScheme).toBe('chilloutvr')
    expect(parseSettings({ labelScheme: 'platform-native' }).labelScheme).toBe('platform-native')
    expect(parseSettings({ theme: 'dark' }).labelScheme).toBe('vrchat')
    expect(parseSettings({ labelScheme: 'klingon' }).labelScheme).toBe('vrchat')
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
    // A synthetic registry proves the runner mechanism; the production registry
    // is empty by design (no released prior schema yet).
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
})
