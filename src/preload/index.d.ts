import type { IpcEvents, IpcInvoke } from '@shared/ipc'

type VrxBridge = {
  getFriends: (req: IpcInvoke['get-friends']['req']) => Promise<IpcInvoke['get-friends']['res']>
  getAvatar: (url: string) => Promise<IpcInvoke['get-avatar']['res']>
  getAccounts: () => Promise<IpcInvoke['get-accounts']['res']>
  getAuthStatus: (
    req: IpcInvoke['get-auth-status']['req']
  ) => Promise<IpcInvoke['get-auth-status']['res']>
  login: (req: IpcInvoke['login']['req']) => Promise<IpcInvoke['login']['res']>
  verify2fa: (req: IpcInvoke['verify-2fa']['req']) => Promise<IpcInvoke['verify-2fa']['res']>
  logout: (req: IpcInvoke['logout']['req']) => Promise<IpcInvoke['logout']['res']>
  /** Friend IDs only; instance identifiers never cross from the renderer. */
  joinInstance: (
    req: IpcInvoke['join-instance']['req']
  ) => Promise<IpcInvoke['join-instance']['res']>
  selfInvite: (req: IpcInvoke['self-invite']['req']) => Promise<IpcInvoke['self-invite']['res']>
  getAppStatus: () => Promise<IpcInvoke['get-app-status']['res']>
  openUrl: (req: IpcInvoke['open-url']['req']) => Promise<IpcInvoke['open-url']['res']>
  getSettings: () => Promise<IpcInvoke['get-settings']['res']>
  saveSettings: (
    req: IpcInvoke['save-settings']['req']
  ) => Promise<IpcInvoke['save-settings']['res']>
  /** Live adapter events pushed from main (VRX-146). Returns an unsubscribe. */
  onFriendEvent: (callback: (event: IpcEvents['friend-event']) => void) => () => void
  /** Per-platform identity changes clear renderer-owned account data (VRX-24). */
  onIdentityBoundary: (callback: (event: IpcEvents['identity-boundary']) => void) => () => void
  /** Native hot-instance toast click → Dashboard (VRX-85). */
  onNavigateToDashboard: (callback: () => void) => () => void
}

declare global {
  interface Window {
    vrx: VrxBridge
  }
}
