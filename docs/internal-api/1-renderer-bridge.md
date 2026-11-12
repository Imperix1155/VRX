# 1. Renderer bridge: `window.vrx`

Part of the [internal API catalog](../INTERNAL-API.md). The code is the source of truth: read the file a row names before relying on it.

The sandboxed renderer reaches the main process only through `window.vrx`. [`src/preload/index.ts`](../../src/preload/index.ts) builds the object and exposes it with `contextBridge`. [`src/preload/index.d.ts`](../../src/preload/index.d.ts) types it as `VrxBridge`. Every invoke method is a typed projection of one `IpcInvoke` channel, and section 2 names the method for each channel. Every `on…` method subscribes to one push channel and returns an unsubscribe function.

Rule: the global is declared optional (`vrx?: VrxBridge`) because unit tests, Preview and the design guide run without the preload. Every caller must handle a missing bridge or method. The bridge forwards requests and push payloads unchanged. It adds no authority or policy; its only transformation is the rate-limit error below.

| Symbol | File | Purpose |
| --- | --- | --- |
| `VrxBridge` | [`index.d.ts`](../../src/preload/index.d.ts) | The bridge type: 68 invoke methods (both `getAvatar` and `getKeptAvatar` call `get-avatar`), one notify method and eight subscriptions, all derived from `@shared/ipc`. The design guide's fixture bridge implements the same type with synthetic data (section 8). |
| `window.vrx` | [`index.ts`](../../src/preload/index.ts) | Exposed with `contextBridge.exposeInMainWorld` when context isolation is on. If exposure throws, preload writes to the devtools console, a documented exception to the electron-log rule. A non-isolated window is dev-only. |
| `rate_limited` errors | [`index.ts`](../../src/preload/index.ts) | The private `invoke` wrapper turns Electron's `Error invoking remote method '<channel>': Error: rate_limited` into `Error('rate_limited')`. Other rejections pass through. The renderer query client never retries this error. |
| `notifyRendererHydrated()` | [`index.ts`](../../src/preload/index.ts) | Sends `renderer-hydrated` once settings-backed document attributes are applied. Main shows the window when this and `ready-to-show` have both arrived, or 3 s after `ready-to-show`. |
| `onNavigateToDashboard(cb)` | [`index.ts`](../../src/preload/index.ts) | Preload buffers one `navigate-to-dashboard` push that arrives before the renderer subscribes, replays it on the first subscription, then delivers later pushes directly. |

Reuse the existing renderer owner before adding a direct bridge call:

