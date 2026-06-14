import { create } from 'zustand'
import type { Friend, Platform } from '@shared/types'

interface FriendsState {
  friends: Friend[]
  loading: boolean
  error: string | null
  fetchFriends: (platform: Platform) => Promise<void>
}

export const useFriendsStore = create<FriendsState>((set) => ({
  friends: [],
  loading: false,
  error: null,
  fetchFriends: async (platform) => {
    if (!window.vrx) {
      set({ loading: false })
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
