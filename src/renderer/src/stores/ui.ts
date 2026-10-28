import { create } from 'zustand'
import type { Platform } from '@shared/types'

/**
 * Implemented top-level app views. Groups is deferred (VRX-281).
 * `hot` is the Hot Instances page (owner, 2026-10-18); `activity` lists
 * friends coming online, joining worlds, and going offline (owner, 2026-10-27);
 * `inbox` the view-only invites and requests page (owner, 2026-10-27).
 * `avatars` lists the user's own avatars and switches between them (owner,
 * 2026-10-27). Session-only state, so retired destinations need no
 * persisted-state migration.
 */
export type ActiveTab =
  'dashboard' | 'hot' | 'friends' | 'activity' | 'inbox' | 'explore' | 'avatars' | 'settings'

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
  /** Per platform, the newest inbox arrival the user has had on screen (main's
   *  wall-clock ms). Later arrivals count as new on the sidebar. Session-only. */
  inboxSeenAt: Record<Platform, number>
  markInboxSeen: (platform: Platform, receivedAt: number) => void
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
  inboxSeenAt: { vrchat: 0, chilloutvr: 0 },
  markInboxSeen: (platform, receivedAt) =>
    set((state) =>
      receivedAt > state.inboxSeenAt[platform]
        ? { inboxSeenAt: { ...state.inboxSeenAt, [platform]: receivedAt } }
        : state
    ),
  setActiveTab: (activeTab) => set({ activeTab, hotOpenedFromAlert: false }),
  openHotFromAlert: () => set({ activeTab: 'hot', hotOpenedFromAlert: true }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
  setSettingsCategory: (settingsCategory) => set({ settingsCategory })
}))
