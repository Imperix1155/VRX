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
 */
import { z } from 'zod'
import { THEMES } from './types'

/** Bump ONLY when a field needs a transforming migration (not a plain add/remove —
 *  additive fields are covered by schema defaults, removed fields by key stripping). */
export const SETTINGS_VERSION = 1 as const

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
  telemetryEnabled: z.boolean().catch(false)
})

export type Settings = z.infer<typeof SettingsSchema>

/** Canonical defaults — every field's fallback, materialized from an empty object. */
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

/** A migration transforms the persisted shape from version N to N+1. */
export type SettingsMigration = (prev: Record<string, unknown>) => Record<string, unknown>

/**
 * version N → function producing the version N+1 shape.
 *
 * EMPTY by design: there is no prior released schema to migrate from yet, and
 * additive/removed fields are handled by the schema (defaults + key stripping).
 * Register a function here only when a field's *meaning* changes and old data
 * must be transformed.
 */
export const SETTINGS_MIGRATIONS: Readonly<Record<number, SettingsMigration>> = {}

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
export function shouldPersistSettings(raw: unknown): boolean {
  return readVersion(isRecord(raw) ? raw : {}) <= SETTINGS_VERSION
}
