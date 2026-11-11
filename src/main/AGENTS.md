# src/main

## Purpose

Electron's privileged process: startup, windows, tray, updater, IPC, main-only
services, credentials, platform adapters and game launches. Node and Electron
access and all privileged state stay on this side of the process boundary. The
[root contract](../../AGENTS.md) security and API etiquette rules apply in
full; this file adds local rules. Exact limits, cooldowns and caps for each
service are in the [internal API catalog](../../docs/INTERNAL-API.md) (mostly
its adapter contract, main process and IPC sections); keep them there, not
here.

## Ownership

- `index.ts` takes the single-instance lock, then imports `app.ts`. Keep it
  Electron-only so a losing duplicate exits before logging, keychain reads,
  sockets or a window exist.
- `app.ts` is the composition root: it wires adapters, services, IPC, window,
  tray, updater, alerts and quit cleanup. Policy lives elsewhere.
- `ipc/` owns renderer-facing handlers and the bridge rules (child contract).
  [`../preload`](../preload/index.ts) belongs to this contract: `index.ts`
  exposes `window.vrx`, `index.d.ts` types it.
- `services/` owns main-only state, persistence, policy and coordination.
  `services/adapters/` owns platform HTTP and WebSocket transport, shared
  request admission and reconnect (VRChat and ChilloutVR child contracts).
- Top-level modules own cross-cutting concerns: event fan-out
  (`adapterWiring.ts`), navigation guards, native notifications and XSOverlay
  (`vrOverlayAlerts.ts`), tray, updater and its feed, logging and redaction,
  main-process copy (`i18n.ts`), sockets, wake reconnect, the windowless
  roster catch-up, the window show gate and minimum size, and the fatal error
  box.

## Local Contracts

**Window and process**

- Besides the root window flags, keep `webSecurity: true` and
  `allowRunningInsecureContent: false`. `navigationGuards.ts` denies every
  `window.open` and every navigation away from the renderer entry; only
  `isAllowedUrl` links go to the browser.
- The shipped CSP lives in `src/renderer/index.html`. The default session
  grants only `clipboard-sanitized-write`. Widen neither.
- The window's content is 900×670 by default and at minimum
  (`windowMinimumSize.ts` adds the frame back and clamps to the current
  display). It reveals after the renderer reports hydration, with a 3 s
  fallback. Second-instance, notification and tray actions focus or recreate
  the current window at click time. One recovery dialog per window handles
  crashes and hangs.
- Start with your computer (`services/loginItem.ts`): the `startWithComputer`
  setting is mirrored to the operating system at startup and after a save,
  writing only on a mismatch. Only a packaged copy registers. On Linux the one
  file is `<config>/autostart/vrx.desktop`, and only an entry with VRX's own
  marker is ever removed. A launch the computer made carries
  `--launched-at-login`; with the In the tray choice its first window stays
  hidden (`createShowGate` `startHidden`) until VRX is asked for.
- On Windows and Linux, close hides to the tray until `before-quit` sets the
  single `quitting` flag; a throwing teardown must not skip the flag. macOS
  keeps native close. Hide, minimize, close and renderer loss stop Explore
  discovery.
- Windows and Linux have no app menu, so Alt can't reveal Reload or developer
  tools; `isQuitShortcut` restores Ctrl+Q.
- Tray artwork: `resources/icon.ico` on Windows, 16 px PNG on macOS, 24 px PNG
  on Linux, each with `@2x`, imported as `?asset&asarUnpack`. Never shrink the
  512 px master for the tray.

**Authority**

- Main owns account identity, sessions and epochs, friend locations
  (`LocationAuthority`), settings policy, opaque Explore world references,
  launch URLs and `shell.openExternal`. The renderer sends friend IDs, opaque
  references and expected targets for comparison only, never a world ID or
  URL to act on.
- Launch in two steps: resolve current main-owned data, then build the URL and
  check it with `isAllowedLaunchUrl` immediately before opening it. One launch
  per platform at a time (`JoinCoordinator`). `gameHandoff.ts` hands the same
  URL to a game that is already open; its process check reads names only, is
  cached 2 s and is never logged.

**Credentials**

