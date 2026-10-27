/**
 * VRX IPC contract (VRX-18)
 *
 * The single typed map of every channel between main ↔ preload ↔ renderer. The
 * preload bridge (VRX-19) and main handlers (VRX-20) derive their types from here,
 * so a typo'd channel name or wrong payload shape is a COMPILE error — not a silent
 * runtime failure (the old app's #1 bug class).
 *
 * ⚠️ Pure types — bundled into the sandboxed renderer. No electron/node imports.
 */
import type {
  Account,
  AdapterEvent,
  AppStatus,
  AuthStatus,
  Credentials,
  Friend,
  JoinMode,
  LoginResult,
  Platform
} from '@shared/types'
import type { Settings } from '@shared/settings'
import type { BackgroundPictureRefusal } from './backgroundPicture'
import type { LinkRequest, LinkResult, LinkSnapshot } from './linkedProfiles'
import type { ActivityEntry } from './activity'
import type {
  ExplorePlatformSnapshot,
  ExploreImageResult,
  ExploreWorldSnapshot,
  ExploreRefreshReason,
  ExploreWorldReason
} from './explore'

export type UpdaterState =
  'idle' | 'checking' | 'update-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported'

/** Renderer-safe updater failure categories. Third-party updater payloads are discarded. */
export type UpdaterFailure = 'check-network' | 'download-write' | 'staged-install'

export interface UpdaterSnapshot {
  state: UpdaterState
  currentVersion: string
  availableVersion: string | null
  progressPercent: number
  failure: UpdaterFailure | null
}

/** Result of picking a background picture. Failures carry only a typed reason. */
export type AppBackgroundResult =
  | { ok: true; dataUrl: string }
  | {
      ok: false
      reason:
        | 'cancelled'
        | 'unsupported'
        | 'too-large'
        | BackgroundPictureRefusal
        | 'unreadable'
        | 'save-failed'
    }

export type InstanceActionResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'unknown-friend'
        | 'stale'
        | 'not-joinable'
        | 'invalid-url'
        | 'cooldown'
        | 'rate-limited'
        | 'launch-failed'
        | 'invite-failed'
        | 'target-changed'
        | 'joining-disabled'
    }

/** Main-owned ordering, shared by physical roster reads and published live events. */
export interface FriendRosterProvenance {
  baseRevision: number
  /** Present only for partial results: IDs actually read, before renderer cache merging. */
  coveredIds?: string[]
  /** Partial follow-ups replace only these rows; omitted rows keep the base fence. */
  overrides: Array<{ revision: number; friendIds: string[] }>
}

export interface FriendRosterResponse {
  friends: Friend[]
  completeness: 'complete' | 'partial'
  provenance?: FriendRosterProvenance
}

export type FriendEvent = AdapterEvent & { rosterRevision?: number }

/**
 * Request/response channels — renderer asks, main answers:
 * `ipcRenderer.invoke(channel, req)` ↔ `ipcMain.handle(channel, …) → res`.
 */
