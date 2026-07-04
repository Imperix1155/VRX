/**
 * VRX shared constants (VRX-7)
 *
 * Single source of truth for every magic number / endpoint used across
 * main, preload, and renderer. NEVER hardcode these values elsewhere.
 *
 * ⚠️ This file is bundled into the RENDERER (sandboxed browser context).
 * Keep it pure: no `electron`/`node` imports, no side effects — values only.
 */

// ─── API base URLs (verified vs platform sources, 2026-06) ───────────────────
/** VRChat REST API base. */
export const VRC_API_BASE = 'https://api.vrchat.cloud/api/1' as const

/** ChilloutVR REST API base. `api.chilloutvr.net` is an alias of the same host. */
export const CVR_API_BASE = 'https://api.abinteractive.net/1' as const
/** ChilloutVR user WebSocket (real-time). Auth via Username/AccessKey headers on upgrade. */
export const CVR_WS_URL = 'wss://api.chilloutvr.net/1/users/ws' as const

// ─── Polling / refresh cadence ───────────────────────────────────────────────
// NOTE: WebSocket is the primary real-time path (VRX-146/147). These intervals
// are the REST reconcile/fallback cadence (VRX-22/77), not the live path.
/** Friend-list REST reconcile interval (ms) — the slow safety-net cadence
 *  (minutes, not seconds), NOT a live poll: the WS drives live updates
 *  (VRX-146/147). User-configurable (VRX-77). */
export const FRIENDS_RECONCILE_MS = 300_000
/** Per-request timeout for all API calls (ms). */
export const API_TIMEOUT_MS = 15_000

/** VRChat Pipeline WebSocket endpoint (VRX-146). Token goes in `?authToken=`. */
export const VRC_PIPELINE_URL = 'wss://pipeline.vrchat.cloud/' as const
/** Pipeline reconnect backoff: base doubles per failure up to the cap, plus jitter. */
export const PIPELINE_BACKOFF_BASE_MS = 1_000
export const PIPELINE_BACKOFF_CAP_MS = 60_000
/** Debounce for the friend-list search box (ms). */
export const SEARCH_DEBOUNCE_MS = 200

// ─── Safety caps / limits ────────────────────────────────────────────────────
/** Hard cap on friends fetched, to bound runaway pagination. */
export const MAX_FRIENDS = 5000
/** Max concurrent in-flight API requests (world/instance batch fetches). */
export const CONCURRENCY_LIMIT = 10

// ─── Caching ─────────────────────────────────────────────────────────────────
/** World metadata TTL (ms) — worlds rarely change. 24h. */
export const WORLD_CACHE_TTL_MS = 86_400_000
/** Instance detail TTL (ms) — instances are volatile. 5min. */
export const INSTANCE_CACHE_TTL_MS = 300_000

// ─── Feature thresholds ──────────────────────────────────────────────────────
/** Min friends in one instance for it to count as a "hot instance". User-configurable. */
export const HOT_INSTANCE_THRESHOLD = 2
/** Bounds for the user-configurable hot threshold (VRX-78) — schema + both steppers share these. */
export const HOT_INSTANCE_THRESHOLD_MIN = 1
export const HOT_INSTANCE_THRESHOLD_MAX = 10

// ─── Platform / app identity ─────────────────────────────────────────────────
/** CVR `Platform` header value (verified vs CVRX source). */
export const CVR_PLATFORM = 'pc_standalone' as const
