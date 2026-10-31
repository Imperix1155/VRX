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
 *   friendAlertScope       → everyone, or only picked friends, for friend alerts (owner, 2026-10-27;
 *                            default everyone; the picks are per account in SocialStore)
 *   reconcileInterval      → friends-list background safety-net cadence (VRX-77; WS remains live path;
 *                            1h default matches VRCX, v14)
 *   drawerOpener           → friend-drawer pointer opener surface (VRX-228; whole-card default, owner ruling 2026-07-27)
 *   allowJoinInstances     → whether VRX may launch a friend's instance (VRX-39; default ON)
 *   confirmJoin            → whether joining requires confirmation (VRX-210; confirmation default ON)
 *   joinMode               → preferred launch mode (VRX-210; ask every time by default)
 *   joinOpenGame           → Join uses a game that is already open instead of starting it
 *                            again, as VRCX and CVRX do (owner, 2026-10-27; default ON)
 *   vrchatOpenGameJoin     → how VRChat joins when open: go there, or a self-invite
 *                            (owner, 2026-10-27; default go there)
 *   autoUpdate             → opt-in automatic download of updates (VRX-113; default OFF)
 *   updateChannel          → stable, beta, or dev feed (default stable; invalid values stay stable)
 *   dashboardSectionOrder  → which Dashboard section comes first (default Popular now first)
 *   dashboardWearingNow, dashboardInvites → the Dashboard's worn-avatar and latest-invite
 *                            sections (owner, 2026-10-27; default shown, v21)
 *   dashboardSections      → the order of every Dashboard section below the numbers (owner,
 *                            2026-10-27; v21). It owns the order: dashboardSectionOrder is kept
 *                            in step (Popular now vs Hot Instances) for older builds.
 *   dashboardHideEmpty     → Dashboard sections with nothing to show step aside so the rest
 *                            use the space (owner, 2026-10-27; default on, v21)
 *   showHotInstancesPage, showExplorePage → optional sidebar pages (owner, 2026-10-20; default shown)
 *   showActivityPage       → the Activity page and its in-memory record (owner, 2026-10-27; default on)
 *   activityFilter         → which kind the Activity page lists (owner, 2026-10-27; all)
 *   showInboxPage          → optional Inbox page (owner, 2026-10-27; default shown, v20)
 *   notifyInvites, notifyFriendRequests → inbox alerts (owner, 2026-10-27; opt-in like every alert, v20)
 *   vrOverlayAlerts, vrOverlayAlertDuration → the same alerts in the VR headset through
 *                            XSOverlay, which VRCX and CVRX both support (owner, 2026-10-31;
 *                            default off, v22)
 *   backgroundPictureFade  → how much the user's own background picture fades (owner, 2026-10-26)
 *   setupPending           → first-run welcome setup is waiting (owner, 2026-10-20; main sets it
 *                            only for a brand-new settings file or "Run setup again")
 */
import { z } from 'zod'
import {
  HOT_INSTANCE_THRESHOLD,
  HOT_INSTANCE_THRESHOLD_MAX,
  HOT_INSTANCE_THRESHOLD_MIN
} from './constants'
import {
  BACKGROUND_GLOWS,
  BACKGROUND_PICTURE_FADES,
  DASHBOARD_SECTION_ORDERS,
  DASHBOARD_SECTIONS,
  dashboardSectionOrderOf,
  dashboardSectionsFromOrder,
  normalizeDashboardSections,
  DRAWER_OPENERS,
  FRIEND_ALERT_SCOPES,
  FRIEND_SECTIONS,
  JOIN_MODE_PREFERENCES,
  LABEL_SCHEMES,
  RECONCILE_INTERVALS,
  THEMES,
  UPDATE_CHANNELS,
  VR_ALERT_DURATIONS,
  VRCHAT_OPEN_GAME_JOINS
} from './types'
import { ACTIVITY_FILTERS } from './activity'

/** Additive-at-the-same-version fields can be silently stripped and rewritten by
 *  an older build during a downgrade round-trip. Versioning the addition makes
 *  that older build refuse persistence via shouldPersistSettings, preserving the
 *  user's newer choice even though the migration itself is identity-only. */
export const SETTINGS_VERSION = 22 as const

