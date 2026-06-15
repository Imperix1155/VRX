import type { Platform } from '@shared/types'
import type { IPlatformAdapter } from '../services/adapters/IPlatformAdapter'
import { registerFriendsHandlers } from './friends'

export function registerIpcHandlers(adapters: Map<Platform, IPlatformAdapter>): void {
  registerFriendsHandlers(adapters)
}
