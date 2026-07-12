import type { Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { registerAccountsHandlers } from './accounts'
import { registerAppStatusHandlers } from './app-status'
import { registerAuthHandlers } from './auth'
import { registerAvatarHandlers } from './avatar'
import { registerFriendsHandlers } from './friends'
import { registerInstanceHandlers } from './instance'
import { registerLaunchHandlers } from './launch'
import { registerSettingsHandlers } from './settings'
import type { AuthHandlerOptions } from './auth'
import type { LocationAuthority } from '../services/locationAuthority'
import type { InstanceHandlerOptions } from './instance'
import type { AccountRegistry } from '../services/accountRegistry'
import type { AccountSession } from '../services/accountSession'

export interface IpcHandlerOptions extends AuthHandlerOptions {
  accountRegistry: AccountRegistry
  accountSession: AccountSession
  locationAuthority: LocationAuthority
  instance?: InstanceHandlerOptions
}

export function registerIpcHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  options: IpcHandlerOptions
): void {
  registerFriendsHandlers(adapters, options.locationAuthority)
  registerAvatarHandlers()
  registerAuthHandlers(adapters, options)
  registerAccountsHandlers(options.accountRegistry, options.accountSession)
  registerInstanceHandlers(adapters, options.locationAuthority, options.instance)
  registerAppStatusHandlers()
  registerLaunchHandlers()
  registerSettingsHandlers()
}
