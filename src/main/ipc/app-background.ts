import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { AppBackgroundStore } from '../services/appBackground'
import { isTrustedIpcSender } from './security'

export interface AppBackgroundHandlerOptions {
  store: AppBackgroundStore
  /** Show the native open dialog over the sender's window; null when cancelled. */
  pickFile: (event: IpcMainInvokeEvent) => Promise<string | null>
}

/** No renderer input on any channel: main owns the dialog, the path, and the file. */
export function registerAppBackgroundHandlers(options: AppBackgroundHandlerOptions): void {
  // One dialog at a time: a second press while it is open joins the first.
  let choosing: Promise<IpcInvoke['choose-app-background']['res']> | null = null

  ipcMain.handle('get-app-background', async (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const dataUrl = await options.store.load()
    return dataUrl === null ? null : { dataUrl }
  })

  ipcMain.handle('choose-app-background', (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (choosing) return choosing
    const run = (async (): Promise<IpcInvoke['choose-app-background']['res']> => {
      try {
        const path = await options.pickFile(event)
        if (path === null) return { ok: false, reason: 'cancelled' }
        return await options.store.importFrom(path)
      } catch {
        return { ok: false, reason: 'unreadable' }
      }
    })()
    choosing = run
    void run.finally(() => {
      if (choosing === run) choosing = null
    })
    return run
  })

  ipcMain.handle('clear-app-background', async (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    await options.store.clear()
  })
}
