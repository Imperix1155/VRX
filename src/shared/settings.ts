/**
 * VRX settings schema + migration runner (VRX-23)
 *
 * Single source of truth for persisted user settings: a Zod schema with
 * per-field resilient fallbacks (`.catch` covers BOTH a missing key and an
 * invalid value — degrade to the default, never throw), a versioned migration
 * runner, and `parseSettings` — the safe load path that migrates, strips
 * unknown keys, and fills missing ones with defaults.
 *
 * ⚠️ Bundled into the RENDERER (sandboxed). Keep PURE: no `electron`/`node`
 * imports. Persistence (electron-store) lives in the main process —
 * see `src/main/services/settings.ts`.
 *
 * Catalog scope (intentionally minimal, designed to grow): each field is sourced
 * from an existing decision, not invented —
 *   theme, density        → docs/DESIGN.md (dark default + light parity; density modes)
 *   language              → i18next (src/renderer/src/i18n)
 *   firstRunDisclaimerAcknowledged → M2 architecture decision #5 (unofficial-API disclaimer)
 *   telemetryEnabled      → privacy-first default OFF (cf. VRX-96 opt-in telemetry)
 *   labelScheme           → DESIGN.md §6 label rule (VRX-183; VRChat-scheme default per VRX-182)
 *   hotInstanceThreshold  → §9 dashboard hot grid (VRX-78; default from HOT_INSTANCE_THRESHOLD)
 *   collapsedFriendSections → friends-list presence-section grouping (VRX-67; Offline collapsed by default)
 *   notifyFriend*          → native friend transition alerts (VRX-84; ALL opt-in, VRX-205)
 *   notifyHotInstance      → hot-instance threshold crossings (VRX-85; opt-in, VRX-205)
 */
import { z } from 'zod'
import {
  HOT_INSTANCE_THRESHOLD,
  HOT_INSTANCE_THRESHOLD_MAX,
  HOT_INSTANCE_THRESHOLD_MIN
} from './constants'
import { BACKGROUND_GLOWS, FRIEND_SECTIONS, LABEL_SCHEMES, THEMES } from './types'

/** Additive-at-the-same-version fields can be silently stripped and rewritten by
 *  an older build during a downgrade round-trip. Versioning the addition makes
 *  that older build refuse persistence via shouldPersistSettings, preserving the
 *  user's newer choice even though the migration itself is identity-only. */
export const SETTINGS_VERSION = 3 as const

export const SettingsSchema = z.object({
  /** Schema version of the persisted object; drives {@link runMigrations}. */
  version: z.number().int().nonnegative().catch(SETTINGS_VERSION),
  /** UI theme; `system` follows the OS. Values sourced from `@shared/types` THEMES. */
  theme: z.enum(THEMES).catch('system'),
  /** UI language as an i18next code (e.g. `en`). Unknown locales fall back in the i18n layer. */
  language: z.string().min(2).max(35).catch('en'),
  /** Layout density. */
  density: z.enum(['comfortable', 'compact']).catch('comfortable'),
  /** Whether the user acknowledged the unofficial-API first-run disclaimer. */
  firstRunDisclaimerAcknowledged: z.boolean().catch(false),
  /** Opt-in crash/usage telemetry; OFF by default. */
  telemetryEnabled: z.boolean().catch(false),
  /** Instance-pill naming scheme (DESIGN.md §6 label rule). Values from `@shared/types` LABEL_SCHEMES. */
  labelScheme: z.enum(LABEL_SCHEMES).catch('vrchat'),
  /** Min friends in one world for the dashboard hot grid (VRX-78). Out-of-range/invalid → the default. */
  hotInstanceThreshold: z
    .number()
    .int()
    .min(HOT_INSTANCE_THRESHOLD_MIN)
    .max(HOT_INSTANCE_THRESHOLD_MAX)
    .catch(HOT_INSTANCE_THRESHOLD),
  /** Friends-list presence sections the user collapsed (VRX-67). Offline is collapsed by default. */
  collapsedFriendSections: z.array(z.enum(FRIEND_SECTIONS)).catch(['offline']),
  /** Native friend-transition alert toggles (VRX-84). */
  // VRX-205 (owner, 2026-07-11): QUIET DEFAULTS — every alert ships OFF; the
  // user opts in (and VRX-203's follow-a-friend becomes the natural opt-in
  // path). Default-value change only: no shape change, no SETTINGS_VERSION
  // bump; persisted files keep their explicit values.
  notifyFriendOnline: z.boolean().catch(false),
  notifyFriendInGame: z.boolean().catch(false),
  notifyFriendOffline: z.boolean().catch(false),
  /** Native hot-instance crossing alert (VRX-85). Ships OFF like every alert (VRX-205). */
  notifyHotInstance: z.boolean().catch(false),
  /** Background aurora intensity (owner-ratified 2026-07-17). `standard` is the new default. */
  backgroundGlow: z.enum(BACKGROUND_GLOWS).catch('standard')
})

