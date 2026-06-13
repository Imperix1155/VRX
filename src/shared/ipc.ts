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
} from './types'

/**
 * Request/response channels — renderer asks, main answers:
 * `ipcRenderer.invoke(channel, req)` ↔ `ipcMain.handle(channel, …) → res`.
 */
export interface IpcInvoke {
  'get-friends': { req: { platform: Platform }; res: Friend[] }
  'get-accounts': { req: void; res: Account[] }
  'get-auth-status': { req: { platform: Platform }; res: AuthStatus }
  login: { req: { platform: Platform; credentials: Credentials }; res: LoginResult }
  'join-instance': { req: { platform: Platform; instanceId: string; mode: JoinMode }; res: void }
  'self-invite': { req: { platform: Platform; instanceId: string }; res: void }
  'get-app-status': { req: void; res: AppStatus }
  'open-url': { req: { url: string }; res: void }
}

/**
 * Push channels — main → renderer: `webContents.send(channel, payload)` ↔
 * `ipcRenderer.on(channel, …)`. This is the LIVE path: WS events pushed to the UI,
 * never polled (CLAUDE.md).
 */
export interface IpcEvents {
  'friend-event': AdapterEvent
}

export type IpcInvokeChannel = keyof IpcInvoke
export type IpcEventChannel = keyof IpcEvents

// Channels deliberately deferred until their feature exists — we don't define
// payload types for things that aren't built yet (keeps the contract honest):
//   'get-settings' / 'save-settings' → Settings (VRX-23)
//   'get-notifications'              → Notification[] (notifications, M3)
//   'launch-app'                     → LaunchResult (process launch, VRX-98)