- `services/credentials.ts` is the only credential store. It accepts only
  `CREDENTIAL_KEYS`, writes an invalidation marker before any replacement or
  deletion, and a signed-out marker on sign-out. A failed write fails closed
  and can't revive old auth. An unreadable `credentials.json` is deleted and
  the store starts empty.
- OS `safeStorage` first; Linux `basic_text` counts as unavailable. The
  `localCredentialEncryption.ts` fallback is used only when OS encryption is
  unavailable or fails. An OS-protected credential that can't be decrypted is
  never re-encrypted locally.
- Adapters persist a credential only after validating its owner. A failed save
  ends the login with `CREDENTIAL_PERSISTENCE_FAILED` and clears the session.

**Sign-in from this PC** (`sessionImport.ts`, `vrcxSessionImport.ts`,
`cvrSessionImport.ts`)

- Discovery runs only from the `import-session` IPC, which the "Use my sign-in
  from" button calls; the press is the consent. Startup restores VRX's own
  sessions only and never looks at VRCX, CVRX or game files.
- Importers only read and return. The adapter checks the material with the
  platform before it replaces anything, binds the owner, then persists. A
  dead, unreadable or ownerless import leaves the current session as it was.
- Discovery is read-only and bounded (time, file size, entries, profiles).
  Accept only local absolute paths; reject symlinks, sources that change
  during the read, XML DTD/CDATA and ambiguous credential sets. The VRCX
  reader snapshots the database to private temp files, treats a non-empty
  `-wal`, `-shm` or `-journal` as VRCX running, and never creates or changes a
  file in a VRCX folder.

**Stores**

- `services/settings.ts` migrates and validates through `@shared/settings`.
  Saves apply in memory, coalesce disk writes, refuse to overwrite a newer
  file and reject failed writes. Defaults never replace an unreadable file: a
  file that isn't valid JSON is renamed to `settings.corrupt-<time>.json`, and
  saves are refused while it stays unreadable. Only a truly empty store loads
  `freshInstallSettings` (which queues the welcome setup). Read fire-time
  policy from `getSettingsSnapshot()`.
- The account registry, `SocialStore` (notes, alert picks, favorites,
  `noteSync`), and link graph validate bounded data and check account, epoch
  or revision before a change. They write a cloned snapshot, publish memory
  only after the write succeeds, and refuse newer-format or unloadable files.

**Events, alerts and activity**

- `adapterWiring.ts` feeds each event to app status, `LocationAuthority`,
  `FriendAlerts`, `ActivityFeed`, `InboxService`, then the broadcast, isolating
  each consumer. `inbox` events go only to `InboxService`. With no window open,
  `RosterCatchUp` makes the one reconnect roster read an open window would.
  Broadcasts stamp `rosterRevision`; event revisions never move per-friend
  location fences.
- A session boundary clears that platform's alerts, locations, inbox (unless
  `identityRetained`), Explore, avatars, community, game favorites, note sync,
  home world, friend actions, social actions and own-profile state, then sends
  `identity-boundary`. A VRChat data-path 401
  sets `identityRetained`: clear main state, send no boundary; the following
  `auth-invalidated` quarantines the renderer.
- Alerts read settings when they fire, and every alert defaults off. Ask Me
  and Do Not Disturb friends never count toward hot alerts, and no alert,
  activity row or XSOverlay message names their world
  (`friendNotificationPrivacy.test.ts`). Picked-friend scope limits friend
  alerts only. Failure logs carry no names or locations.
- `vrOverlayAlerts.ts` talks only to this computer: one UDP datagram from
  `127.0.0.1` to `127.0.0.1:42069`, then close. Never listen, read replies or
  widen the host.
- `ActivityFeed` and `InboxService` are memory only and bounded. Neither calls
  a platform. Activity never records a world for a hidden location; Hide in
  the inbox is local. Where an invite leads stays beside its row in main
  (`inviteTarget`); snapshots carry only `canJoin`.

**Platform writes**

Every write the user can trigger has its own service and a narrow adapter
capability that does not extend `IPlatformAdapter`. Common rules: only on a
press, only for the signed-in account, one action per platform at a time with
spacing between attempts, sent once and never retried, never across an
account change, and fenced by the session lease. ChilloutVR writes that use
the `/users/ws` socket are never queued while it is closed.

- `FriendActionsService`: Accept or Decline an inbox friend request main
  holds; Add friend for someone a search listed this session. Never add Accept
  all or any bulk friend action. `CommunityAdapter` stays read-only.
