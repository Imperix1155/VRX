import { create } from 'zustand'
import type { ProfileTarget } from '../utils/projectLinkedFriends'

/** Navigation identity only. Presence and notes are resolved by their owners. */
export const useProfileSelection = create<{
  target: ProfileTarget | null
  select: (target: ProfileTarget | null) => void
}>((set) => ({ target: null, select: (target) => set({ target }) }))
