import { create } from 'zustand'

/**
 * Top-level app surface. Full §8 nav set (VRX-168).
 * `activity`, `instances`, `groups` are stubs in v1; `friends` mounts FriendsList.
 */
export type ActiveTab = 'dashboard' | 'activity' | 'friends' | 'instances' | 'groups' | 'settings'

/**
 * Ephemeral UI view state (VRX-21). Holds only transient layout state — NOT
 * anything persisted. `density` is a persisted user setting, so it lives in the
 * settings store, not here.
 */
interface UiState {
  activeTab: ActiveTab
  drawerOpen: boolean
  setActiveTab: (tab: ActiveTab) => void
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
}

export const useUiStore = create<UiState>((set) => ({
  // App opens on the Dashboard (owner: the Dashboard is the intended landing view).
  activeTab: 'dashboard',
  drawerOpen: false,
  setActiveTab: (activeTab) => set({ activeTab }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen }))
}))
