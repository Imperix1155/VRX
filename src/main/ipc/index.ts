import { ipcMain, type IpcMainEvent } from 'electron'
import log from '../logger'
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
import { registerLinksHandlers, type LinksHandlerOptions } from './links'
import { registerSettingsHandlers } from './settings'
import { registerUpdaterHandlers } from './updater'
import { isTrustedIpcSender } from './security'
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
  links: Omit<LinksHandlerOptions, 'accountSession'>
  appStatus: AppStatusService
  instance: InstanceHandlerOptions
  onRendererHydrated: (event: IpcMainEvent) => void
  rateLimit?: IpcRateLimitOptions
}

export function registerIpcHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  options: IpcHandlerOptions
): void {
  // electron-store's constructor unconditionally installs this renderer-only
  // bootstrap listener from node_modules/electron-store/index.js. VRX never
  // initializes electron-store in the renderer, so remove the unreachable
  // third-party channel before exposing the enumerated VRX IPC surface.
  ipcMain.removeAllListeners('electron-store-get-data')

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
    const domainHandler = handler as (...args: unknown[]) => unknown
    const limitedHandler = withRateLimit(
      invokeChannel,
      IPC_RATE_LIMIT_BUDGETS[invokeChannel],
      domainHandler,
      {
        clock,
        deny: () => ipcRateLimitDenial(invokeChannel),
        warn
      }
    )
    registerHandle(channel, (event, ...args): unknown => {
      if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
      const domainArgs: unknown[] = args
      return limitedHandler(event, ...domainArgs)
    })
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
    registerLinksHandlers({
      ...options.links,
      accountSession: options.accountSession,
      locationAuthority: options.locationAuthority
    })
    registerInstanceHandlers(adapters, options.locationAuthority, options.instance)
    registerAppStatusHandlers(options.appStatus)
    registerLaunchHandlers()
    registerSettingsHandlers()
    registerUpdaterHandlers()
  } finally {
    if (originalHandleDescriptor === undefined) Reflect.deleteProperty(ipcMain, 'handle')
    else Object.defineProperty(ipcMain, 'handle', originalHandleDescriptor)
  }

  const limitedRendererHydrated = withRateLimit(
    'renderer-hydrated',
    IPC_RATE_LIMIT_BUDGETS['renderer-hydrated'],
    options.onRendererHydrated,
    {
      clock,
      deny: () => undefined,
      warn
    }
  )
  ipcMain.on('renderer-hydrated', (event) => {
    if (!isTrustedIpcSender(event.senderFrame)) return
    limitedRendererHydrated(event)
  })
}
