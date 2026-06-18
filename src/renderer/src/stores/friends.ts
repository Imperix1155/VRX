import { create } from 'zustand'
import type { Friend, Platform } from '@shared/types'

/** Platform filter for the friends list; 'all' shows both platforms. */
export type PlatformFilter = Platform | 'all'

interface FriendsState {
  friends: Friend[]
  loading: boolean
  error: string | null
  // ── client-side view state (VRX-21); filtering itself happens in the view ──
  search: string
  platformFilter: PlatformFilter
  selectedFriendId: string | null
  fetchFriends: (platform: Platform) => Promise<void>
  setSearch: (search: string) => void
  setPlatformFilter: (filter: PlatformFilter) => void
  setSelectedFriendId: (id: string | null) => void
}

export const useFriendsStore = create<FriendsState>((set) => ({
  friends: [],
  loading: false,
  error: null,
  search: '',
  platformFilter: 'all',
  selectedFriendId: null,
  setSearch: (search) => set({ search }),
  setPlatformFilter: (platformFilter) => set({ platformFilter }),
  setSelectedFriendId: (selectedFriendId) => set({ selectedFriendId }),
  fetchFriends: async (platform) => {
    if (!window.vrx) {
      set({ friends: [], loading: false, error: 'bridge_unavailable' })
      return
    }
    set({ loading: true, error: null })
    try {
      const friends = await window.vrx.getFriends({ platform })
      set({ friends, loading: false })
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  }
}))
