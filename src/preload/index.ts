import { contextBridge, ipcRenderer } from 'electron'
import type { IpcEvents, IpcInvoke } from '@shared/ipc'

function invoke<K extends keyof IpcInvoke>(
  channel: K,
  req: IpcInvoke[K]['req']
): Promise<IpcInvoke[K]['res']> {
  return ipcRenderer.invoke(channel, req)
}

const vrx = {
  getFriends: (req: IpcInvoke['get-friends']['req']) => invoke('get-friends', req),
  getAvatar: (url: string) => invoke('get-avatar', { url }),
  getAccounts: () => invoke('get-accounts', undefined),
  getAuthStatus: (req: IpcInvoke['get-auth-status']['req']) => invoke('get-auth-status', req),
  login: (req: IpcInvoke['login']['req']) => invoke('login', req),
  verify2fa: (req: IpcInvoke['verify-2fa']['req']) => invoke('verify-2fa', req),
  logout: (req: IpcInvoke['logout']['req']) => invoke('logout', req),
  joinInstance: (req: IpcInvoke['join-instance']['req']) => invoke('join-instance', req),
  selfInvite: (req: IpcInvoke['self-invite']['req']) => invoke('self-invite', req),
  getAppStatus: () => invoke('get-app-status', undefined),
  openUrl: (req: IpcInvoke['open-url']['req']) => invoke('open-url', req),
  getSettings: () => invoke('get-settings', undefined),
  saveSettings: (req: IpcInvoke['save-settings']['req']) => invoke('save-settings', req),
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
  /** Native hot-instance toast click → Dashboard (VRX-85). */
  onNavigateToDashboard: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('navigate-to-dashboard', listener)
    return () => ipcRenderer.removeListener('navigate-to-dashboard', listener)
  }
}

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
