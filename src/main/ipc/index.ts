import type { Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { registerAccountsHandlers } from './accounts'
import { registerAppStatusHandlers } from './app-status'
import { registerAuthHandlers } from './auth'
import { registerFriendsHandlers } from './friends'
import { registerInstanceHandlers } from './instance'
import { registerLaunchHandlers } from './launch'

export function registerIpcHandlers(adapters: Map<Platform, IPlatformAdapter>): void {
  registerFriendsHandlers(adapters)
  registerAuthHandlers(adapters)
  registerAccountsHandlers()
  registerInstanceHandlers(adapters)
  registerAppStatusHandlers()
  registerLaunchHandlers()
}
