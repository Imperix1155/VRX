import { describe, it, expect } from 'vitest'
import { RECONCILE_INTERVAL_MS } from './constants'
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
      notifyFriendOnline: false,
      notifyFriendInGame: false,
      notifyFriendOffline: false,
      notifyHotInstance: false,
      backgroundGlow: 'standard',
      reconcileInterval: '5m',
      drawerOpener: 'card',
      confirmJoin: true,
      joinMode: 'ask',
      autoUpdate: false
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

  it('backgroundGlow: accepts every level, defaults missing/invalid to standard', () => {
    expect(parseSettings({ backgroundGlow: 'muted' }).backgroundGlow).toBe('muted')
    expect(parseSettings({ backgroundGlow: 'standard' }).backgroundGlow).toBe('standard')
    expect(parseSettings({ backgroundGlow: 'vivid' }).backgroundGlow).toBe('vivid')
    expect(parseSettings({ theme: 'dark' }).backgroundGlow).toBe('standard')
    expect(parseSettings({ backgroundGlow: 'neon' }).backgroundGlow).toBe('standard')
    expect(parseSettings({ backgroundGlow: 1 }).backgroundGlow).toBe('standard')
  })

  it('reconcileInterval: accepts every cadence, defaults missing/invalid to 5m', () => {
    expect(parseSettings({ reconcileInterval: '5m' }).reconcileInterval).toBe('5m')
    expect(parseSettings({ reconcileInterval: '10m' }).reconcileInterval).toBe('10m')
    expect(parseSettings({ reconcileInterval: '30m' }).reconcileInterval).toBe('30m')
    expect(parseSettings({ reconcileInterval: 'manual' }).reconcileInterval).toBe('manual')
    expect(parseSettings({ theme: 'dark' }).reconcileInterval).toBe('5m')
    expect(parseSettings({ reconcileInterval: '1m' }).reconcileInterval).toBe('5m')
    expect(parseSettings({ reconcileInterval: 5 }).reconcileInterval).toBe('5m')
  })

  it('drawerOpener: accepts both surfaces, defaults missing/invalid to card (VRX-228)', () => {
    expect(parseSettings({ drawerOpener: 'card' }).drawerOpener).toBe('card')
    expect(parseSettings({ drawerOpener: 'avatar' }).drawerOpener).toBe('avatar')
    expect(parseSettings({ theme: 'dark' }).drawerOpener).toBe('card')
    expect(parseSettings({ drawerOpener: 'whole-row' }).drawerOpener).toBe('card')
    expect(parseSettings({ drawerOpener: 1 }).drawerOpener).toBe('card')
  })

  it('confirmJoin: defaults missing/invalid to true', () => {
    expect(parseSettings({ confirmJoin: true }).confirmJoin).toBe(true)
    expect(parseSettings({ confirmJoin: false }).confirmJoin).toBe(false)
    expect(parseSettings({ theme: 'dark' }).confirmJoin).toBe(true)
    expect(parseSettings({ confirmJoin: 'yes' }).confirmJoin).toBe(true)
  })

  it('joinMode: accepts every mode and degrades missing/invalid disk values to ask', () => {
    expect(parseSettings({ joinMode: 'ask' }).joinMode).toBe('ask')
    expect(parseSettings({ joinMode: 'vr' }).joinMode).toBe('vr')
    expect(parseSettings({ joinMode: 'desktop' }).joinMode).toBe('desktop')
    expect(parseSettings({ theme: 'dark' }).joinMode).toBe('ask')
    expect(parseSettings({ version: 6, joinMode: 'roomscale' }).joinMode).toBe('ask')
    expect(parseSettings({ joinMode: 1 }).joinMode).toBe('ask')
  })

  it('autoUpdate: defaults missing/invalid to false (VRX-113)', () => {
    expect(parseSettings({ autoUpdate: true }).autoUpdate).toBe(true)
    expect(parseSettings({ autoUpdate: false }).autoUpdate).toBe(false)
    expect(parseSettings({ theme: 'dark' }).autoUpdate).toBe(false)
    expect(parseSettings({ autoUpdate: 'yes' }).autoUpdate).toBe(false)
  })

  it('maps every reconcile cadence to its background interval', () => {
    expect(RECONCILE_INTERVAL_MS).toEqual({
      '5m': 300_000,
      '10m': 600_000,
      '30m': 1_800_000,
      manual: false
    })
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

  it('friend notifications: quiet defaults — every alert type ships OFF (VRX-205)', () => {
    const legacy = parseSettings({ theme: 'dark' })
    expect(legacy.notifyFriendOnline).toBe(false)
    expect(legacy.notifyFriendInGame).toBe(false)
    expect(legacy.notifyFriendOffline).toBe(false)

    // Persisted explicit values always win — existing users keep their choices.
    const customized = parseSettings({
      notifyFriendOnline: true,
      notifyFriendInGame: true,
      notifyFriendOffline: true
    })
    expect(customized.notifyFriendOnline).toBe(true)
    expect(customized.notifyFriendInGame).toBe(true)
    expect(customized.notifyFriendOffline).toBe(true)

    const invalid = parseSettings({
      notifyFriendOnline: 'yes',
      notifyFriendInGame: null,
      notifyFriendOffline: 1
    })
    expect(invalid.notifyFriendOnline).toBe(false)
    expect(invalid.notifyFriendInGame).toBe(false)
    expect(invalid.notifyFriendOffline).toBe(false)
  })

  it('hot-instance notifications: quiet default — ships OFF, invalid falls back off (VRX-205)', () => {
    expect(parseSettings({ theme: 'dark' }).notifyHotInstance).toBe(false)
    expect(parseSettings({ notifyHotInstance: true }).notifyHotInstance).toBe(true)
    expect(parseSettings({ notifyHotInstance: 'no' }).notifyHotInstance).toBe(false)
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
    // production identity migrations.
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

  it('migrates a v1 file to current without losing or changing any existing field', () => {
    const v1 = {
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

    expect(parseSettings(v1)).toEqual({
      ...v1,
      version: 7,
      backgroundGlow: 'standard',
      reconcileInterval: '5m',
      drawerOpener: 'card',
      confirmJoin: true,
      joinMode: 'ask',
      autoUpdate: false
    })
  })

  it('migrates v2 → v3 without losing or changing any existing field', () => {
    const v2 = {
      version: 2,
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

    expect(parseSettings(v2)).toEqual({
      ...v2,
      version: 7,
      backgroundGlow: 'standard',
      reconcileInterval: '5m',
      drawerOpener: 'card',
      confirmJoin: true,
      joinMode: 'ask',
      autoUpdate: false
    })
  })

  it('migrates v3 → v4 without losing or changing any existing field', () => {
    const v3 = {
      version: 3,
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
      notifyHotInstance: false,
      backgroundGlow: 'vivid'
    }

    expect(parseSettings(v3)).toEqual({
      ...v3,
      version: 7,
      reconcileInterval: '5m',
      drawerOpener: 'card',
      confirmJoin: true,
      joinMode: 'ask',
      autoUpdate: false
    })
  })

  it('migrates v4 → v5 without losing or changing any existing field', () => {
    const v4 = {
      version: 4,
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
      notifyHotInstance: false,
      backgroundGlow: 'vivid',
      reconcileInterval: 'manual'
    }

    expect(parseSettings(v4)).toEqual({
      ...v4,
      version: 7,
      drawerOpener: 'card',
      confirmJoin: true,
      joinMode: 'ask',
      autoUpdate: false
    })
  })

  it('migrates v5 → v6 without losing or changing any existing field', () => {
    const v5 = {
      version: 5,
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
      notifyHotInstance: false,
      backgroundGlow: 'vivid',
      reconcileInterval: 'manual',
      drawerOpener: 'avatar'
    }

    expect(parseSettings(v5)).toEqual({
      ...v5,
      version: 7,
      confirmJoin: true,
      joinMode: 'ask',
      autoUpdate: false
    })
  })

  it('migrates v6 → v7 without losing or changing any existing field (VRX-113)', () => {
    const v6 = {
      version: 6,
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
      notifyHotInstance: false,
      backgroundGlow: 'vivid',
      reconcileInterval: 'manual',
      drawerOpener: 'avatar',
      confirmJoin: false,
      joinMode: 'vr'
    }

    expect(parseSettings(v6)).toEqual({
      ...v6,
      version: 7,
      autoUpdate: false
    })
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

  it('makes an older v2 build refuse a v3 file', () => {
    expect(shouldPersistSettings({ ...DEFAULT_SETTINGS, version: 3 }, 2)).toBe(false)
  })

  it('makes an older v3 build refuse a v4 file', () => {
    expect(shouldPersistSettings({ ...DEFAULT_SETTINGS, version: 4 }, 3)).toBe(false)
  })

  it('makes an older v4 build refuse a v5 file', () => {
    expect(shouldPersistSettings({ ...DEFAULT_SETTINGS, version: 5 }, 4)).toBe(false)
  })

  it('makes an older v5 build refuse a v6 file', () => {
    expect(shouldPersistSettings({ ...DEFAULT_SETTINGS, version: 6 }, 5)).toBe(false)
  })

  it('makes an older v6 build refuse a v7 file', () => {
    expect(shouldPersistSettings({ ...DEFAULT_SETTINGS, version: 7 }, 6)).toBe(false)
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

  it('prevents a v2 build from stripping backgroundGlow during a downgrade round-trip', () => {
    let disk: Record<string, unknown> = {
      ...DEFAULT_SETTINGS,
      version: 3,
      backgroundGlow: 'vivid'
    }
    const oldV2Normalized = { ...disk, version: 2 }
    Reflect.deleteProperty(oldV2Normalized, 'backgroundGlow')

    // This is the v2 build's load-and-tidy write. The v3 boundary must block
    // the write that would otherwise strip backgroundGlow from disk.
    if (shouldPersistSettings(disk, 2)) disk = oldV2Normalized

    expect(disk.backgroundGlow).toBe('vivid')
    expect(parseSettings(disk).backgroundGlow).toBe('vivid')
  })

  it('prevents a v3 build from stripping reconcileInterval during a downgrade round-trip', () => {
    let disk: Record<string, unknown> = {
      ...DEFAULT_SETTINGS,
      version: 4,
      reconcileInterval: 'manual'
    }
    const oldV3Normalized = { ...disk, version: 3 }
    Reflect.deleteProperty(oldV3Normalized, 'reconcileInterval')

    // This is the v3 build's load-and-tidy write. The v4 boundary must block
    // the write that would otherwise strip reconcileInterval from disk.
    if (shouldPersistSettings(disk, 3)) disk = oldV3Normalized

    expect(disk.reconcileInterval).toBe('manual')
    expect(parseSettings(disk).reconcileInterval).toBe('manual')
  })

  it('prevents a v4 build from stripping drawerOpener during a downgrade round-trip', () => {
    let disk: Record<string, unknown> = {
      ...DEFAULT_SETTINGS,
      version: 5,
      drawerOpener: 'avatar'
    }
    const oldV4Normalized = { ...disk, version: 4 }
    Reflect.deleteProperty(oldV4Normalized, 'drawerOpener')

    // This is the v4 build's load-and-tidy write. The v5 boundary must block
    // the write that would otherwise strip drawerOpener from disk.
    if (shouldPersistSettings(disk, 4)) disk = oldV4Normalized

    expect(disk.drawerOpener).toBe('avatar')
    expect(parseSettings(disk).drawerOpener).toBe('avatar')
  })

  it('prevents a v5 build from stripping join settings during a downgrade round-trip', () => {
    let disk: Record<string, unknown> = {
      ...DEFAULT_SETTINGS,
      version: 6,
      confirmJoin: false,
      joinMode: 'vr'
    }
    const oldV5Normalized = { ...disk, version: 5 }
    Reflect.deleteProperty(oldV5Normalized, 'confirmJoin')
    Reflect.deleteProperty(oldV5Normalized, 'joinMode')

    // This is the v5 build's load-and-tidy write. The v6 boundary must block
    // the write that would otherwise strip both join settings from disk.
    if (shouldPersistSettings(disk, 5)) disk = oldV5Normalized

    expect(disk.confirmJoin).toBe(false)
    expect(disk.joinMode).toBe('vr')
    expect(parseSettings(disk).confirmJoin).toBe(false)
    expect(parseSettings(disk).joinMode).toBe('vr')
  })

  it('prevents a v6 build from stripping autoUpdate during a downgrade round-trip (VRX-113)', () => {
    let disk: Record<string, unknown> = {
      ...DEFAULT_SETTINGS,
      version: 7,
      autoUpdate: true
    }
    const oldV6Normalized = { ...disk, version: 6 }
    Reflect.deleteProperty(oldV6Normalized, 'autoUpdate')

    // This is the v6 build's load-and-tidy write. The v7 boundary must block
    // the write that would otherwise strip autoUpdate from disk.
    if (shouldPersistSettings(disk, 6)) disk = oldV6Normalized

    expect(disk.autoUpdate).toBe(true)
    expect(parseSettings(disk).autoUpdate).toBe(true)
  })
})
