/**
 * VRX shared types (VRX-6)
 *
 * The common data model both platform adapters normalize into, and the contract
 * the entire UI depends on. Encodes the design language: see DESIGN.md §5 (color
 * channel law / presence), §6 (openness ladder), §10 (cross-platform linking).
 *
 * ⚠️ Bundled into the RENDERER (sandboxed). Keep pure: types + plain values only,
 * no `electron`/`node` imports. String-literal unions (not const enum) — esbuild-safe
 * and friendly to the Zod validation layer.
 */

// ─── Platform ────────────────────────────────────────────────────────────────
export type Platform = 'vrchat' | 'chilloutvr'

// ─── Presence: TWO separate axes (DESIGN.md §5) ──────────────────────────────
// VRChat splits presence across two API fields; DO NOT conflate them.

/**
 * STATE = system-assigned presence → the avatar DOT.
 * - 'in-game'  : in a world (VRChat state="online")
 * - 'active'   : online but NOT in game — web/desktop app (VRChat state="active"). VRChat-only.
 * - 'offline'  : offline
 * CVR is in-game/offline only (no 'active').
 */
export type PresenceState = 'in-game' | 'active' | 'offline'

/**
 * STATUS = user-chosen intent → the labeled PILL. VRChat only (null on CVR).
 * ⚠️ VRChat API string "active" maps to 'online' here (displays "Online", green);
 *    do not confuse with PresenceState 'active'. "busy" maps to 'dnd'.
 */
export type UserStatus = 'join-me' | 'online' | 'ask-me' | 'dnd' | null

/** VRChat trust rank (opt-in, off by default — DESIGN.md §5). Null on CVR / when hidden. */
export type TrustRank = 'visitor' | 'new' | 'user' | 'known' | 'trusted' | 'nuisance' | null

// ─── Instance openness (DESIGN.md §6 — one shared ladder, both platforms) ─────
/**
 * Shared openness tier. `group` is a MODIFIER (see InstanceInfo.isGroup), not its
 * own tier — a group instance still has one of these openness levels.
 * 'offline' is a CVR-only state (local/non-networked instance, not joinable).
 */
export type OpennessTier =
  | 'public'
  | 'friends-plus' // VRChat Friends+ / CVR Friends of Friends
  | 'friends'
  | 'invite-plus' // VRChat Invite+ / CVR Everyone Can Invite
  | 'invite' // VRChat Invite / CVR Owner Must Invite
  | 'offline' // CVR Offline Instance (not joinable)

export interface InstanceInfo {
  worldId: string
  instanceId: string
  worldName: string | null
  thumbnailUrl: string | null
  openness: OpennessTier
  /** True for group instances (Group Public / Group+ / Group · etc.). The Group chip modifier. */
  isGroup: boolean
  /** Owning group's display name, when isGroup. */
  groupName: string | null
  region: string | null
  /** Current occupant count, when known. */
  userCount: number | null
}

// ─── Friend (the normalized model both adapters produce) ──────────────────────
export interface Friend {
  /** Stable per-platform id (VRChat usr_… / CVR GUID). NEVER displayName. (VRX-61) */
  platformUserId: string
  platform: Platform
  displayName: string
  avatarUrl: string | null

  /** System presence → the dot. */
  presence: PresenceState
  /** User-chosen status → labeled pill. VRChat only; null on CVR. */
  status: UserStatus
  /** Custom status text, ≤32 chars. VRChat only; null on CVR. */
  statusDescription: string | null

  /** Current instance, or null when hidden (Ask Me/DND), active, or offline. */
  instance: InstanceInfo | null

  /** VRChat trust rank; null on CVR or when not shown. */
  trustRank: TrustRank

  // ── User-authored, per-account (VRX-24 / VRX-70) ──
  isFavorite: boolean
  favoriteGroupIds: string[]

  /** Link to a cross-platform logical person, if the user has linked this friend (VRX-143). */
  linkedPersonId: string | null
}

// ─── Cross-platform linked person (DESIGN.md §10 / VRX-143) ───────────────────
/** A user-created link uniting one VRChat + one CVR friend as a single logical person. */
export interface LinkedPerson {
  id: string
  /** platformUserIds of the linked friends (one per platform). One-to-one. */
  memberIds: string[]
  /** Optional user-set display name for the merged person. */
  displayName: string | null
}

// ─── Multi-account (VRX-24) ───────────────────────────────────────────────────
export interface Account {
  /** Stable local id for this account (namespaces all per-account data). */
  accountId: string
  platform: Platform
  displayName: string
  /** Whether this is the active account for its platform. */
  isActive: boolean
}

// ─── App-level status / health (dashboard — VRX-79) ──────────────────────────
/** Per-channel connection health, shown on the dashboard. */
export type ConnectionHealth = 'live' | 'reconnecting' | 'down' | 'ok' | 'degraded' | 'failed'

export interface AppStatus {
  /** WebSocket connection state per platform. */
  ws: Record<Platform, ConnectionHealth>
  /** Last REST call result per platform. */
  rest: Record<Platform, ConnectionHealth>
  network: boolean
  /** Timestamp (ms epoch) of the last successful full reconcile. */
  lastReconcileAt: number | null
}

// ─── Theme (VRX-115) ──────────────────────────────────────────────────────────
export type Theme = 'dark' | 'light' | 'system'

// ─── Auth (VRX-16/18 — direct login + hybrid import) ─────────────────────────
export type AuthState = 'authenticated' | 'unauthenticated' | 'needs-2fa' | 'error'

export interface AuthStatus {
  platform: Platform
  state: AuthState
  /** Signed-in account's display name, when authenticated; null otherwise. */
  displayName: string | null
}

/**
 * Login credentials sent renderer → main. `password` holds the secret — a VRChat
 * password, or a ChilloutVR AccessKey (the same "secret" slot). `twoFactorCode` is
 * VRChat-only, supplied on the retry after a `needs-2fa` result.
 * ⚠️ Never log this object (the electron-log redaction hook covers it).
 */
export interface Credentials {
  username: string
  password: string
  twoFactorCode?: string
}

export type TwoFactorMethod = 'email' | 'totp'

/** Result of a login attempt — drives the 2FA flow. */
export type LoginResult =
  | { ok: true }
  | { ok: false; needs2fa: true; method: TwoFactorMethod }
  | { ok: false; needs2fa: false; error: string }

// ─── Instance join (VRX-16) ──────────────────────────────────────────────────
/** Join an instance by launching the desktop client or VR mode. */
export type JoinMode = 'desktop' | 'vr'

// ─── Adapter live events (the WebSocket-pushed stream — VRX-146/147) ──────────
/**
 * Normalized real-time event an adapter emits via `subscribe()`. Each platform maps
 * its raw WS events into this shape; the UI/stores never see raw platform objects.
 * VRChat emits per-friend deltas; CVR pushes the current online set as a
 * `friends-snapshot` with `scope: 'online'` — a roster member NOT in that list is
 * offline (CVR `ONLINE_FRIENDS` semantics, VRX-147). `scope: 'all'` is a full
 * friend-list replacement. Extended as the WS clients (VRX-146/147) are built.
 */
export type AdapterEvent =
  | { type: 'friend-presence'; platform: Platform; friend: Friend }
  | { type: 'friend-added'; platform: Platform; friend: Friend }
  | { type: 'friend-removed'; platform: Platform; platformUserId: string }
  | { type: 'friends-snapshot'; platform: Platform; scope: 'online' | 'all'; friends: Friend[] }
  | { type: 'connection'; platform: Platform; health: ConnectionHealth }
