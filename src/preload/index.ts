import { contextBridge, ipcRenderer } from 'electron'
import type { IpcEvents, IpcInvoke, IpcNotifications } from '@shared/ipc'

async function invoke<K extends keyof IpcInvoke>(
  channel: K,
  req: IpcInvoke[K]['req']
): Promise<IpcInvoke[K]['res']> {
  try {
    return (await ipcRenderer.invoke(channel, req)) as IpcInvoke[K]['res']
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'rate_limited' ||
        error.message === `Error invoking remote method '${channel}': Error: rate_limited`)
    ) {
      throw new Error('rate_limited', { cause: error })
    }
    throw error
  }
}

function notify<K extends keyof IpcNotifications>(channel: K, payload: IpcNotifications[K]): void {
  ipcRenderer.send(channel, payload)
}

const vrx = {
  setExploreActive: (req: IpcInvoke['set-explore-active']['req']) =>
    invoke('set-explore-active', req),
  getExplore: (req: IpcInvoke['get-explore']['req']) => invoke('get-explore', req),
  getExploreWorld: (req: IpcInvoke['get-explore-world']['req']) => invoke('get-explore-world', req),
  cancelExploreWorld: (req: IpcInvoke['cancel-explore-world']['req']) =>
    invoke('cancel-explore-world', req),
  getExploreImage: (req: IpcInvoke['get-explore-image']['req']) => invoke('get-explore-image', req),
  joinExploreRoom: (req: IpcInvoke['join-explore-room']['req']) => invoke('join-explore-room', req),
  onExploreChanged: (callback: (event: IpcEvents['explore-changed']) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEvents['explore-changed']
    ): void => callback(payload)
    ipcRenderer.on('explore-changed', listener)
    return () => ipcRenderer.removeListener('explore-changed', listener)
  },
  // World references only: main resolves them to the platform's world ID.
  setHomeWorld: (req: IpcInvoke['set-home-world']['req']) => invoke('set-home-world', req),
  getFriends: (req: IpcInvoke['get-friends']['req']) => invoke('get-friends', req),
  getAvatar: (url: string, rendition?: 'avatar' | 'picture') =>
    invoke('get-avatar', rendition === undefined ? { url } : { url, rendition }),
  getAvatarLibrary: (req: IpcInvoke['get-avatar-library']['req']) =>
    invoke('get-avatar-library', req),
  getCurrentAvatar: (req: IpcInvoke['get-current-avatar']['req']) =>
    invoke('get-current-avatar', req),
  getAvatarDetails: (req: IpcInvoke['get-avatar-details']['req']) =>
    invoke('get-avatar-details', req),
  // Avatar IDs only: main switches only to an avatar it listed for this session.
  switchAvatar: (req: IpcInvoke['switch-avatar']['req']) => invoke('switch-avatar', req),
  getProfile: (req: IpcInvoke['get-profile']['req']) => invoke('get-profile', req),
  getProfileWorlds: (req: IpcInvoke['get-profile-worlds']['req']) =>
    invoke('get-profile-worlds', req),
  getProfileGroups: (req: IpcInvoke['get-profile-groups']['req']) =>
    invoke('get-profile-groups', req),
  searchCommunity: (req: IpcInvoke['search-community']['req']) => invoke('search-community', req),
  getWorldList: (req: IpcInvoke['get-world-list']['req']) => invoke('get-world-list', req),
  getPlayersOnline: (req: IpcInvoke['get-players-online']['req']) =>
    invoke('get-players-online', req),
  getMyGroups: (req: IpcInvoke['get-my-groups']['req']) => invoke('get-my-groups', req),
  getOwnProfile: (req: IpcInvoke['get-own-profile']['req']) => invoke('get-own-profile', req),
  saveOwnProfile: (req: IpcInvoke['save-own-profile']['req']) => invoke('save-own-profile', req),
  getAccounts: () => invoke('get-accounts', undefined),
  getLinkedProfiles: () => invoke('get-linked-profiles', undefined),
  changeLinkedProfile: (req: IpcInvoke['change-linked-profile']['req']) =>
    invoke('change-linked-profile', req),
  onLinkedProfilesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('linked-profiles-changed', listener)
    return () => ipcRenderer.removeListener('linked-profiles-changed', listener)
  },
  getAuthStatus: (req: IpcInvoke['get-auth-status']['req']) => invoke('get-auth-status', req),
  login: (req: IpcInvoke['login']['req']) => invoke('login', req),
  verify2fa: (req: IpcInvoke['verify-2fa']['req']) => invoke('verify-2fa', req),
  importSession: (req: IpcInvoke['import-session']['req']) => invoke('import-session', req),
  logout: (req: IpcInvoke['logout']['req']) => invoke('logout', req),
  // Friend IDs only: the main-process LocationAuthority owns every instance identifier.
  joinInstance: (req: IpcInvoke['join-instance']['req']) => invoke('join-instance', req),
  selfInvite: (req: IpcInvoke['self-invite']['req']) => invoke('self-invite', req),
  getJoinHandoff: (req: IpcInvoke['get-join-handoff']['req']) => invoke('get-join-handoff', req),
  getAppStatus: () => invoke('get-app-status', undefined),
  getActivity: () => invoke('get-activity', undefined),
  clearActivity: () => invoke('clear-activity', undefined),
  onActivityChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('activity-changed', listener)
    return () => ipcRenderer.removeListener('activity-changed', listener)
  },
  openUrl: (req: IpcInvoke['open-url']['req']) => invoke('open-url', req),
  openLogsFolder: () => invoke('open-logs-folder', undefined),
  openBugReport: () => invoke('open-bug-report', undefined),
  testVrAlert: () => invoke('test-vr-alert', undefined),
  getAppBackground: () => invoke('get-app-background', undefined),
  chooseAppBackground: () => invoke('choose-app-background', undefined),
  clearAppBackground: () => invoke('clear-app-background', undefined),
  getInbox: () => invoke('get-inbox', undefined),
  dismissInboxItem: (req: IpcInvoke['dismiss-inbox-item']['req']) =>
    invoke('dismiss-inbox-item', req),
  clearInbox: (req: IpcInvoke['clear-inbox']['req']) => invoke('clear-inbox', req),
  onInboxChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('inbox-changed', listener)
    return () => ipcRenderer.removeListener('inbox-changed', listener)
  },
  getSettings: () => invoke('get-settings', undefined),
  saveSettings: (req: IpcInvoke['save-settings']['req']) => invoke('save-settings', req),
  getUpdaterState: () => invoke('updater:get-state', undefined),
  checkForUpdates: () => invoke('updater:check', undefined),
  downloadUpdate: () => invoke('updater:download', undefined),
  installUpdate: () => invoke('updater:install', undefined),
  getFriendNote: (req: IpcInvoke['get-friend-note']['req']) => invoke('get-friend-note', req),
  setFriendNote: (req: IpcInvoke['set-friend-note']['req']) => invoke('set-friend-note', req),
  getAlertPicks: (req: IpcInvoke['get-alert-picks']['req']) => invoke('get-alert-picks', req),
  setAlertPick: (req: IpcInvoke['set-alert-pick']['req']) => invoke('set-alert-pick', req),
  getFavoriteFriends: (req: IpcInvoke['get-favorite-friends']['req']) =>
    invoke('get-favorite-friends', req),
  setFavoriteFriend: (req: IpcInvoke['set-favorite-friend']['req']) =>
    invoke('set-favorite-friend', req),
  getFavoriteWorlds: (req: IpcInvoke['get-favorite-worlds']['req']) =>
    invoke('get-favorite-worlds', req),
  setFavoriteWorld: (req: IpcInvoke['set-favorite-world']['req']) =>
    invoke('set-favorite-world', req),
  notifyRendererHydrated: () => notify('renderer-hydrated', undefined),
  /**
   * Live adapter events pushed from main ('friend-event', VRX-146). Returns an
   * unsubscribe. The payload is passed through as-is — it originates in the
   * main process (trusted); the renderer applies it to the query cache.
   */
  onFriendEvent: (callback: (event: IpcEvents['friend-event']) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEvents['friend-event']
    ): void => callback(payload)
    ipcRenderer.on('friend-event', listener)
    return () => ipcRenderer.removeListener('friend-event', listener)
  },
  /** Per-platform identity changes clear renderer-owned account data (VRX-24). */
  onIdentityBoundary: (callback: (event: IpcEvents['identity-boundary']) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEvents['identity-boundary']
    ): void => callback(payload)
    ipcRenderer.on('identity-boundary', listener)
    return () => ipcRenderer.removeListener('identity-boundary', listener)
  },
  /** Native hot-instance toast click → Dashboard (VRX-85). */
  onNavigateToDashboard: (callback: (event: IpcEvents['navigate-to-dashboard']) => void) => {
    // Stop buffering: from here the renderer's own listener receives pushes
    // directly (leaving the buffer attached would re-arm the flag on every
    // live push and replay a phantom navigation to a later re-subscriber).
    ipcRenderer.removeListener('navigate-to-dashboard', bufferDashboardNavigation)
    // Deliver a push that arrived before the renderer mounted its listener
    // (React installs it in a passive effect AFTER did-finish-load; a click on
    // a toast for a cold/recreated window would otherwise be lost).
    if (pendingDashboardNavigation !== null) {
      const pending = pendingDashboardNavigation
      pendingDashboardNavigation = null
      callback(pending)
    }
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEvents['navigate-to-dashboard']
    ): void => callback(payload)
    ipcRenderer.on('navigate-to-dashboard', listener)
    return () => ipcRenderer.removeListener('navigate-to-dashboard', listener)
  },
  /** Live updater state pushes from main (VRX-113). Returns an unsubscribe. */
  onUpdaterStateChanged: (callback: (event: IpcEvents['updater:state-changed']) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEvents['updater:state-changed']
    ): void => callback(payload)
    ipcRenderer.on('updater:state-changed', listener)
    return () => ipcRenderer.removeListener('updater:state-changed', listener)
  }
}

// Preload runs before the page, so this buffer catches the main-process replay
// fired on did-finish-load; the renderer collects it on first subscription.
let pendingDashboardNavigation: IpcEvents['navigate-to-dashboard'] | null = null
const bufferDashboardNavigation = (
  _event: Electron.IpcRendererEvent,
  payload: IpcEvents['navigate-to-dashboard']
): void => {
  pendingDashboardNavigation = payload
}
ipcRenderer.on('navigate-to-dashboard', bufferDashboardNavigation)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('vrx', vrx)
  } catch (error) {
    // console (not electron-log) is a deliberate exception here: the sandboxed
    // preload can't load electron-log's node transport, and if the contextBridge
    // itself failed there is no working bridge to route a log over — the devtools
    // console is the only surface that still works in this bootstrap-failure case.
    console.error('[preload] contextBridge failed:', error)
  }
} else {
  // @ts-ignore (non-isolated fallback — development only)
  window.vrx = vrx
}
