import type { IpcInvoke } from '@shared/ipc'

type VrxBridge = {
  getFriends: (req: IpcInvoke['get-friends']['req']) => Promise<IpcInvoke['get-friends']['res']>
  getAccounts: () => Promise<IpcInvoke['get-accounts']['res']>
  getAuthStatus: (
    req: IpcInvoke['get-auth-status']['req']
  ) => Promise<IpcInvoke['get-auth-status']['res']>
  login: (req: IpcInvoke['login']['req']) => Promise<IpcInvoke['login']['res']>
  verify2fa: (req: IpcInvoke['verify-2fa']['req']) => Promise<IpcInvoke['verify-2fa']['res']>
  joinInstance: (
    req: IpcInvoke['join-instance']['req']
  ) => Promise<IpcInvoke['join-instance']['res']>
  selfInvite: (req: IpcInvoke['self-invite']['req']) => Promise<IpcInvoke['self-invite']['res']>
  getAppStatus: () => Promise<IpcInvoke['get-app-status']['res']>
  openUrl: (req: IpcInvoke['open-url']['req']) => Promise<IpcInvoke['open-url']['res']>
}

declare global {
  interface Window {
    vrx: VrxBridge
  }
}
