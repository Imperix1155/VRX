# 7. Shared (`src/shared`)

Part of the [internal API catalog](../INTERNAL-API.md). The code is the source of truth: read the file a row names before relying on it.

Pure types, values and helpers imported as `@shared/...` by main, preload and renderer. Rule: no Electron or Node imports. The IPC contract in [`ipc.ts`](../../src/shared/ipc.ts) is catalogued in [section 1](1-renderer-bridge.md#1-renderer-bridge-windowvrx) and [section 2](2-ipc-channels.md#2-ipc-channels).

## Constants

| Symbol | File | Purpose |
| --- | --- | --- |
| `VRC_API_BASE` | [`constants.ts`](../../src/shared/constants.ts) | `https://api.vrchat.cloud/api/1`. VRChat REST base. |
| `VRC_PIPELINE_URL` | [`constants.ts`](../../src/shared/constants.ts) | `wss://pipeline.vrchat.cloud/`. VRChat Pipeline; the token goes in `?authToken=`. |
| `CVR_API_BASE` | [`constants.ts`](../../src/shared/constants.ts) | `https://api.abinteractive.net/1`. ChilloutVR REST base. |
| `CVR_WS_URL` | [`constants.ts`](../../src/shared/constants.ts) | `wss://api.chilloutvr.net/1/users/ws`. ChilloutVR live socket; auth in upgrade headers. |
| `CVR_PLATFORM` | [`constants.ts`](../../src/shared/constants.ts) | `pc_standalone`. ChilloutVR `Platform` header. |
| `API_TIMEOUT_MS` | [`constants.ts`](../../src/shared/constants.ts) | 15,000. Per-request timeout, also the WebSocket handshake timeout. |
| `API_REQUEST_MIN_INTERVAL_MS` | [`constants.ts`](../../src/shared/constants.ts) | 1,000. Minimum spacing between request starts per platform; the one-request-per-second ceiling. |
| `PIPELINE_BACKOFF_BASE_MS` / `PIPELINE_BACKOFF_CAP_MS` | [`constants.ts`](../../src/shared/constants.ts) | 1,000 / 60,000. WebSocket reconnect backoff range; an open lasting the cap resets it. |
| `RECONCILE_INTERVAL_MS` | [`constants.ts`](../../src/shared/constants.ts) | `5m` 300,000, `10m` 600,000, `30m` 1,800,000, `1h` 3,600,000, `manual` false. Background roster safety net, not a live poll. |
| `FRIENDS_RECONCILE_MS` | [`constants.ts`](../../src/shared/constants.ts) | 300,000. The `5m` value of `RECONCILE_INTERVAL_MS`. |
| `SEARCH_DEBOUNCE_MS` | [`constants.ts`](../../src/shared/constants.ts) | 200. Friend search debounce. |
| `MAX_FRIENDS` | [`constants.ts`](../../src/shared/constants.ts) | 5,000. Roster cap; reaching it makes a VRChat roster partial. |
| `MAX_USERNAME_LENGTH` / `MAX_PASSWORD_LENGTH` / `MAX_TWO_FACTOR_CODE_LENGTH` | [`constants.ts`](../../src/shared/constants.ts) | 256 / 1,024 / 64. Longest sign-in details the auth IPC accepts; the sign-in fields use them as `maxLength`. |
| `CONCURRENCY_LIMIT` | [`constants.ts`](../../src/shared/constants.ts) | 10. Worker count for metadata batches; requests still pass the admission queue. |
| `WORLD_CACHE_TTL_MS` | [`constants.ts`](../../src/shared/constants.ts) | 86,400,000 (24 h). VRChat world metadata success TTL. |
| `INSTANCE_CACHE_TTL_MS` | [`constants.ts`](../../src/shared/constants.ts) | 300,000 (5 min). ChilloutVR instance detail success TTL. |
| `HOT_INSTANCE_THRESHOLD` / `HOT_INSTANCE_THRESHOLD_MIN` / `HOT_INSTANCE_THRESHOLD_MAX` | [`constants.ts`](../../src/shared/constants.ts) | 2, bounds 1 to 10. Default minimum number of visible friends in one exact instance for a hot instance. |
| `ACTIVITY_MAX_ENTRIES_PER_PLATFORM` / `ACTIVITY_PUSH_COALESCE_MS` | [`constants.ts`](../../src/shared/constants.ts) | 300 Activity entries kept per platform; at most one `activity-changed` push per 500 ms. |
| `RELEASES_URL` / `ALL_RELEASES_URL` / `releasesUrlFor(version)` | [`constants.ts`](../../src/shared/constants.ts) | `…/releases/latest` and `…/releases`. Manual download link when in-app updates are unsupported: a version with a `-` suffix (beta or rc) gets the full list, since `/latest` never shows test builds. |
| `ISSUES_URL` | [`constants.ts`](../../src/shared/constants.ts) | `…/issues`. Settings → About → Legal's Report a problem button. |
| `NEW_BUG_REPORT_URL` | [`constants.ts`](../../src/shared/constants.ts) | `…/issues/new`. Main's `bugReport.ts` adds the template and the app version, install type and system, then `open-bug-report` checks it with `isAllowedUrl`. |
| `OWN_*` limits, `OWN_STATUSES`, `isOwnStatus`, `normalizeOwnProfileText` | [`ownProfile.ts`](../../src/shared/ownProfile.ts) | Bio 512, pronouns 32, status text 32 (each platform editor's own limit); 5 s between Saves; 30 s answer reuse. Text is sent with `\n` line endings, control characters removed and ends trimmed; one-line fields turn line breaks into spaces. |
| `FRIEND_ACTION_SPACING_MS` / `FRIEND_ACTION_MAX_WAITING`, `FriendActionResult`, `FriendActionFailure` | [`friendActions.ts`](../../src/shared/friendActions.ts) | 2,000 ms between friend actions per platform; 5 presses may wait. The typed result and refusal reasons for `answer-friend-request` and `send-friend-request`. |
| `COMMUNITY_*` limits, `WORLD_LISTS`, `isCommunityUserId`, `normalizeCommunityQuery` | [`community.ts`](../../src/shared/community.ts) | Search text 2 to 64 characters (or one kanji), 10 results per platform, lists of 12, profile lists of 24, 200 own groups, 8 badges, 5-minute cache, 2-second search spacing; id shape checks. |

## Settings

| Symbol | File | Purpose |
| --- | --- | --- |
| `SETTINGS_VERSION` | [`settings.ts`](../../src/shared/settings.ts) | 27. Rule: every new persisted field bumps it and adds an identity migration, so an older build refuses to rewrite the newer file. |
| `ACTIVITY_KINDS` / `ActivityKind` / `ActivityEntry` / `ACTIVITY_FILTERS` / `ActivityFilter` | [`activity.ts`](../../src/shared/activity.ts) | Activity entry values (`online`, `world`, `offline`; display name, world name or null, time) and the page's Show filter. No location crosses IPC. |
| `SettingsSchema` / `Settings` | [`settings.ts`](../../src/shared/settings.ts) | Zod schema; each field uses `.catch(default)`, so a missing or invalid value degrades to its default. Unknown keys are stripped. |
| `DEFAULT_SETTINGS` | [`settings.ts`](../../src/shared/settings.ts) | `SettingsSchema.parse({})`: every default in one object. |
| `SETTINGS_MIGRATIONS` / `SettingsMigration` | [`settings.ts`](../../src/shared/settings.ts) | Version N to N+1 functions for 1 through 26. Identity except 11 → 12 (a hot alert muted by the old Dashboard switch stays off) and 13 → 14 (a stored `5m` re-sync becomes `1h`). |
| `runMigrations` | [`settings.ts`](../../src/shared/settings.ts) | Runs migrations up to the target. A file at or above the target is returned unchanged; version 0 adopts defaults. Throws when a migration between released versions is missing. |
| `parseSettings` | [`settings.ts`](../../src/shared/settings.ts) | Migrate, then validate. Non-object input becomes defaults. A newer file is read as a sanitized view that keeps its original version. |
| `shouldPersistSettings` | [`settings.ts`](../../src/shared/settings.ts) | False when the stored version is newer than this build. Rule: main never writes settings when this is false. |
| `freshInstallSettings` | [`settings.ts`](../../src/shared/settings.ts) | Defaults with `setupPending: true`. Main's `loadSettings` uses it only when the store is empty (no settings file yet), so only a brand-new install opens the welcome setup. |

### Settings fields

Every persisted field in `SettingsSchema`. "Where" is the place a user changes it. Settings categories are Appearance, Dashboard, Behavior, Notifications, Accounts and About.

| Field | Type and allowed values | Default | Where | Notes |
| --- | --- | --- | --- | --- |
| `version` | non-negative integer | `27` | none | Schema version; drives migrations. |
| `theme` | `'dark'` \| `'system'` \| `'light'` | `'system'` | Settings → Appearance | `system` follows the OS. |
| `backgroundGlow` | `'off'` \| `'muted'` \| `'standard'` \| `'vivid'` | `'standard'` | Settings → Appearance | Background aurora intensity; `off` hides it. |
| `backgroundPictureFade` | `'low'` \| `'medium'` \| `'high'` | `'medium'` | Settings → Appearance | How far the background picture fades toward the theme base. Shown once a picture is set; the picture itself is a main-owned file, not a setting. |
| `labelScheme` | `'vrchat'` \| `'platform-native'` \| `'chilloutvr'` | `'vrchat'` | Settings → Appearance | Instance pill naming. |
| `showHotInstancesPage` | boolean | `true` | Settings → Appearance; welcome setup | Hot Instances in the sidebar. Its Dashboard section and alert keep their own switches. |
| `showInboxPage` | boolean | `true` | Settings → Appearance; welcome setup | Inbox in the sidebar. Inbox alerts keep their own switches. |
| `showActivityPage` | boolean | `true` | Settings → Appearance; welcome setup | Activity in the sidebar. Off also stops keeping activity and forgets what it kept. |
| `showSearchPage` | boolean | `true` | Settings → Appearance; welcome setup | Search in the sidebar. |
| `showGroupsPage` | boolean | `true` | Settings → Appearance; welcome setup | Groups in the sidebar. |
| `showExplorePage` | boolean | `true` | Settings → Appearance; welcome setup | Explore in the sidebar. Popular now keeps its own switch. |
| `setupPending` | boolean | `false` | Settings → About (Run setup again) | Opens the welcome setup. Only a brand-new install starts with `true`; finishing or skipping clears it. |
| `dashboardSections` | every `DASHBOARD_SECTIONS` entry once | default order | Settings → Dashboard (Sections) | Dashboard section order. Unknown or repeated entries drop and missing ones are appended; a file without it is derived from `dashboardSectionOrder`. |
| `dashboardSectionOrder` | `'popular-first'` \| `'hot-first'` | `'popular-first'` | Settings → Dashboard; welcome setup | Which of Popular now and Hot Instances comes first. Kept in step with `dashboardSections` for older builds. |
| `dashboardPopularNow` | boolean | `true` | Settings → Dashboard | Shows the Popular now section. Explore stays available. |
| `hotInstancesEnabled` | boolean | `true` | Settings → Dashboard | Shows the Dashboard Hot Instances section. Does not gate the hot-instance alert. |
| `dashboardWearingNow` | boolean | `true` | Settings → Dashboard | Shows the worn avatar per platform under the Dashboard numbers. The Avatars page stays. |
| `dashboardInvites` | boolean | `true` | Settings → Dashboard | Shows the newest invite per platform under the Dashboard numbers. The Inbox and its alerts stay. |
| `dashboardHideEmpty` | boolean | `true` | Settings → Dashboard | Empty Dashboard sections (no invites, no worn avatar reported, nothing hot) step aside and the first shown section takes the picture cards. Off shows empty states; card style follows the order only. |
| `dashboardPlayersOnline` | boolean | `true` | Settings → Dashboard | Player counts in the top bar under the friend count: one read per shown platform at start and on a page switch once 5 minutes old. |
| `hotInstanceThreshold` | integer 1 to 10 | `2` | Settings → Dashboard; Hot Instances header | Minimum visible friends in one exact instance. Also the alert threshold. |
| `drawerOpener` | `'card'` \| `'avatar'` | `'card'` | Settings → Behavior | Pointer target that opens the friend drawer. |
| `reconcileInterval` | `'5m'` \| `'10m'` \| `'30m'` \| `'1h'` \| `'manual'` | `'1h'` | Settings → Behavior | Background roster refresh; live presence still comes from the WebSocket. v14 moved a stored `'5m'` (the old default) to `'1h'`. |
| `allowJoinInstances` | boolean | `true` | Settings → Behavior | Main checks it at join time for friend and Explore joins. |
| `confirmJoin` | boolean | `true` | Settings → Behavior | Ask before launching. |
| `joinMode` | `'ask'` \| `'vr'` \| `'desktop'` | `'ask'` | Settings → Behavior | Only ChilloutVR links can carry the mode. |
| `joinOpenGame` | boolean | `true` | Settings → Behavior (When the game is already open) | Join hands the join to VRChat or ChilloutVR when it is already open on this computer instead of starting it again; off always starts the game. |
| `vrchatOpenGameJoin` | `'go'` \| `'invite'` | `'go'` | Settings → Behavior (When the game is already open) | How VRChat joins while open: go there, or send yourself an invite. Main falls back to `invite` where the game cannot take the join directly. |
| `saveNotesToAccounts` | boolean | `true` | Settings → Behavior | Friend notes are also saved to the signed-in VRChat or ChilloutVR account. Off keeps notes on this computer only. |
| `useGameFavorites` | boolean | `true` | Settings → Behavior | Stars also show and change the favorites in the signed-in accounts. Off keeps stars in VRX only and reads nothing. |
| `autoUpdate` | boolean | `false` | Settings → About | Opt-in automatic download of an available update. |
| `updateChannel` | `'stable'` \| `'beta'` \| `'dev'` | `'stable'` | Settings → About, in Automatic updates | Feed for the updater. Invalid values stay `'stable'`. Same card as `autoUpdate`, not its own section. v15 keeps it on downgrade. |
| `notifyFriendOnline` | boolean | `false` | Settings → Notifications | Native alert. |
| `notifyFriendInGame` | boolean | `false` | Settings → Notifications | Native alert. |
| `notifyFriendOffline` | boolean | `false` | Settings → Notifications | Native alert. |
| `notifyHotInstance` | boolean | `false` | Settings → Notifications | Native alert; the only gate on hot-instance alerts. |
| `notifyInvites` | boolean | `false` | Settings → Notifications | Native alert for invites and invite requests. |
| `notifyFriendRequests` | boolean | `false` | Settings → Notifications | Native alert for friend requests. |
| `friendAlertScope` | `'everyone'` \| `'picked'` | `'everyone'` | Settings → Notifications | Who the online, joins-a-world and offline alerts cover. Picks are per account in SocialStore. v18 keeps it on downgrade. |
| `vrOverlayAlerts` | boolean | `false` | Settings → Notifications (Alerts in VR) | Also shows every alert switched on above in the headset through XSOverlay, on this computer only. |
| `vrOverlayAlertDuration` | `'short'` \| `'medium'` \| `'long'` | `'medium'` | Settings → Notifications (Alerts in VR) | How long each VR alert stays in view. |
| `cvrSessionImportChoice` | `'ask'` \| `'skip'` \| `'import'` | `'ask'` | none | No reader since the startup import was removed; kept so older builds keep their saved answer. |
| `platformFilter` | `'all'` \| `'vrchat'` \| `'chilloutvr'` | `'all'` | Top bar platform filter | One global filter shared by the views. |
| `exploreWorldsShown` | `2` \| `4` \| `6` | `4` | Explore view | Number of worlds shown. |
| `activityFilter` | `'all'` \| `'online'` \| `'world'` \| `'offline'` | `'all'` | Activity page (Show) | Which kind of entry the Activity page lists. |
| `collapsedFriendSections` | array of `'favorites'` \| `'in-game'` \| `'online'` \| `'offline'` | `['offline']` | Friends list section headers | Collapsed sections. `favorites` (v24) is the starred friends who are in game (also listed under In-Game). |
| `friendSort` | `'name'` \| `'recent'` \| `'world'` \| `'joinable'` | `'name'` | Friends list Order control | The order inside each friends-list group (v27). Recent is hidden and reads as Name while the Activity page is off. |
| `density` | `'comfortable'` \| `'compact'` | `'comfortable'` | none | Read by the friends list; no control sets it. |
| `language` | string, 2 to 35 characters | `'en'` | none | No reader. Both processes use the OS locale (`navigator.language`, `app.getLocale()`). |
| `firstRunDisclaimerAcknowledged` | boolean | `false` | none | No reader. |
| `telemetryEnabled` | boolean | `false` | none | No reader; VRX sends no telemetry. |

Turning off a Dashboard section keeps its child preferences, such as the threshold and alert toggles.

### Settings choice lists

| Symbol | File | Purpose |
| --- | --- | --- |
| `THEMES` / `Theme` | [`types.ts`](../../src/shared/types.ts) | `dark`, `system`, `light`, in display order (System in the middle). |
| `BACKGROUND_GLOWS` / `BackgroundGlow` | [`types.ts`](../../src/shared/types.ts) | `off`, `muted`, `standard`, `vivid`, in display order. |
| `BACKGROUND_PICTURE_FADES` / `BackgroundPictureFade` | [`types.ts`](../../src/shared/types.ts) | `low`, `medium`, `high`. |
| `LABEL_SCHEMES` / `LabelScheme` | [`types.ts`](../../src/shared/types.ts) | `vrchat`, `platform-native`, `chilloutvr`, in display order (mixed option in the middle). |
| `RECONCILE_INTERVALS` / `ReconcileInterval` | [`types.ts`](../../src/shared/types.ts) | `5m`, `10m`, `30m`, `1h`, `manual`. Milliseconds are in `RECONCILE_INTERVAL_MS`. |
| `DRAWER_OPENERS` / `DrawerOpener` | [`types.ts`](../../src/shared/types.ts) | `card`, `avatar`. The avatar button stays the keyboard opener in both modes. |
| `DASHBOARD_SECTION_ORDERS` / `DashboardSectionOrder` | [`types.ts`](../../src/shared/types.ts) | `popular-first`, `hot-first`. |
| `DASHBOARD_SECTIONS` / `DashboardSection` and helpers | [`types.ts`](../../src/shared/types.ts) | `wearing-now`, `invites`, `popular`, `hot` (default order); `normalizeDashboardSections`, `dashboardSectionsFromOrder`, `dashboardSectionOrderOf`, `withDashboardSectionOrder`. |
| `FRIEND_SECTIONS` / `FriendSection` | [`types.ts`](../../src/shared/types.ts) | `in-game`, `online`, `offline` friends-list sections. Presence `active` falls in the `online` section. |
| `FRIEND_SORTS` / `FriendSort` | [`types.ts`](../../src/shared/types.ts) | `name`, `recent`, `world`, `joinable`: the Friends list order inside each group. |
| `FRIEND_LIST_SECTIONS` / `FriendListSection` | [`types.ts`](../../src/shared/types.ts) | `favorites` plus `FRIEND_SECTIONS`: every group header the Friends list can collapse. |
| `FRIEND_ALERT_SCOPES` / `FriendAlertScope` | [`types.ts`](../../src/shared/types.ts) | `everyone`, `picked`. Who the friend alerts cover. |
| `VR_ALERT_DURATIONS` / `VrAlertDuration` | [`types.ts`](../../src/shared/types.ts) | `short`, `medium`, `long`. How long an Alerts in VR message stays. |
| `JOIN_MODE_PREFERENCES` / `JoinModePreference` | [`types.ts`](../../src/shared/types.ts) | `ask`, `vr`, `desktop`. The saved preference; `ask` defers to the join dialog. |
| `VRCHAT_OPEN_GAME_JOINS` / `VrchatOpenGameJoin` | [`types.ts`](../../src/shared/types.ts) | `go`, `invite`. How a VRChat Join reaches a game that is already open. |
| `JOIN_HANDOFFS` / `JoinHandoff` | [`types.ts`](../../src/shared/types.ts) | `launch`, `in-game`, `invite`: what a Join did, or would do now (start the game, hand off to the open game, or send a VRChat self-invite). |
| `UPDATE_CHANNELS` / `UpdateChannel` | [`types.ts`](../../src/shared/types.ts) | `stable`, `beta`, `dev`. Settings label for the updater feed. Stable publishes as `latest`. |

## Core types

### Friends and presence

| Symbol | File | Purpose |
| --- | --- | --- |
| `Platform` | [`types.ts`](../../src/shared/types.ts) | `'vrchat'` \| `'chilloutvr'`. |
| `Friend` / `VrcFriend` / `CvrFriend` | [`types.ts`](../../src/shared/types.ts) | The normalized friend, discriminated by `platform`. `platformUserId` is the stable id, never the display name. ChilloutVR fields with no equivalent (`status`, `statusDescription`, `trustRank`) are null. |
| `PresenceState` | [`types.ts`](../../src/shared/types.ts) | System presence: `in-game`, `active` (VRChat app or website, not in a world) or `offline`. ChilloutVR has no `active`. |
| `UserStatus` | [`types.ts`](../../src/shared/types.ts) | VRChat's chosen status, a separate axis from presence: `join-me`, `online`, `ask-me`, `dnd`, or null. Ordered least to most private. Raw VRChat `active` maps to `online`. |
| `TrustRank` | [`types.ts`](../../src/shared/types.ts) | `visitor`, `new`, `user`, `known`, `trusted`, `nuisance`, or null. VRChat only. |
| `ConnectionHealth` / `AppStatus` | [`types.ts`](../../src/shared/types.ts) | Pipeline health (`live`, `reconnecting`, `down`) and the `get-app-status` snapshot with the last reconcile time per platform. |
| `AdapterEvent` | [`types.ts`](../../src/shared/types.ts) | Normalized live event union; see [section 3](3-adapter-events.md#3-live-adapter-events-adapterevent). |

### Instances and joining

| Symbol | File | Purpose |
| --- | --- | --- |
| `InstanceInfo` | [`types.ts`](../../src/shared/types.ts) | Instance identity and display data. `type` stays platform-true, `openness` is the shared tier, `isGroup` is the group modifier, and `opennessUnknown` marks a degraded unknown privacy value. |
| `InstanceType` / `VrcInstanceType` / `CvrInstanceType` | [`types.ts`](../../src/shared/types.ts) | Eight VRChat types (public to group) and nine ChilloutVR types (public to members-only, plus `offline`). |
| `OpennessTier` | [`types.ts`](../../src/shared/types.ts) | Shared ladder: `public`, `friends-plus`, `friends`, `invite-plus`, `invite`, and ChilloutVR-only `offline`. Group is a modifier, not a tier. |
| `JoinMode` | [`types.ts`](../../src/shared/types.ts) | Wire launch mode `desktop` \| `vr` passed to `buildJoinUrl`. Distinct from `JoinModePreference`, which adds `ask`. |
| `isFriendJoinable` | [`joinability.ts`](../../src/shared/joinability.ts) | In game, a real instance, not a sentinel world id, not VRChat Ask Me or DND, not a ChilloutVR offline instance. Rule: check before showing or sending any friend-instance action. |
| `isWorldHidden` / `HotVisibilityView` | [`hotInstanceKey.ts`](../../src/shared/hotInstanceKey.ts) | True for an in-game VRChat friend set to Ask Me or DND. Rule: hide that friend's location everywhere, including alerts and hot instances. |
| `isHotInstanceMember` / `HotMembershipView` | [`hotInstanceKey.ts`](../../src/shared/hotInstanceKey.ts) | In game, instance present, location not hidden. The one membership test used by the Dashboard and `FriendAlerts`. |
| `hotInstanceKey` | [`hotInstanceKey.ts`](../../src/shared/hotInstanceKey.ts) | Exact instance identity: VRChat `worldId` plus `instanceId`, ChilloutVR `instanceId` alone; null without an instance. Never groups by world or type. Also the join cooldown destination key. |
| `backgroundPictureRefusal` / `backgroundPictureWarning` | [`backgroundPicture.ts`](../../src/shared/backgroundPicture.ts) | Fit of a background picture to the landscape window (`object-fit: cover`). Refuses under 640 × 360 or outside 0.6–5 width ÷ height (main, before decoding); warns about taller than 0.9, wider than 3, or under 1280 × 720 (Settings, one line). |

### Auth and accounts

| Symbol | File | Purpose |
| --- | --- | --- |
| `AuthState` / `AuthStatus` | [`types.ts`](../../src/shared/types.ts) | `authenticated`, `unauthenticated`, `needs-2fa` (with `twoFactorMethod`) or `error` (with `unreachable` when no answer came). An `unauthenticated` status carries `endedByPlatform` when the platform refused the session VRX held, never after a sign-out the user chose; a new sign-in or a sign-out clears it, and it lives only in memory. `accountId` is the signed-in platform identity, null unless authenticated, never a storage key. |
| `Credentials` | [`types.ts`](../../src/shared/types.ts) | Username and password (or ChilloutVR access key) sent to main for login. Rule: never log it. |
| `TwoFactorMethod` | [`types.ts`](../../src/shared/types.ts) | `email` \| `totp`. |
| `LoginResult` | [`types.ts`](../../src/shared/types.ts) | Success, a `needs2fa` step, or an error. `sessionCleared: true` means main dropped local auth state and the renderer must treat that platform as signed out. |
| `CREDENTIAL_PERSISTENCE_FAILED` / `AUTH_IDENTITY_UNAVAILABLE` | [`types.ts`](../../src/shared/types.ts) | Login error codes. Only the first has its own renderer copy; the second uses generic copy. |
| `SESSION_IMPORT_NOT_FOUND` / `SESSION_IMPORT_REJECTED` | [`types.ts`](../../src/shared/types.ts) | `import-session` results: nothing usable on this PC, or a found sign-in the platform no longer accepts. The renderer maps each per platform (`importErrorKey`) so the copy names where VRX looked. |
| `Account` | [`types.ts`](../../src/shared/types.ts) | Known account row from `get-accounts`: platform, `platformAccountId`, display name, `isActive`. |
| `AccountScoped<T>` | [`types.ts`](../../src/shared/types.ts) | Versioned per-account persistence envelope (`schemaVersion`, `platform`, `platformAccountId`, `data`). Holds no linked-person id. |

### Linked profiles

| Symbol | File | Purpose |
| --- | --- | --- |
| `LinkedPersonMember` | [`types.ts`](../../src/shared/types.ts) | One friend qualified by platform, platform account id and friend id. Never a bare upstream id. |
| `LinkedPerson` | [`types.ts`](../../src/shared/types.ts) | Version 1 linked-person record, read only to migrate older `link-graph.json` files. |
| `LinkedProfile` / `LinkProfileFile` | [`linkedProfiles.ts`](../../src/shared/linkedProfiles.ts) | Version 2 person: two members, custom and default names, preferred platform, picture mode (`preferred` \| `merged`), shared note and revision. The file adds a document revision. |
| `LinkChange` | [`linkedProfiles.ts`](../../src/shared/linkedProfiles.ts) | Main-side mutation: `replace` (link two members, confirming expected people), `unlink` or `update`, each with expected revisions. |
| `LinkRequest` / `FriendRef` | [`linkedProfiles.ts`](../../src/shared/linkedProfiles.ts) | Renderer-side request. `replace` names friends by `{ platform, friendId }`; main adds account ownership. |
| `LinkFailure` / `LinkResult<T>` | [`linkedProfiles.ts`](../../src/shared/linkedProfiles.ts) | Typed result: `invalid`, `stale`, `unavailable`, `storage` or `rate-limited`. |
| `LinkProfileSnapshot` / `LinkSnapshot` | [`linkedProfiles.ts`](../../src/shared/linkedProfiles.ts) | Profiles plus `storeRevision`; the IPC snapshot adds a `lease` and main-owned ready `accountIds`. Readers keep the newest revision within a lease. |

### Explore

| Symbol | File | Purpose |
| --- | --- | --- |
| `EXPLORE_WORLD_TOTALS` / `ExploreWorldTotal` / `DEFAULT_EXPLORE_WORLD_TOTAL` | [`explore.ts`](../../src/shared/explore.ts) | Allowed world totals 2, 4 and 6; default 4. |
| `ExploreFilter` | [`explore.ts`](../../src/shared/explore.ts) | `'all'` or one `Platform`. |
| `ExploreRefreshReason` / `ExploreWorldReason` | [`explore.ts`](../../src/shared/explore.ts) | Why a snapshot is requested (`snapshot`, `automatic`, `manual`) or a world is read (`snapshot`, `open`, `manual`). `snapshot` never starts network work. |
| `ExploreImageResult` | [`explore.ts`](../../src/shared/explore.ts) | A `data:` URL, a typed `deferred` with `retryAfterMs` (and `wait`: `busy` or `window`) for local admission limits, or null (terminal). Grants no URL or session authority. |
| `ExploreCount` / `ExploreCountSource` | [`explore.ts`](../../src/shared/explore.ts) | A count is `complete` with a value, or `partial` / `unknown` with null, and always names its source. A partial subtotal is never shown as a total. |
| `ExploreWorld` | [`explore.ts`](../../src/shared/explore.ts) | Display world with a main-issued opaque `worldRef`, activity, visible room count, popularity and source order. |
| `ExploreRoom` / `ExplorePublicAccess` / `ExploreRoomAction` / `ExploreJoinDenial` | [`explore.ts`](../../src/shared/explore.ts) | Public or group-public room with occupancy and capacity. Its action is `available` with an opaque `selectionRef`, or `disabled` with a reason. |
| `ExplorePlatformSnapshot` / `ExploreWorldSnapshot` | [`explore.ts`](../../src/shared/explore.ts) | Per-platform world list or one world with its rooms, plus status, problem, staleness and update time. |
| `rankExploreWorlds` | [`exploreRanking.ts`](../../src/shared/exploreRanking.ts) | Deduplicates and ranks one platform's list. VRChat: occupants, then popularity. ChilloutVR: complete public totals, then source order. Never compares platforms. |
| `selectExploreWorlds` / `ExploreSelection` | [`exploreRanking.ts`](../../src/shared/exploreRanking.ts) | Mixes already-ranked lists: equal shares, alternating leaders, neutral seed tie-break, then backfill. A single-platform filter takes that list only. Does not mutate inputs. |

### Feature limits and results

The typed results and wire limits of the user-triggered features. Main enforces every limit; the renderer reads them only to label or trim.

| Symbol | File | Purpose |
| --- | --- | --- |
| `VRCHAT_ACCOUNT_NOTE_MAX_LENGTH`, `ACCOUNT_NOTE_WRITE_SPACING_MS`, `ACCOUNT_NOTE_CHECK_REUSE_MS` | [`accountNotes.ts`](../../src/shared/accountNotes.ts) | VRChat keeps 256 characters of a note; account note writes are 2 s apart per platform; a check is reused for 5 minutes. |
| `AccountNoteSyncMode`, `AccountNoteSyncResult`, `AccountNoteSyncFailure`, `AccountNoteDecision` | [`accountNotes.ts`](../../src/shared/accountNotes.ts) | `sync-friend-note` modes and answers: `saved`, `local-only`, `too-long`, `account-too-long`, `off`, or `account-changed` and `conflict` with the account copy. Failures: `not-authenticated`, `rate-limited`, `unavailable`, `stale`, `invalid`, `not-friend`. |
| `readableAccountNote`, `accountNoteToSend`, `comparableNote`, `fitsVrxNote`, `fitsAccountNote` | [`accountNotes.ts`](../../src/shared/accountNotes.ts) | Convert between VRX's note and the account copy (VRChat's one-line form and look-alike symbols), and check that each fits the other side. |
| `AVATAR_TEXT_MAX_LENGTH`, `AVATAR_IMAGE_URL_MAX_LENGTH`, `AVATAR_SWITCH_COOLDOWN_MS`, `isAvatarId` | [`avatarLibrary.ts`](../../src/shared/avatarLibrary.ts) | 2,048-character text and picture URL bounds, 5 s between Wear presses per platform, and each platform's avatar ID shape. |
| `AvatarItem`, `AvatarVisibility`, `AvatarLibraryResult`, `CurrentAvatarResult`, `AvatarDetailsResult`, `AvatarSwitchResult`, `AvatarLibraryFailure` | [`avatarLibrary.ts`](../../src/shared/avatarLibrary.ts) | One avatar (`public`, `private` or null visibility), the uploads list with `complete` and the worn avatar, the worn avatar alone for the Dashboard, and the Wear answer. |
| `FAVORITE_WORLD_NAME_MAX`, `FavoritesRevision`, `FavoriteWriteResult` | [`favorites.ts`](../../src/shared/favorites.ts) | Stored world names are cut at 256 characters. Star writes echo the read's account and epoch and answer `not-authenticated`, `invalid`, `stale`, `full` or `rate-limited`. |
| `GAME_FAVORITE_*` limits | [`gameFavorites.ts`](../../src/shared/gameFavorites.ts) | Writes 2 s apart per platform; a Refresh within a minute reuses the last read; 5 minutes before reading on its own after a failure. At most 20 groups of each kind, 400 worlds and 1,000 friends per platform; group names are cut at 64 characters. |
| `GameFavoriteKind`, `GameFavoriteGroup`, `GameFavorites`, `GameFavoritesUnavailable`, `GameFavoriteWriteFailure`, `GameFavoriteWriteResult`, `canAddToGroup` | [`gameFavorites.ts`](../../src/shared/gameFavorites.ts) | The account's favorite groups (`friend` or `world`, opaque `key`, capacity and count) and who is in which, `oneGroupPerItem` for VRChat, and which groups an item may join now. Write failures add `full` and `other-group`. |
| `SetHomeWorldFailure` | [`homeWorld.ts`](../../src/shared/homeWorld.ts) | `not-authenticated`, `unknown-world`, `cooldown`, `rate-limited`, `failed`. |
| `INBOX_KINDS`, `InboxKind`, `InboxEntry`, `InboxChange`, `InboxItem`, `InboxSnapshot` | [`inbox.ts`](../../src/shared/inbox.ts) | `invite`, `invite-request`, `friend-request`. Pipelines publish `add`, `remove` and `clear` changes; the renderer gets rows with a main-issued `id`, newest first. |
| `MAX_INBOX_*`, `INBOX_*_MAX_LENGTH`, `isInboxId`, `boundedInboxText` | [`inbox.ts`](../../src/shared/inbox.ts) | 50 rows and 200 hidden record IDs per platform, 50 records read per frame, IDs up to 128 characters, names 64 and world names 128 (cut by code point). |
| `FRIEND_REQUEST_ANSWERS`, `FriendRequestAnswer`, `AnswerFriendRequest`, `SendFriendRequest` | [`friendActions.ts`](../../src/shared/friendActions.ts) | `accept` or `decline` for an inbox row's main-issued ID, and Add friend for a user ID. |
| `PersonSummary`, `PersonProfile`, `ProfileRank`, `ProfileBadge`, `CommunityWorld`, `CommunityGroup`, `CommunityFailure` | [`community.ts`](../../src/shared/community.ts) | Search rows and full profiles (pronouns, bio, VRChat trust rank or a platform label, badges), profile worlds and groups. Failures: `not-authenticated`, `rate-limited`, `unavailable`, plus `unknown-person` or `not-found` where a person is named. |
| `SocialFailure` | [`socialActions.ts`](../../src/shared/socialActions.ts) | `not-authenticated`, `rate-limited`, `unavailable`, `unknown-person` (neither a friend nor listed by a search this session). |
| `OwnProfileChanges`, `OwnProfileFailure` | [`ownProfile.ts`](../../src/shared/ownProfile.ts) | The changed fields only (`bio`, `pronouns`, VRChat `status` and `statusText`), and the read failures. |
| `BACKGROUND_PICTURE_*`, `BackgroundPictureRefusal`, `BackgroundPictureWarning` | [`backgroundPicture.ts`](../../src/shared/backgroundPicture.ts) | Refused under 640 × 360 or when width ÷ height is below 0.6 or above 5. Warned (shape first) below 0.9, above 3, or under 1280 × 720. |
| `EXPLORE_MAX_SELECTION` | [`explore.ts`](../../src/shared/explore.ts) | 48. Most worlds one Explore selection holds (six rows on the widest window). |
| `IpcInvokeChannel`, `IpcEventChannel`, `IpcNotificationChannel`, `FriendRosterProvenance`, `UpdaterFailure` | [`ipc.ts`](../../src/shared/ipc.ts) | Channel name unions, the VRChat roster reply's provenance (base revision, covered and override IDs), and the updater's typed failure codes (`check-network`, `download-write`, `staged-install`). |
