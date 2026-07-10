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

export function registerIpcHandlers(adapters: Map<Platform, IPlatformAdapter>): void {
  registerFriendsHandlers(adapters)
  registerAvatarHandlers()
  registerAuthHandlers(adapters)
  registerAccountsHandlers()
  registerInstanceHandlers(adapters)
  registerAppStatusHandlers()
  registerLaunchHandlers()
  registerSettingsHandlers()
}
