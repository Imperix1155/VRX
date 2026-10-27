import { create } from 'zustand'

/**
 * Implemented top-level app views. Groups is deferred (VRX-281).
 * `hot` is the Hot Instances page (owner, 2026-10-18); `activity` lists
 * friends coming online, joining worlds, and going offline (owner, 2026-10-27).
 * Session-only state, so retired destinations need no persisted-state migration.
 */
export type ActiveTab = 'dashboard' | 'hot' | 'friends' | 'activity' | 'explore' | 'settings'

/**
 * Ephemeral UI view state (VRX-21). Holds only transient layout state — NOT
 * anything persisted. `density` is a persisted user setting, so it lives in the
 * settings store, not here.
 */
/** Settings category mini-pages (VRX-186). Extend as sections are added —
 *  the array order is the nav's display order (THEMES pattern). */
export const SETTINGS_CATEGORIES = [
  'appearance',
  'dashboard',
  'behavior',
  'notifications',
  'accounts',
  'about'
] as const
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

interface UiState {
  activeTab: ActiveTab
  drawerOpen: boolean
  /** Session-only (deliberately NOT a persisted setting): survives view
   *  switches within a session so a user hopping Settings↔Dashboard lands
   *  back on the category they were adjusting (VRX-186). */
  settingsCategory: SettingsCategory
  /** The Hot Instances page was opened by a hot-instance alert click. The
   *  alert stays on when the page is hidden from the sidebar, so it may show
   *  the page until the user goes elsewhere. */
  hotOpenedFromAlert: boolean
  setActiveTab: (tab: ActiveTab) => void
  openHotFromAlert: () => void
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  setSettingsCategory: (category: SettingsCategory) => void
}

export const useUiStore = create<UiState>((set) => ({
  // App opens on the Dashboard (owner: the Dashboard is the intended landing view).
  activeTab: 'dashboard',
  drawerOpen: false,
  settingsCategory: 'appearance',
  hotOpenedFromAlert: false,
  setActiveTab: (activeTab) => set({ activeTab, hotOpenedFromAlert: false }),
  openHotFromAlert: () => set({ activeTab: 'hot', hotOpenedFromAlert: true }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
  setSettingsCategory: (settingsCategory) => set({ settingsCategory })
}))
