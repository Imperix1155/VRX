import { contextBridge, ipcRenderer } from 'electron'
import type { IpcEvents, IpcInvoke, IpcNotifications } from '@shared/ipc'

async function invoke<K extends keyof IpcInvoke>(
  channel: K,
  req: IpcInvoke[K]['req']
): Promise<IpcInvoke[K]['res']> {
  try {
    return (await ipcRenderer.invoke(channel, req)) as IpcInvoke[K]['res']
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'rate_limited' ||
        error.message === `Error invoking remote method '${channel}': Error: rate_limited`)
    ) {
      throw new Error('rate_limited')
    }
    throw error
  }
}

function notify<K extends keyof IpcNotifications>(channel: K, payload: IpcNotifications[K]): void {
  ipcRenderer.send(channel, payload)
}

const vrx = {
  getFriends: (req: IpcInvoke['get-friends']['req']) => invoke('get-friends', req),
  getAvatar: (url: string) => invoke('get-avatar', { url }),
  getAccounts: () => invoke('get-accounts', undefined),
  getAuthStatus: (req: IpcInvoke['get-auth-status']['req']) => invoke('get-auth-status', req),
  login: (req: IpcInvoke['login']['req']) => invoke('login', req),
  verify2fa: (req: IpcInvoke['verify-2fa']['req']) => invoke('verify-2fa', req),
  logout: (req: IpcInvoke['logout']['req']) => invoke('logout', req),
  // Friend IDs only: the main-process LocationAuthority owns every instance identifier.
  joinInstance: (req: IpcInvoke['join-instance']['req']) => invoke('join-instance', req),
  selfInvite: (req: IpcInvoke['self-invite']['req']) => invoke('self-invite', req),
  getAppStatus: () => invoke('get-app-status', undefined),
  openUrl: (req: IpcInvoke['open-url']['req']) => invoke('open-url', req),
  getSettings: () => invoke('get-settings', undefined),
  saveSettings: (req: IpcInvoke['save-settings']['req']) => invoke('save-settings', req),
  getUpdaterState: () => invoke('updater:get-state', undefined),
  checkForUpdates: () => invoke('updater:check', undefined),
  downloadUpdate: () => invoke('updater:download', undefined),
  installUpdate: () => invoke('updater:install', undefined),
  getFriendNote: (req: IpcInvoke['get-friend-note']['req']) => invoke('get-friend-note', req),
  setFriendNote: (req: IpcInvoke['set-friend-note']['req']) => invoke('set-friend-note', req),
  notifyRendererHydrated: () => notify('renderer-hydrated', undefined),
  /**
   * Live adapter events pushed from main ('friend-event', VRX-146). Returns an
   * unsubscribe. The payload is passed through as-is — it originates in the
   * main process (trusted); the renderer applies it to the query cache.
   */
  onFriendEvent: (callback: (event: IpcEvents['friend-event']) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEvents['friend-event']
    ): void => callback(payload)
    ipcRenderer.on('friend-event', listener)
    return () => ipcRenderer.removeListener('friend-event', listener)
  },
  /** Per-platform identity changes clear renderer-owned account data (VRX-24). */
  onIdentityBoundary: (callback: (event: IpcEvents['identity-boundary']) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEvents['identity-boundary']
    ): void => callback(payload)
    ipcRenderer.on('identity-boundary', listener)
    return () => ipcRenderer.removeListener('identity-boundary', listener)
  },
  /** Native hot-instance toast click → Dashboard (VRX-85). */
  onNavigateToDashboard: (callback: () => void) => {
    // Stop buffering: from here the renderer's own listener receives pushes
    // directly (leaving the buffer attached would re-arm the flag on every
    // live push and replay a phantom navigation to a later re-subscriber).
    ipcRenderer.removeListener('navigate-to-dashboard', bufferDashboardNavigation)
    // Deliver a push that arrived before the renderer mounted its listener
    // (React installs it in a passive effect AFTER did-finish-load; a click on
    // a toast for a cold/recreated window would otherwise be lost).
    if (pendingDashboardNavigation) {
      pendingDashboardNavigation = false
      callback()
    }
    const listener = (): void => callback()
    ipcRenderer.on('navigate-to-dashboard', listener)
    return () => ipcRenderer.removeListener('navigate-to-dashboard', listener)
  },
  /** Live updater state pushes from main (VRX-113). Returns an unsubscribe. */
  onUpdaterStateChanged: (callback: (event: IpcEvents['updater:state-changed']) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEvents['updater:state-changed']
    ): void => callback(payload)
    ipcRenderer.on('updater:state-changed', listener)
    return () => ipcRenderer.removeListener('updater:state-changed', listener)
  }
}

// Preload runs before the page, so this buffer catches the main-process replay
// fired on did-finish-load; the renderer collects it on first subscription.
let pendingDashboardNavigation = false
const bufferDashboardNavigation = (): void => {
  pendingDashboardNavigation = true
}
ipcRenderer.on('navigate-to-dashboard', bufferDashboardNavigation)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('vrx', vrx)
  } catch (error) {
    // console (not electron-log) is a deliberate exception here: the sandboxed
    // preload can't load electron-log's node transport, and if the contextBridge
    // itself failed there is no working bridge to route a log over — the devtools
    // console is the only surface that still works in this bootstrap-failure case.
    console.error('[preload] contextBridge failed:', error)
  }
} else {
  // @ts-ignore (non-isolated fallback — development only)
  window.vrx = vrx
}
