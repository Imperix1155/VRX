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
/** Settings category mini-pages (VRX-186). Extend as sections are added —
 *  the array order is the nav's display order (THEMES pattern). */
export const SETTINGS_CATEGORIES = ['appearance', 'dashboard'] as const
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

interface UiState {
  activeTab: ActiveTab
  drawerOpen: boolean
  /** Session-only (deliberately NOT a persisted setting): survives view
   *  switches within a session so a user hopping Settings↔Dashboard lands
   *  back on the category they were adjusting (VRX-186). */
  settingsCategory: SettingsCategory
  setActiveTab: (tab: ActiveTab) => void
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  setSettingsCategory: (category: SettingsCategory) => void
}

export const useUiStore = create<UiState>((set) => ({
  // App opens on the Dashboard (owner: the Dashboard is the intended landing view).
  activeTab: 'dashboard',
  drawerOpen: false,
  settingsCategory: 'appearance',
  setActiveTab: (activeTab) => set({ activeTab }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
  setSettingsCategory: (settingsCategory) => set({ settingsCategory })
}))
