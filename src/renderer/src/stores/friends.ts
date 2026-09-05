import { create } from 'zustand'
import type { Platform } from '@shared/types'

/** Platform filter for the friends list; 'all' shows both platforms. */
export type PlatformFilter = Platform | 'all'

/**
 * Friends VIEW state (VRX-21/22). Server-side friends data lives in the TanStack
 * Query cache (`queries/friends.ts`), NOT here — this store holds only the
 * client-side view state the list UI composes with the query result. No store
 * imports another.
 */
interface FriendsState {
  search: string
  platformFilter: PlatformFilter
  setSearch: (search: string) => void
  setPlatformFilter: (filter: PlatformFilter) => void
}

export const useFriendsStore = create<FriendsState>((set) => ({
  search: '',
  platformFilter: 'all',
  setSearch: (search) => set({ search }),
  setPlatformFilter: (platformFilter) => set({ platformFilter })
}))