| Bridge methods | Renderer owner |
| --- | --- |
| `getFriends`, `onFriendEvent`, `onIdentityBoundary` | [`queries/friends.ts`](../../src/renderer/src/queries/friends.ts) and [`hooks/useLiveFriendEvents.ts`](../../src/renderer/src/hooks/useLiveFriendEvents.ts) (mounted once in `App`). Dialogs and hooks also subscribe to fence their own state. |
| `getAvatar`, `getKeptAvatar` | [`hooks/useAvatar.ts`](../../src/renderer/src/hooks/useAvatar.ts) |
| `getAuthStatus`, `login`, `verify2fa`, `importSession`, `logout` | [`queries/auth.ts`](../../src/renderer/src/queries/auth.ts), [`hooks/useAuthFlow.ts`](../../src/renderer/src/hooks/useAuthFlow.ts), and `logout` in [`AccountCard.tsx`](../../src/renderer/src/components/AccountCard.tsx) |
| `getAccounts` | No renderer caller. |
| `getFriendNote`, `setFriendNote` | [`hooks/useFriendNote.ts`](../../src/renderer/src/hooks/useFriendNote.ts) |
| `getAlertPicks`, `setAlertPick` | [`queries/alertPicks.ts`](../../src/renderer/src/queries/alertPicks.ts) |
| `getLinkedProfiles`, `changeLinkedProfile`, `onLinkedProfilesChanged` | [`queries/linkedProfiles.ts`](../../src/renderer/src/queries/linkedProfiles.ts) |
| `getActivity`, `clearActivity`, `onActivityChanged` | [`queries/activity.ts`](../../src/renderer/src/queries/activity.ts) |
| `joinInstance`, `joinExploreRoom`, `joinInvite` | [`hooks/useJoinInstance.ts`](../../src/renderer/src/hooks/useJoinInstance.ts) |
| `selfInvite` | No renderer caller. |
| `getJoinHandoff` | [`hooks/useJoinHandoff.ts`](../../src/renderer/src/hooks/useJoinHandoff.ts), once per join dialog open |
| `setExploreActive`, `getExplore`, `getExploreImage`, `getExploreWorld`, `cancelExploreWorld`, `onExploreChanged` | [`hooks/useExploreCoordinator.ts`](../../src/renderer/src/hooks/useExploreCoordinator.ts), [`queries/explore.ts`](../../src/renderer/src/queries/explore.ts), [`hooks/useExploreWorldSelection.ts`](../../src/renderer/src/hooks/useExploreWorldSelection.ts) |
| `getAppStatus` | [`queries/appStatus.ts`](../../src/renderer/src/queries/appStatus.ts) (`useConnectionHealth`, read by `TopBar`), every 7.5 s while the window shows; `useLiveFriendEvents` writes pushed `connection` events into it in between. It reads main's local snapshot and makes no platform request. |
| `getLoginItem` | [`queries/loginItem.ts`](../../src/renderer/src/queries/loginItem.ts) (`useLoginItemProblem`, read by Settings → About once the choice is saved) |
| `getSettings`, `saveSettings` | [`hooks/useSettingsPersistence.ts`](../../src/renderer/src/hooks/useSettingsPersistence.ts) |
| `getUpdaterState`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, `onUpdaterStateChanged` | [`hooks/useUpdater.ts`](../../src/renderer/src/hooks/useUpdater.ts) |
| `openUrl`, `openLogsFolder` | [`SettingsView.tsx`](../../src/renderer/src/components/SettingsView.tsx) |
| `exportData` | [`components/ExportDataRow.tsx`](../../src/renderer/src/components/ExportDataRow.tsx) (Settings → Accounts) |
| `getAppBackground`, `chooseAppBackground`, `clearAppBackground` | [`queries/appBackground.ts`](../../src/renderer/src/queries/appBackground.ts), through [`hooks/useBackgroundPicturePicker.ts`](../../src/renderer/src/hooks/useBackgroundPicturePicker.ts) |
| `setHomeWorld` | [`queries/homeWorld.ts`](../../src/renderer/src/queries/homeWorld.ts), from [`HomeWorldControl.tsx`](../../src/renderer/src/components/HomeWorldControl.tsx) on a world sheet |
| `getAvatarLibrary`, `getAvatarDetails`, `switchAvatar` | [`queries/avatarLibrary.ts`](../../src/renderer/src/queries/avatarLibrary.ts) |
| `getProfile`, `getProfileWorlds`, `getProfileGroups`, `searchCommunity`, `getWorldList`, `getPlayersOnline`, `getMyGroups`, `getRelationship`, `socialAction` | [`queries/community.ts`](../../src/renderer/src/queries/community.ts) |
| `getOwnProfile`, `saveOwnProfile` | [`queries/ownProfile.ts`](../../src/renderer/src/queries/ownProfile.ts), through [`OwnProfileDialog.tsx`](../../src/renderer/src/components/OwnProfileDialog.tsx) |
| `answerFriendRequest`, `sendFriendRequest` | [`queries/friendActions.ts`](../../src/renderer/src/queries/friendActions.ts), from [`InboxView.tsx`](../../src/renderer/src/components/InboxView.tsx) and [`ProfileDetails.tsx`](../../src/renderer/src/components/ProfileDetails.tsx) |
| `notifyRendererHydrated`, `onNavigateToDashboard` | [`App.tsx`](../../src/renderer/src/App.tsx) |
| `syncFriendNote` | [`hooks/useAccountNote.ts`](../../src/renderer/src/hooks/useAccountNote.ts) |
| `getInbox`, `dismissInboxItem`, `clearInbox`, `onInboxChanged` | [`queries/inbox.ts`](../../src/renderer/src/queries/inbox.ts) (`useInboxEvents` is mounted once in `App`) |
| `getFavoriteFriends`, `setFavoriteFriend`, `getFavoriteWorlds`, `setFavoriteWorld` | [`queries/favorites.ts`](../../src/renderer/src/queries/favorites.ts) |
| `getGameFavorites`, `setGameFavorite` | [`queries/gameFavorites.ts`](../../src/renderer/src/queries/gameFavorites.ts) |
| `getCurrentAvatar` | [`queries/currentAvatar.ts`](../../src/renderer/src/queries/currentAvatar.ts) |
| `openBugReport`, `testVrAlert` | [`SettingsView.tsx`](../../src/renderer/src/components/SettingsView.tsx) |
