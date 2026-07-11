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

export function registerIpcHandlers(
  adapters: Map<Platform, IPlatformAdapter>,
  options: AuthHandlerOptions = {}
): void {
  registerFriendsHandlers(adapters)
  registerAvatarHandlers()
  registerAuthHandlers(adapters, options)
  registerAccountsHandlers()
  registerInstanceHandlers(adapters)
  registerAppStatusHandlers()
  registerLaunchHandlers()
  registerSettingsHandlers()
}
