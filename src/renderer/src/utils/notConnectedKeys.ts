import type { Platform } from '@shared/types'

/**
 * Quoted literals keep the parity scanner aware of this dynamic platform key
 * families. Each surface keeps its own namespace even when the copy is equal.
 */
export const NOT_CONNECTED_KEY: Record<'friends' | 'dashboard', Record<Platform, string>> = {
  friends: {
    vrchat: 'friends.notConnected.vrchat',
    chilloutvr: 'friends.notConnected.chilloutvr'
  },
  dashboard: {
    vrchat: 'dashboard.notConnected.vrchat',
    chilloutvr: 'dashboard.notConnected.chilloutvr'
  }
}
