import { contextBridge, ipcRenderer } from 'electron'
import type { IpcInvoke } from '@shared/ipc'

function invoke<K extends keyof IpcInvoke>(
  channel: K,
  req: IpcInvoke[K]['req']
): Promise<IpcInvoke[K]['res']> {
  return ipcRenderer.invoke(channel, req)
}

const vrx = {
  getFriends: (req: IpcInvoke['get-friends']['req']) => invoke('get-friends', req),
  getAccounts: () => invoke('get-accounts', undefined),
  getAuthStatus: (req: IpcInvoke['get-auth-status']['req']) => invoke('get-auth-status', req),
  login: (req: IpcInvoke['login']['req']) => invoke('login', req),
  verify2fa: (req: IpcInvoke['verify-2fa']['req']) => invoke('verify-2fa', req),
  joinInstance: (req: IpcInvoke['join-instance']['req']) => invoke('join-instance', req),
  selfInvite: (req: IpcInvoke['self-invite']['req']) => invoke('self-invite', req),
  getAppStatus: () => invoke('get-app-status', undefined),
  openUrl: (req: IpcInvoke['open-url']['req']) => invoke('open-url', req)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('vrx', vrx)
  } catch (error) {
    console.error('[preload] contextBridge failed:', error)
  }
} else {
  // @ts-ignore (non-isolated fallback — development only)
  window.vrx = vrx
}