export const SettingsSchema = z.object({
  /** Global platform selection and the approved discovery world total. */
  platformFilter: z.enum(['all', 'vrchat', 'chilloutvr']).catch('all'),
  exploreWorldsShown: z.union([z.literal(2), z.literal(4), z.literal(6)]).catch(4),
  /** Dashboard features default on; child preferences survive disabling. */
  dashboardPopularNow: z.boolean().catch(true),
  hotInstancesEnabled: z.boolean().catch(true),
  /** Dashboard section order; the first section shows picture cards. */
  dashboardSectionOrder: z.enum(DASHBOARD_SECTION_ORDERS).catch('popular-first'),
  /** The worn avatar per platform, and the latest invite per platform, under the
   *  Dashboard numbers. Hiding either keeps the Avatars and Inbox pages. */
  dashboardWearingNow: z.boolean().catch(true),
  dashboardInvites: z.boolean().catch(true),
  /** The order of every section below the Dashboard numbers. Unknown or repeated
   *  entries drop and missing ones are appended; a file without it takes the order
   *  from `dashboardSectionOrder` (see `parseSettings`). */
  dashboardSections: z
    .array(z.unknown())
    .max(16)
    .transform(normalizeDashboardSections)
    .catch([...DASHBOARD_SECTIONS]),
  /** Sections with nothing to show (no invites, no hot instances) step aside and
   *  the first shown section takes the picture cards. Off shows their empty states. */
  dashboardHideEmpty: z.boolean().catch(true),
  /** Optional sidebar pages. Hiding a page keeps its Dashboard section and alerts. */
  showHotInstancesPage: z.boolean().catch(true),
  showExplorePage: z.boolean().catch(true),
  /** The Activity page. Off also stops VRX keeping activity and forgets what it kept. */
  showActivityPage: z.boolean().catch(true),
  /** Which kind the Activity page lists. Filters the view only; nothing is lost. */
  activityFilter: z.enum(ACTIVITY_FILTERS).catch('all'),
  /** The Inbox page. Hiding it keeps its alerts, which have their own switches. */
  showInboxPage: z.boolean().catch(true),
  /** First-run welcome setup is waiting. Missing or invalid data never starts it:
   *  main marks only a brand-new install (see `freshInstallSettings`). */
  setupPending: z.boolean().catch(false),
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
  /** Remembered permission for external CVR session discovery at startup. */
  cvrSessionImportChoice: z.enum(['ask', 'skip', 'import']).catch('ask'),
  /** Opt-in crash/usage telemetry; OFF by default. */
  telemetryEnabled: z.boolean().catch(false),
  /** Instance-pill naming scheme (DESIGN.md §6 label rule). Values from `@shared/types` LABEL_SCHEMES. */
  labelScheme: z.enum(LABEL_SCHEMES).catch('vrchat'),
  /** Min friends in one instance for the dashboard hot grid (VRX-78). Out-of-range/invalid → the default. */
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
  /** Who the three friend alerts above cover (owner, 2026-10-27). `picked` limits
   *  them to the friends chosen in the details panel; hot-instance alerts are
   *  about groups and stay unaffected. Default everyone keeps today's behavior. */
  friendAlertScope: z.enum(FRIEND_ALERT_SCOPES).catch('everyone'),
  /** Native alerts for a new invite or invite request, and a new friend request. Off by default. */
  notifyInvites: z.boolean().catch(false),
  notifyFriendRequests: z.boolean().catch(false),
  /** Also show every alert switched on above in the VR headset through XSOverlay,
   *  over this computer only. Off by default; the switches above still pick which alerts fire. */
  vrOverlayAlerts: z.boolean().catch(false),
  /** How long each VR alert stays in view. */
  vrOverlayAlertDuration: z.enum(VR_ALERT_DURATIONS).catch('medium'),
  /** Background aurora intensity (owner-ratified 2026-07-17). `standard` is the new default;
   *  `off` hides the glow (owner, 2026-10-26). */
  backgroundGlow: z.enum(BACKGROUND_GLOWS).catch('standard'),
  /** Fade over the user's own background picture. The picture itself is a file
   *  main keeps in app storage, never a setting. */
  backgroundPictureFade: z.enum(BACKGROUND_PICTURE_FADES).catch('medium'),
  /** Friends-list background reconcile cadence (VRX-77). The WebSocket remains the live path. */
  reconcileInterval: z.enum(RECONCILE_INTERVALS).catch('1h'),
  /** Friend-drawer POINTER opener surface (VRX-228): `card` = the whole row opens
   *  (default, owner ruling 2026-07-27 — Join pill still wins), `avatar` = the
   *  VRX-225 avatar-only behavior. Values from `@shared/types` DRAWER_OPENERS. */
  drawerOpener: z.enum(DRAWER_OPENERS).catch('card'),
  /** Whether Join actions may launch the game (VRX-39). Default ON for existing behavior. */
  allowJoinInstances: z.boolean().catch(true),
  /** Whether a Join action asks for confirmation before launching (VRX-210). */
  confirmJoin: z.boolean().catch(true),
  /** Preferred Join launch mode (VRX-210). `ask` defers the choice to each Join action. */
  joinMode: z.enum(JOIN_MODE_PREFERENCES).catch('ask'),
  /** Join sends you into VRChat or ChilloutVR when it is already open on this
   *  computer, instead of starting a second copy. Off always starts the game. */
  joinOpenGame: z.boolean().catch(true),
  /** How VRChat joins when it is already open. Main falls back to `invite`
   *  wherever the game cannot take the join directly. */
  vrchatOpenGameJoin: z.enum(VRCHAT_OPEN_GAME_JOINS).catch('go'),
  /** Opt-in automatic update download (VRX-113). Default OFF — consent-first. */
  autoUpdate: z.boolean().catch(false),
  /**
   * Update feed. `stable` reads only public releases. Anything else, including
   * a missing or unknown value, stays on stable so a bad patch cannot opt in
   * to a prerelease feed.
   */
  updateChannel: z.enum(UPDATE_CHANNELS).catch('stable')
})

