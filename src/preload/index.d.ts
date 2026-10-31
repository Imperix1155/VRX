import type { IpcEvents, IpcInvoke } from '@shared/ipc'

type VrxBridge = {
  setExploreActive: (
    req: IpcInvoke['set-explore-active']['req']
  ) => Promise<IpcInvoke['set-explore-active']['res']>
  getExplore: (req: IpcInvoke['get-explore']['req']) => Promise<IpcInvoke['get-explore']['res']>
  getExploreWorld: (
    req: IpcInvoke['get-explore-world']['req']
  ) => Promise<IpcInvoke['get-explore-world']['res']>
  cancelExploreWorld: (
    req: IpcInvoke['cancel-explore-world']['req']
  ) => Promise<IpcInvoke['cancel-explore-world']['res']>
  getExploreImage: (
    req: IpcInvoke['get-explore-image']['req']
  ) => Promise<IpcInvoke['get-explore-image']['res']>
  joinExploreRoom: (
    req: IpcInvoke['join-explore-room']['req']
  ) => Promise<IpcInvoke['join-explore-room']['res']>
  onExploreChanged: (callback: (event: IpcEvents['explore-changed']) => void) => () => void
  getLinkedProfiles: () => Promise<IpcInvoke['get-linked-profiles']['res']>
  changeLinkedProfile: (
    req: IpcInvoke['change-linked-profile']['req']
  ) => Promise<IpcInvoke['change-linked-profile']['res']>
  onLinkedProfilesChanged: (callback: () => void) => () => void
  getFriends: (req: IpcInvoke['get-friends']['req']) => Promise<IpcInvoke['get-friends']['res']>
  getAvatar: (url: string, rendition?: 'avatar') => Promise<IpcInvoke['get-avatar']['res']>
  getAvatarLibrary: (
    req: IpcInvoke['get-avatar-library']['req']
  ) => Promise<IpcInvoke['get-avatar-library']['res']>
  getCurrentAvatar: (
    req: IpcInvoke['get-current-avatar']['req']
  ) => Promise<IpcInvoke['get-current-avatar']['res']>
  getAvatarDetails: (
    req: IpcInvoke['get-avatar-details']['req']
  ) => Promise<IpcInvoke['get-avatar-details']['res']>
  /** Avatar IDs only; main switches only to an avatar it listed. */
  switchAvatar: (
    req: IpcInvoke['switch-avatar']['req']
  ) => Promise<IpcInvoke['switch-avatar']['res']>
  getProfile: (req: IpcInvoke['get-profile']['req']) => Promise<IpcInvoke['get-profile']['res']>
  getProfileWorlds: (
    req: IpcInvoke['get-profile-worlds']['req']
  ) => Promise<IpcInvoke['get-profile-worlds']['res']>
  getProfileGroups: (
    req: IpcInvoke['get-profile-groups']['req']
  ) => Promise<IpcInvoke['get-profile-groups']['res']>
  searchCommunity: (
    req: IpcInvoke['search-community']['req']
  ) => Promise<IpcInvoke['search-community']['res']>
  getWorldList: (
    req: IpcInvoke['get-world-list']['req']
  ) => Promise<IpcInvoke['get-world-list']['res']>
  getPlayersOnline: (
    req: IpcInvoke['get-players-online']['req']
  ) => Promise<IpcInvoke['get-players-online']['res']>
  getMyGroups: (
    req: IpcInvoke['get-my-groups']['req']
  ) => Promise<IpcInvoke['get-my-groups']['res']>
  getAccounts: () => Promise<IpcInvoke['get-accounts']['res']>
  getAuthStatus: (
    req: IpcInvoke['get-auth-status']['req']
  ) => Promise<IpcInvoke['get-auth-status']['res']>
  login: (req: IpcInvoke['login']['req']) => Promise<IpcInvoke['login']['res']>
  verify2fa: (req: IpcInvoke['verify-2fa']['req']) => Promise<IpcInvoke['verify-2fa']['res']>
  importSession: (
    req: IpcInvoke['import-session']['req']
  ) => Promise<IpcInvoke['import-session']['res']>
  logout: (req: IpcInvoke['logout']['req']) => Promise<IpcInvoke['logout']['res']>
  /** Friend IDs only; instance identifiers never cross from the renderer. */
  joinInstance: (
    req: IpcInvoke['join-instance']['req']
  ) => Promise<IpcInvoke['join-instance']['res']>
  selfInvite: (req: IpcInvoke['self-invite']['req']) => Promise<IpcInvoke['self-invite']['res']>
  /** What Join would do now: start the game, or use the copy that is already open. */
  getJoinHandoff: (
    req: IpcInvoke['get-join-handoff']['req']
  ) => Promise<IpcInvoke['get-join-handoff']['res']>
  getAppStatus: () => Promise<IpcInvoke['get-app-status']['res']>
  /** The in-memory activity list; reading it makes no platform request. */
  getActivity: () => Promise<IpcInvoke['get-activity']['res']>
  clearActivity: () => Promise<IpcInvoke['clear-activity']['res']>
  /** The activity list changed (coalesced). Returns an unsubscribe. */
  onActivityChanged: (callback: () => void) => () => void
  openUrl: (req: IpcInvoke['open-url']['req']) => Promise<IpcInvoke['open-url']['res']>
  openLogsFolder: () => Promise<IpcInvoke['open-logs-folder']['res']>
  openBugReport: () => Promise<IpcInvoke['open-bug-report']['res']>
  /** One test alert to XSOverlay; main sends it to this computer only. */
  testVrAlert: () => Promise<IpcInvoke['test-vr-alert']['res']>
  /** The user's background picture; main owns the file and the picking dialog. */
  getAppBackground: () => Promise<IpcInvoke['get-app-background']['res']>
  chooseAppBackground: () => Promise<IpcInvoke['choose-app-background']['res']>
  clearAppBackground: () => Promise<IpcInvoke['clear-app-background']['res']>
  /** View-only inbox: rows the sockets delivered while VRX was open. */
  getInbox: () => Promise<IpcInvoke['get-inbox']['res']>
  /** Hide a row in VRX only; nothing reaches the platform. */
  dismissInboxItem: (
    req: IpcInvoke['dismiss-inbox-item']['req']
  ) => Promise<IpcInvoke['dismiss-inbox-item']['res']>
  clearInbox: (req: IpcInvoke['clear-inbox']['req']) => Promise<IpcInvoke['clear-inbox']['res']>
  /** The inbox changed; read it again. Returns an unsubscribe. */
  onInboxChanged: (callback: () => void) => () => void
  getSettings: () => Promise<IpcInvoke['get-settings']['res']>
  saveSettings: (
    req: IpcInvoke['save-settings']['req']
  ) => Promise<IpcInvoke['save-settings']['res']>
  getUpdaterState: () => Promise<IpcInvoke['updater:get-state']['res']>
  checkForUpdates: () => Promise<IpcInvoke['updater:check']['res']>
  downloadUpdate: () => Promise<IpcInvoke['updater:download']['res']>
  installUpdate: () => Promise<IpcInvoke['updater:install']['res']>
  getFriendNote: (
    req: IpcInvoke['get-friend-note']['req']
  ) => Promise<IpcInvoke['get-friend-note']['res']>
  setFriendNote: (
    req: IpcInvoke['set-friend-note']['req']
  ) => Promise<IpcInvoke['set-friend-note']['res']>
  /** Local friend picks for alerts (per signed-in account). */
  getAlertPicks: (
    req: IpcInvoke['get-alert-picks']['req']
  ) => Promise<IpcInvoke['get-alert-picks']['res']>
  setAlertPick: (
    req: IpcInvoke['set-alert-pick']['req']
  ) => Promise<IpcInvoke['set-alert-pick']['res']>
  /** The settings-backed document attributes are ready for the first reveal. */
  notifyRendererHydrated: () => void
  /** Live adapter events pushed from main (VRX-146). Returns an unsubscribe. */
  onFriendEvent: (callback: (event: IpcEvents['friend-event']) => void) => () => void
  /** Per-platform identity changes clear renderer-owned account data (VRX-24). */
  onIdentityBoundary: (callback: (event: IpcEvents['identity-boundary']) => void) => () => void
  /** Native hot-instance toast click → Dashboard (VRX-85). */
  onNavigateToDashboard: (
    callback: (event: IpcEvents['navigate-to-dashboard']) => void
  ) => () => void
  /** Live updater state pushes from main (VRX-113). Returns an unsubscribe. */
  onUpdaterStateChanged: (
    callback: (event: IpcEvents['updater:state-changed']) => void
  ) => () => void
}

declare global {
  interface Window {
    vrx?: VrxBridge
  }
}
