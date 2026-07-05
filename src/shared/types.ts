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

interface Presence {
  state: PresenceState
}

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

/** Platform-true instance type before it is normalized into the openness ladder. */
export type VrcInstanceType =
  | 'public'
  | 'friends-plus'
  | 'friends'
  | 'invite-plus'
  | 'invite'
  | 'group-public'
  | 'group-plus'
  | 'group'

export type CvrInstanceType =
  | 'public'
  | 'friends-of-friends'
  | 'friends'
  | 'everyone-can-invite'
  | 'owner-must-invite'
  | 'group-public'
  | 'friends-of-members'
  | 'members-only'
  | 'offline'

export type InstanceType = VrcInstanceType | CvrInstanceType

export interface InstanceInfo {
  worldId: string
  instanceId: string
  worldName: string | null
  thumbnailUrl: string | null
  /** Platform-true instance type; normalize to openness for shared UI grouping. */
  type: InstanceType
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
interface FriendBase {
  /** Stable per-platform id (VRChat usr_… / CVR GUID). NEVER displayName. (VRX-61) */
  platformUserId: string
  platform: Platform
  displayName: string
  avatarUrl: string | null

  /** System presence → the dot. */
  presence: Presence

  /** Current instance, or null when hidden (Ask Me/DND), active, or offline. */
  instance: InstanceInfo | null

  // ── User-authored, per-account (VRX-24 / VRX-70) ──
  isFavorite: boolean
  favoriteGroupIds: string[]

  /** Link to a cross-platform logical person, if the user has linked this friend (VRX-143). */
  linkedPersonId: string | null
}

export interface VrcFriend extends FriendBase {
  platform: 'vrchat'
  /** User-chosen status → labeled pill. */
  status: UserStatus
  /** Custom status text, ≤32 chars. */
  statusDescription: string | null
  /** VRChat trust rank; null when not shown. */
  trustRank: TrustRank
}

export interface CvrFriend extends FriendBase {
  platform: 'chilloutvr'
  presence: { state: Exclude<PresenceState, 'active'> }
  status: null
  statusDescription: null
  trustRank: null
}

export type Friend = VrcFriend | CvrFriend

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
/** Canonical theme values — the single source for both the `Theme` type and the
 *  settings schema's `theme` enum (`@shared/settings`). */
// Order is the DISPLAY order (§8: System sits in the CENTER — it resolves to
// either neighbor, same 'mixed option in the middle' logic as the platform
// filter's All; owner-decided 2026-07-05, VRX-186).
export const THEMES = ['dark', 'system', 'light'] as const
export type Theme = (typeof THEMES)[number]

// ─── Instance-label scheme (VRX-183) ─────────────────────────────────────────
/** Which naming scheme the instance pills use (DESIGN.md §6 label rule):
 *  `vrchat` = VRChat terms on both platforms (the VRX-182 baseline/default),
 *  `chilloutvr` = CVR terms on both platforms,
 *  `platform-native` = each platform's own terms. Single source for both the
 *  `LabelScheme` type and the settings schema's `labelScheme` enum. */
export const LABEL_SCHEMES = ['vrchat', 'chilloutvr', 'platform-native'] as const
export type LabelScheme = (typeof LABEL_SCHEMES)[number]

// ─── Auth (VRX-16/18 — direct login + hybrid import) ─────────────────────────
export type AuthState = 'authenticated' | 'unauthenticated' | 'needs-2fa' | 'error'

export interface AuthStatus {
  platform: Platform
  state: AuthState
  /** Signed-in account's display name, when authenticated; null otherwise. */
  displayName: string | null
  /**
   * Which second factor to prompt for — present ONLY when `state` is
   * `'needs-2fa'` (the session's auth cookie is alive but the twoFactorAuth
   * cookie expired; VRX-173). Drives the method-aware reprompt copy.
   */
  twoFactorMethod?: TwoFactorMethod
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
 * VRChat emits per-friend deltas (VRX-146). CVR pushes its current online set as a
 * `presence-snapshot` — ids + instances only, NO profiles; a roster member absent
 * from the snapshot is offline (CVR `ONLINE_FRIENDS` semantics, VRX-147) — and
 * `roster-changed` when the friend list itself changes (trigger-only refetch).
 * `friends-snapshot` remains for full-Friend list replacements; it currently has
 * no producer (the CVR plan moved to `presence-snapshot` when the wire turned out
 * to carry no profiles) — removal is a follow-up decision, not this contract's.
 */
export type AdapterEvent =
  | { type: 'friend-presence'; platform: Platform; friend: Friend }
  /**
   * The friend went offline — a userId-only delta (VRX-146): VRChat's
   * `friend-offline` wire event carries NO user object, so a full `Friend`
   * can't be built; the consumer patches its cached entry to offline.
   */
  | { type: 'friend-offline'; platform: Platform; platformUserId: string }
  /**
   * Profile-only change (displayName / avatar / status / trust — VRChat
   * `friend-update`, VRX-146). The wire event says nothing about presence or
   * location, so the consumer merges profile fields and PRESERVES its cached
   * presence + instance — `friend-presence` would stomp them with guesses.
   */
  | { type: 'friend-updated'; platform: Platform; friend: Friend }
  | { type: 'friend-added'; platform: Platform; friend: Friend }
  | { type: 'friend-removed'; platform: Platform; platformUserId: string }
  | { type: 'friends-snapshot'; platform: Platform; scope: 'online' | 'all'; friends: Friend[] }
  /**
   * Presence-only snapshot (VRX-147): CVR's ONLINE_FRIENDS pushes the FULL
   * current online set as `{id, instance}` entries — no names/profiles — so a
   * full-Friend snapshot can't be built honestly from the wire. The consumer
   * patches presence+instance for listed ids and flips absent same-platform
   * friends offline (absent-from-snapshot ⇒ offline is the CVR contract).
   */
  | {
      type: 'presence-snapshot'
      platform: Platform
      entries: Array<{
        platformUserId: string
        /**
         * Producer discipline (not type-enforced): entries must respect the
         * platform's presence domain — CvrPipeline only ever emits
         * 'in-game' | 'offline' (CvrFriend has no 'active').
         */
        presence: Friend['presence']
        instance: InstanceInfo | null
      }>
    }
  /**
   * The friend ROSTER changed (adds/removes — CVR FRIEND_LIST_UPDATED,
   * VRX-147). Trigger-only: the consumer refetches the list over REST.
   */
  | { type: 'roster-changed'; platform: Platform }
  | { type: 'connection'; platform: Platform; health: ConnectionHealth }
