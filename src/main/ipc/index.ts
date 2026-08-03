import { ipcMain, type IpcMainEvent } from 'electron'
import log from 'electron-log'
import type { IpcInvokeChannel } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { registerAccountsHandlers } from './accounts'
import { registerAppStatusHandlers } from './app-status'
import { registerAuthHandlers } from './auth'
import { registerAvatarHandlers } from './avatar'
import { registerFriendsHandlers } from './friends'
import { registerInstanceHandlers } from './instance'
import { registerLaunchHandlers } from './launch'
import { registerNotesHandlers } from './notes'
import { registerSettingsHandlers } from './settings'
import type { AuthHandlerOptions } from './auth'
import type { LocationAuthority } from '../services/locationAuthority'
import type { InstanceHandlerOptions } from './instance'
import type { AccountRegistry } from '../services/accountRegistry'
import type { AccountSession } from '../services/accountSession'
import type { SocialStore } from '../services/socialStore'
import type { AppStatusService } from '../services/appStatus'
import {
  IPC_RATE_LIMIT_BUDGETS,
  ipcRateLimitDenial,
  withRateLimit,
  type RateLimitWarn
} from './rate-limit'

interface IpcRateLimitOptions {
  clock?: () => number
  warn?: RateLimitWarn
}

export interface IpcHandlerOptions extends AuthHandlerOptions {
  accountRegistry: AccountRegistry
  accountSession: AccountSession
  locationAuthority: LocationAuthority
  socialStore: SocialStore
  appStatus: AppStatusService
  instance?: InstanceHandlerOptions
  onRendererHydrated: (event: IpcMainEvent) => void
  rateLimit?: IpcRateLimitOptions
}

export function registerIpcHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  options: IpcHandlerOptions
): void {
  const clock = options.rateLimit?.clock ?? (() => performance.now())
  const warn =
    options.rateLimit?.warn ??
    ((message: 'IPC rate limit exceeded', meta: { channel: keyof typeof IPC_RATE_LIMIT_BUDGETS }) =>
      log.warn(message, meta))
  const originalHandleDescriptor = Object.getOwnPropertyDescriptor(ipcMain, 'handle')
  const registerHandle = ipcMain.handle.bind(ipcMain)

  ipcMain.handle = (channel, handler): void => {
    if (!(channel in IPC_RATE_LIMIT_BUDGETS) || channel === 'renderer-hydrated') {
      registerHandle(channel, handler)
      return
    }
    const invokeChannel = channel as IpcInvokeChannel
    registerHandle(
      channel,
      withRateLimit(invokeChannel, IPC_RATE_LIMIT_BUDGETS[invokeChannel], handler, {
        clock,
        deny: () => ipcRateLimitDenial(invokeChannel),
        warn
      })
    )
  }

  try {
    registerFriendsHandlers(adapters, options.locationAuthority, options.appStatus)
    registerAvatarHandlers()
    registerAuthHandlers(adapters, options)
    registerAccountsHandlers(options.accountRegistry, options.accountSession)
    registerNotesHandlers({
      accountSession: options.accountSession,
      socialStore: options.socialStore
    })
    registerInstanceHandlers(adapters, options.locationAuthority, options.instance)
    registerAppStatusHandlers(options.appStatus)
    registerLaunchHandlers()
    registerSettingsHandlers()
  } finally {
    if (originalHandleDescriptor === undefined) Reflect.deleteProperty(ipcMain, 'handle')
    else Object.defineProperty(ipcMain, 'handle', originalHandleDescriptor)
  }

  ipcMain.on(
    'renderer-hydrated',
    withRateLimit(
      'renderer-hydrated',
      IPC_RATE_LIMIT_BUDGETS['renderer-hydrated'],
      options.onRendererHydrated,
      {
        clock,
        deny: () => undefined,
        warn
      }
    )
  )
}
