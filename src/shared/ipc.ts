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

export type InstanceActionResult =
  | { ok: true }
  | {
      ok: false
      reason: 'unknown-friend' | 'stale' | 'not-joinable' | 'invalid-url' | 'cooldown'
    }

/**
 * Request/response channels — renderer asks, main answers:
 * `ipcRenderer.invoke(channel, req)` ↔ `ipcMain.handle(channel, …) → res`.
 */
export interface IpcInvoke {
  'get-friends': { req: { platform: Platform }; res: Friend[] }
  'get-avatar': { req: { url: string }; res: { ok: true; dataUrl: string } | null }
  'get-accounts': { req: void; res: Account[] }
  'get-auth-status': { req: { platform: Platform }; res: AuthStatus }
  login: { req: { platform: Platform; credentials: Credentials }; res: LoginResult }
  'verify-2fa': { req: { platform: Platform; code: string }; res: LoginResult }
  logout: { req: { platform: Platform }; res: void }
  'join-instance': {
    req: { platform: Platform; friendId: string; mode: JoinMode }
    res: InstanceActionResult
  }
  'self-invite': {
    req: { platform: 'vrchat'; friendId: string }
    res: InstanceActionResult
  }
  'get-app-status': { req: void; res: AppStatus }
  'open-url': { req: { url: string }; res: void }
  'get-settings': { req: void; res: Settings }
  'save-settings': { req: { patch: Partial<Settings> }; res: Settings }
}

/**
 * Push channels — main → renderer: `webContents.send(channel, payload)` ↔
 * `ipcRenderer.on(channel, …)`. This is the LIVE path: WS events pushed to the UI,
 * never polled (CLAUDE.md).
 */
export interface IpcEvents {
  'friend-event': AdapterEvent
  'navigate-to-dashboard': void
}

export type IpcInvokeChannel = keyof IpcInvoke
export type IpcEventChannel = keyof IpcEvents

// Channels deliberately deferred until their feature exists — we don't define
// payload types for things that aren't built yet (keeps the contract honest):
//   'get-notifications'              → Notification[] (notifications, M3)
//   'launch-app'                     → LaunchResult (process launch, VRX-98)