export type Settings = z.infer<typeof SettingsSchema>

/** Canonical defaults — every field's fallback, materialized from an empty object. */
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({})

/** A migration transforms the persisted shape from version N to N+1. */
export type SettingsMigration = (prev: Record<string, unknown>) => Record<string, unknown>

/**
 * version N → function producing the version N+1 shape.
 *
 * v1 → v2 through v10 → v11, v12 → v13, and v14 → v22 are deliberately
 * identity-only: the shape remains schema-compatible, while the version boundary
 * protects newer fields from older-build key stripping during rollback.
 */
export const SETTINGS_MIGRATIONS: Readonly<Record<number, SettingsMigration>> = {
  1: (prev) => ({ ...prev }),
  2: (prev) => ({ ...prev }),
  3: (prev) => ({ ...prev }),
  4: (prev) => ({ ...prev }),
  5: (prev) => ({ ...prev }),
  6: (prev) => ({ ...prev }),
  7: (prev) => ({ ...prev }),
  8: (prev) => ({ ...prev }),
  9: (prev) => ({ ...prev }),
  10: (prev) => ({ ...prev }),
  // v11 → v12: up to v11 the hot-instance alert also needed the Dashboard's Hot
  // Instances switch. Since v12 only the alert's own switch gates it, so fold
  // the old gate in: an alert the user had muted that way stays off.
  11: (prev) => ({
    ...prev,
    notifyHotInstance: prev.notifyHotInstance === true && prev.hotInstancesEnabled !== false
  }),
  12: (prev) => ({ ...prev }),
  // v13 → v14: the background re-sync default moved from 5 minutes to 1 hour
  // to match VRCX's friend-list cadence. Settings save every field, so a stored
  // `5m` is almost always the old default rather than a choice; move it too.
  // The user can still pick 5 minutes again.
  13: (prev) => ({
    ...prev,
    reconcileInterval: prev.reconcileInterval === '5m' ? '1h' : prev.reconcileInterval
  }),
  // v14 → v15: `updateChannel` is additive. The version boundary keeps a stored
  // beta or dev choice if an older build loads the file and would otherwise
  // strip the key. Missing values still parse as stable.
  14: (prev) => ({ ...prev }),
  // v15 → v16: `backgroundGlow: 'off'` and `backgroundPictureFade` are
  // additive. The version boundary stops an older build from turning a stored
  // `off` back into standard or stripping the fade.
  15: (prev) => ({ ...prev }),
  // v16 → v17: the Activity page switch and its filters are additive. The
  // version boundary stops an older build from stripping a user's Off.
  16: (prev) => ({ ...prev }),
  // v17 → v18: `friendAlertScope` is additive. The version boundary stops an
  // older build from stripping a stored `picked` and alerting for everyone.
  17: (prev) => ({ ...prev }),
  // v18 → v19: `joinOpenGame` and `vrchatOpenGameJoin` are additive. The
  // version boundary keeps a stored choice if an older build loads the file.
  18: (prev) => ({ ...prev }),
  // v19 → v20: `showInboxPage`, `notifyInvites` and `notifyFriendRequests` are
  // additive. The version boundary stops an older build from stripping them.
  19: (prev) => ({ ...prev }),
  // v20 → v21: `dashboardWearingNow`, `dashboardInvites`, `dashboardSections`
  // and `dashboardHideEmpty` are additive. The
  // version boundary stops an older build from stripping a user's Off.
  20: (prev) => ({ ...prev }),
  // v21 → v22: `vrOverlayAlerts` and `vrOverlayAlertDuration` are additive. The
  // version boundary stops an older build from stripping a user's choice.
  21: (prev) => ({ ...prev })
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
  const parsed = SettingsSchema.parse(migrated)
  // The section list owns the Dashboard order. A file from before it existed
  // keeps its Popular now / Hot Instances order; afterwards the older field
  // follows the list so an older build still shows the same two in order.
  const sections = Array.isArray(migrated.dashboardSections)
    ? parsed.dashboardSections
    : dashboardSectionsFromOrder(parsed.dashboardSectionOrder)
  return {
    ...parsed,
    dashboardSections: sections,
    dashboardSectionOrder: dashboardSectionOrderOf(sections)
  }
}

/**
 * Settings for a brand-new install: the defaults with the welcome setup queued.
 * Main uses this only when no settings file exists yet (an empty store), so
 * every existing install, including one with only default choices, skips setup.
 */
export function freshInstallSettings(): Settings {
  return { ...DEFAULT_SETTINGS, setupPending: true }
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