- `SocialActionService`: Unfriend, Block and Unblock one confirmed person (a
  friend, or someone a search listed).
- `OwnProfileService`: the user's own bio, pronouns and VRChat status, only
  on Save, sending only fields that changed.
- `HomeWorldService`: resolves the renderer's world reference itself.
- `AccountNoteService`: friend notes, a three-way compare against the last
  text both copies agreed on; asks the user when both changed.
- `Favorites` (local stars) and `GameFavoritesService` (account favorite
  groups and categories): read once per sign-in; never create or rename a
  group; check caps and VRChat's one-group rule before sending; re-read a
  ChilloutVR item's categories before writing so none is dropped.
- `AvatarLibraryService` and `currentAvatarService.ts`: Wear switches avatars
  only on a press.

**Reads and images**

- `CommunityService` (profiles, search, world lists, groups, player counts)
  and `ExploreService` are read-only and user-initiated: no timers, cached
  answers, shared in-flight reads and spaced searches. A profile is read only
  for a friend or someone a search listed, so the renderer can't walk
  profiles.
- `AvatarCache` is the only image proxy: HTTPS host allowlist, redirect, MIME,
  URL-length, size, LRU and TTL limits, shared admission, and the VRChat
  cookie only to `api.vrchat.cloud` under the current account lease. Its disk
  tier (`ImageDiskStore`) and `VrcMetadataStore` are bounded, validated on
  read, never log URLs or paths, and are cleared on VRChat sign-out.
  Renditions (`avatar`, `picture`) never add requests beyond the bounded
  thumbnail fallback.
- `AppBackgroundStore` reads only the file picked in the native dialog,
  checks it before decoding, keeps only a fresh bounded copy, never changes
  the picked file and never logs paths.

**Network, updates and logging**

- Requests go through `BaseAdapter` and the per-platform
  `ApiAdmissionController`. Every retry reacquires admission and honors the
  latest 429 cooldown. Cancellation, queue overflow and a tentative session
  are control flow: stop later pages, never count them as failures.
- Updates need consent: no download unless `autoUpdate` is on (default off),
  install only a `downloaded` update, send only typed `UpdaterFailure` codes.
  Stable never admits a beta or dev build; a check never offers a build older
  than the running one; keep `allowDowngrade` off on every channel.
- Log through `logger.ts`. Never log tokens, friend names, notes, profile
  text, identifier-bearing URLs, raw payloads or absolute paths. Use
  `app.getPath()` (`pathConvention.test.ts`). Native copy goes through `mt()`
  with en and ja strings.

## Work Guidance

- Check the API catalog before adding a service, event, channel, parser or
  constant. Reuse a documented boundary and update its entry in the same
  change.
- Adapter transport stays Electron-free and dependency-injected. Auth, HTTP
  retry, admission and WebSocket reconnect each have one owner.
- Fence interactive auth at every await: a later login supersedes an earlier
  one, logout cancels active and queued work, and a tentative credential can't
  serve data, persist or borrow an old account.
- Treat API data as hostile. Keep usable partial rosters where their
  completeness contract allows; schema drift must not crash or delete friends.
- A new platform write follows the "Platform writes" rules above and gets an
  entry in [API policy](../../docs/api-policy.md).

## Verification

- Run the root gate and focused tests for the changed boundary. IPC changes
  need trust, validation, rate-limit and allowlist cases. Credential changes
  need persistence, invalidation and plaintext-absence cases. Lifecycle and
  event changes need ordering, cleanup and consumer-isolation cases. Write
  features need once-only, spacing and account-change cases.
- Inspect the diff for secrets, raw IPC additions, `console` use and Electron
  imports in shared code.

## Child DOX Index

- [`ipc/AGENTS.md`](ipc/AGENTS.md): typed handlers, sender trust, rate limits,
  URL policy and the preload bridge.
- [`services/adapters/vrchat/AGENTS.md`](services/adapters/vrchat/AGENTS.md):
  VRChat parsers, roster, resolvers, Pipeline and `VrcAdapter`.
- [`services/adapters/cvr/AGENTS.md`](services/adapters/cvr/AGENTS.md):
  ChilloutVR parsers, roster, instance resolver, `/users/ws` and `CvrAdapter`.