export type Settings = z.infer<typeof SettingsSchema>

/** Canonical defaults — every field's fallback, materialized from an empty object. */
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

/** A migration transforms the persisted shape from version N to N+1. */
export type SettingsMigration = (prev: Record<string, unknown>) => Record<string, unknown>

/**
 * version N → function producing the version N+1 shape.
 *
 * v1 → v2 and v2 → v3 are deliberately identity-only: the shape remains
 * schema-compatible, while the version boundary protects newer fields from
 * older-build key stripping during rollback.
 */
export const SETTINGS_MIGRATIONS: Readonly<Record<number, SettingsMigration>> = {
  1: (prev) => ({ ...prev }),
  2: (prev) => ({ ...prev })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readVersion(raw: Record<string, unknown>): number {
  const v = raw.version
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0
}

/**
 * Apply registered migrations in order from the raw object's version up to
 * `targetVersion`. `migrations` is injectable for tests.
 *
 * - A file at/above `targetVersion` (written by a newer build) is returned
 *   AS-IS — never down-leveled here — so a rollback stays non-destructive.
 * - version 0 (a pre-versioning file) needs no migration: the schema's defaults
 *   reconcile additive fields; the version is stamped to the target.
 * - A missing migration BETWEEN released versions means one was forgotten —
 *   throw rather than silently stamp old-shaped data as current.
 */
export function runMigrations(
  raw: Record<string, unknown>,
  migrations: Readonly<Record<number, SettingsMigration>> = SETTINGS_MIGRATIONS,
  targetVersion: number = SETTINGS_VERSION
): Record<string, unknown> {
  const fromVersion = readVersion(raw)
  if (fromVersion >= targetVersion) return { ...raw }

  let data: Record<string, unknown> = { ...raw }
  let version = fromVersion
  while (version < targetVersion) {
    const migrate = migrations[version]
    if (!migrate) {
      if (version > 0) {
        throw new Error(`settings: no migration registered for v${version} -> v${version + 1}`)
      }
      // version 0 = a pre-versioning file: adopt via the schema's defaults and stamp
      // the target. NOTE (first real-migration author): this stamps straight to target
      // without running intermediate migrations — correct for genuinely pre-versioned
      // data; revisit only if a v0 file ever needs a real transform.
      break
    }
    data = migrate(data)
    version += 1
  }
  return { ...data, version: targetVersion }
}

/**
 * Load path: migrate raw persisted data, then validate. Resilient to bad DATA —
 * unknown keys are stripped, missing/invalid fields fall back to defaults, and
 * non-object input becomes the defaults. A newer-than-current file yields a
 * sanitized in-memory view with its original version preserved (not down-leveled).
 * Throws only on a developer error — a missing migration between released schema
 * versions (see {@link runMigrations}); callers that must not fail catch and fall back.
 */
export function parseSettings(raw: unknown): Settings {
  const migrated = runMigrations(isRecord(raw) ? raw : {})
  return SettingsSchema.parse(migrated)
}

/**
 * Whether a freshly-loaded raw object is safe to write back to disk. False when
 * the on-disk file came from a NEWER build — persisting the parsed (down-leveled)
 * form would strip its forward-compatible fields and lose data on a rollback.
 */
export function shouldPersistSettings(
  raw: unknown,
  currentVersion: number = SETTINGS_VERSION
): boolean {
  return readVersion(isRecord(raw) ? raw : {}) <= currentVersion
}