export interface IpcInvoke {
  'set-explore-active': { req: { platforms: Platform[] }; res: void }
  'get-explore': {
    req: { platform: Platform; reason: ExploreRefreshReason }
    res: ExplorePlatformSnapshot
  }
  'get-explore-world': {
    req: { platform: Platform; worldRef: string; reason: ExploreWorldReason }
    res: ExploreWorldSnapshot | null
  }
  'cancel-explore-world': { req: { platform: Platform; worldRef: string }; res: void }
  'get-explore-image': {
    req: { platform: Platform; worldRef: string }
    res: ExploreImageResult
  }
  'join-explore-room': {
    req: { platform: Platform; selectionRef: string; mode: JoinMode }
    res: InstanceActionResult
  }
  'get-linked-profiles': { req: void; res: LinkResult<LinkSnapshot> }
  'change-linked-profile': {
    req: { lease: string; change: LinkRequest }
    res: LinkResult<LinkSnapshot>
  }
  'get-friends': {
    req: { platform: Platform }
    // VRChat carries physical-read ordering; legacy/CVR complete results remain arrays.
    res: Friend[] | FriendRosterResponse
  }
  /** `rendition: 'avatar'` asks for the small copy used by round friend pictures. */
  'get-avatar': {
    req: { url: string; rendition?: 'avatar' }
    res: { ok: true; dataUrl: string } | null
  }
  'get-accounts': { req: void; res: Account[] }
  'get-auth-status': { req: { platform: Platform }; res: AuthStatus }
  login: { req: { platform: Platform; credentials: Credentials }; res: LoginResult }
  'verify-2fa': { req: { platform: Platform; code: string }; res: LoginResult }
  /** Explicit "use my sign-in from this PC": main reads VRCX or ChilloutVR/CVRX
   *  read-only, then the adapter validates the owner before persisting. */
  'import-session': { req: { platform: Platform }; res: LoginResult }
  logout: { req: { platform: Platform }; res: void }
  'join-instance': {
    req: {
      platform: Platform
      friendId: string
      mode: JoinMode
      /** Compare-and-swap precondition: the target the user saw and accepted.
       *  Main compares this against the CURRENT authority target and rejects
       *  with `target-changed` if they no longer match — it is NEVER used as
       *  launch input. */
      expectedTarget: { worldId: string; instanceId: string }
    }
    res: InstanceActionResult
  }
  'self-invite': {
    req: { platform: 'vrchat'; friendId: string }
    res: InstanceActionResult
  }
  'get-app-status': { req: void; res: AppStatus }
  /** The in-memory activity list, newest first. Main records it from the live
   *  sockets; reading it makes no platform request. */
  'get-activity': { req: void; res: ActivityEntry[] }
  /** Forget every activity entry. */
  'clear-activity': { req: void; res: void }
  'open-url': { req: { url: string }; res: void }
  /** Reveal VRX's log directory in the OS file manager. Main owns the path. */
  'open-logs-folder': { req: void; res: void }
  /** The user's own background picture as a `data:` URL, or null when none is set. */
  'get-app-background': { req: void; res: { dataUrl: string } | null }
  /** Open the native picture dialog; main reads, re-encodes, and keeps the picked file. */
  'choose-app-background': { req: void; res: AppBackgroundResult }
  /** Forget the background picture. */
  'clear-app-background': { req: void; res: void }
  'get-settings': { req: void; res: Settings & { unsaved?: true; fallback?: true } }
  'save-settings': { req: { patch: Partial<Settings> }; res: Settings }
  'updater:get-state': { req: void; res: UpdaterSnapshot }
  'updater:check': { req: void; res: void }
  'updater:download': { req: void; res: void }
  'updater:install': { req: void; res: void }
  'get-friend-note': {
    req: { platform: Platform; friendId: string }
    res: { note: string | null; revision?: { platformAccountId: string; epoch: number } }
  }
  'set-friend-note': {
    req: {
      platform: Platform
      friendId: string
      note: string
      revision: { platformAccountId: string; epoch: number }
    }
    res:
      | { ok: true }
      | { ok: false; reason: 'not-authenticated' | 'invalid' | 'stale' | 'rate-limited' }
  }
}

/**
 * Push channels — main → renderer: `webContents.send(channel, payload)` ↔
 * `ipcRenderer.on(channel, …)`. This is the LIVE path: WS events pushed to the UI,
 * never polled (CLAUDE.md).
 */
export interface IpcEvents {
  'explore-changed': { platform: Platform }
  'linked-profiles-changed': void
  /** The activity list changed; coalesced, carries nothing. */
  'activity-changed': void
  'friend-event': FriendEvent
  'identity-boundary': { platform: Platform }
  /** A hot-instance alert click: open Hot Instances with this platform in view. */
  'navigate-to-dashboard': { platform: Platform }
  'updater:state-changed': UpdaterSnapshot
}

/**
 * Notify channels — renderer → main, no response:
 * `ipcRenderer.send(channel, payload)` ↔ `ipcMain.on(channel, …)`.
 */
export interface IpcNotifications {
  'renderer-hydrated': void
}

export type IpcInvokeChannel = keyof IpcInvoke
export type IpcEventChannel = keyof IpcEvents
export type IpcNotificationChannel = keyof IpcNotifications

// Channels deliberately deferred until their feature exists — we don't define
// payload types for things that aren't built yet (keeps the contract honest):
//   'get-notifications'              → Notification[] (notifications, M3)
//   'launch-app'                     → LaunchResult (process launch, VRX-98)
