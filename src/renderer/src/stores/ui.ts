import { create } from 'zustand'

/**
 * Top-level app surface. Provisional set — grows as routes land; the v1 surfaces
 * are the friends list and dashboard (M2 scope), plus settings.
 */
export type ActiveTab = 'friends' | 'dashboard' | 'settings'

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
  activeTab: 'friends',
  drawerOpen: false,
  setActiveTab: (activeTab) => set({ activeTab }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen }))
}))
