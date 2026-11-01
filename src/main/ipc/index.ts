import { ipcMain, type IpcMainEvent } from 'electron'
import log from '../logger'
import type { IpcInvokeChannel } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import type { Friend, Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { registerAccountsHandlers } from './accounts'
import { registerActivityHandlers } from './activity'
import { registerAppStatusHandlers } from './app-status'
import { registerAuthHandlers } from './auth'
import { registerAvatarHandlers } from './avatar'
import { registerAppBackgroundHandlers, type AppBackgroundHandlerOptions } from './app-background'
import { registerFriendsHandlers } from './friends'
import { registerInboxHandlers } from './inbox'
import type { InboxService } from '../services/inbox'
import { registerInstanceHandlers } from './instance'
import { registerExploreHandlers, registerHomeWorldHandler } from './explore'
import { registerAvatarLibraryHandlers, registerCurrentAvatarHandler } from './avatar-library'
import { registerCommunityHandlers } from './community'
import type { CommunityService } from '../services/communityService'
import { registerSocialHandlers } from './social'
import type { SocialActionService } from '../services/socialActionService'
import type { AvatarLibraryService } from '../services/avatarLibraryService'
import type { CurrentAvatarService } from '../services/currentAvatarService'
import type { ExploreService } from '../services/exploreService'
import type { HomeWorldService } from '../services/homeWorldService'
import { registerLaunchHandlers } from './launch'
import { registerNotesHandlers } from './notes'
import { registerAlertPicksHandlers } from './alert-picks'
import type { FriendAlertPicks } from '../services/friendAlertPicks'
import { registerLinksHandlers, type LinksHandlerOptions } from './links'
import { registerSettingsHandlers } from './settings'
import { registerUpdaterHandlers } from './updater'
import { registerVrAlertHandlers } from './vr-alerts'
import type { VrOverlayAlerts } from '../vrOverlayAlerts'
import { isTrustedIpcSender } from './security'
import type { AuthHandlerOptions } from './auth'
import type { LocationAuthority } from '../services/locationAuthority'
import type { InstanceHandlerOptions } from './instance'
import type { AccountRegistry } from '../services/accountRegistry'
import type { AccountSession } from '../services/accountSession'
import type { SocialStore } from '../services/socialStore'
import type { AppStatusService } from '../services/appStatus'
import type { ActivityFeed } from '../services/activityFeed'
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
  alertPicks: FriendAlertPicks
  links: Omit<LinksHandlerOptions, 'accountSession'>
  appStatus: AppStatusService
  activity: ActivityFeed
  instance: Omit<InstanceHandlerOptions, 'accountSession'>
  explore: ExploreService
  homeWorld: HomeWorldService
  avatarLibrary: AvatarLibraryService
  currentAvatar: CurrentAvatarService
  community: CommunityService
  social: SocialActionService
  appBackground: AppBackgroundHandlerOptions
  inbox: InboxService
  vrOverlayAlerts: Pick<VrOverlayAlerts, 'test'>
  onRendererHydrated: (event: IpcMainEvent) => void
  /** Each roster read, after the location authority is seeded. */
  onFriendRoster?: (platform: Platform, friends: Friend[]) => void
  /** After each settings save attempt, with the in-memory settings. */
  onSettingsApplied?: (settings: Settings) => void
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
    registerFriendsHandlers(
      adapters,
      options.locationAuthority,
      options.appStatus,
      options.onFriendRoster
    )
    registerAvatarHandlers()
    registerAuthHandlers(adapters, options)
    registerAccountsHandlers(options.accountRegistry, options.accountSession)
    registerNotesHandlers({
      accountSession: options.accountSession,
      socialStore: options.socialStore
    })
    registerAlertPicksHandlers(options.alertPicks)
    registerLinksHandlers({
      ...options.links,
      accountSession: options.accountSession,
      locationAuthority: options.locationAuthority
    })
    registerInstanceHandlers(adapters, options.locationAuthority, {
      ...options.instance,
      accountSession: options.accountSession
    })
    registerExploreHandlers(options.explore)
    registerHomeWorldHandler(options.homeWorld)
    registerAvatarLibraryHandlers(options.avatarLibrary)
    registerCurrentAvatarHandler(options.currentAvatar)
    registerCommunityHandlers(options.community)
    registerSocialHandlers(options.social)
    registerAppStatusHandlers(options.appStatus)
    registerActivityHandlers(options.activity)
    registerLaunchHandlers()
    registerSettingsHandlers(options.onSettingsApplied)
    registerAppBackgroundHandlers(options.appBackground)
    registerInboxHandlers(options.inbox)
    registerVrAlertHandlers(options.vrOverlayAlerts)
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
