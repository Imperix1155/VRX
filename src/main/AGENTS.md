# src/main

## Purpose

Electron's privileged process: startup, windows, tray, updater, IPC
registration, main-only services, credentials, platform adapters, and external
launches. Node and Electron access and all privileged state stay on this side
of the process boundary. The [root contract](../../AGENTS.md) security and API
etiquette rules apply in full; this file adds local detail.

## Ownership

- `index.ts` takes the single-instance lock, then dynamically imports `app.ts`.
  Keep it Electron-only so a losing duplicate exits before logging, keychain
  reads, sockets, or a window exist.
- `app.ts` is the composition root. It wires adapters, services, IPC, window,
  tray, updater, alerts, and quit cleanup. Adapter and IPC policy do not live
  here.
- `ipc/` owns renderer-facing handlers (child contract).
- `services/` owns main-only state, persistence, policy, and coordination.
  `services/adapters/` owns platform HTTP and WebSocket transport, shared
  request admission, and reconnect logic.
- Top-level modules own cross-cutting concerns: event fan-out
  (`adapterWiring.ts`), navigation guards, native notifications, tray, updater,
  logging and redaction, main-process copy (`i18n.ts`), sockets, live-socket
  reconnect after wake (`wakeReconnect.ts`), window reveal (`showGate.ts`), and
  the error box shown before a fatal exit (`fatalErrorBox.ts`).
- [`../preload`](../preload/index.ts) belongs to this contract. `index.ts`
  exposes `window.vrx`; `index.d.ts` types it. Bridge rules are in the IPC
  child contract.
- Look up symbols in [`docs/INTERNAL-API.md`](../../docs/INTERNAL-API.md).

## Local Contracts

**Window and process**

- Besides the root window flags, keep `webSecurity: true` and
  `allowRunningInsecureContent: false`. `navigationGuards.ts` denies every
  `window.open` and every frame navigation away from the renderer entry. Only
  `isAllowedUrl` links go to the browser.
- The shipped CSP lives in `src/renderer/index.html`. The default session
  grants only `clipboard-sanitized-write`. Do not widen either.
- The window is sized by its page (`useContentSize`): 900x670 by default and
  at minimum. `windowMinimumSize.ts` adds the frame back for
  `setMinimumSize` (which takes the outer size) and clamps to the work area
  of the display the window is on now, re-applied on move. It reveals
  after the renderer reports hydration (3 s fallback). Second-instance and
  notification activation focus the current window, recreating it if
  destroyed; tray actions resolve the window at click time, and tray Show goes
  through the same focus path, as does a single tray click on Windows. The tray
  menu treats a minimized window as hidden. One recovery dialog
  per window handles crashes and hangs; a renderer killed from outside the app
  counts as a crash unless the app is quitting.
- On Windows and Linux, close hides to the tray until `before-quit` sets the
  single `quitting` flag; macOS keeps native close. `before-quit` disposes
  Explore, flushes settings, and tears down adapter wiring; a throwing teardown
  must not skip the flag. Hide, minimize, close, and renderer loss stop Explore
  discovery.
- Windows and Linux have no app menu (`Menu.setApplicationMenu(null)`), so
  Alt cannot reveal Reload or developer tools; `createWindow` restores Ctrl+Q
  through `isQuitShortcut`. macOS keeps its default menu.
- Tray artwork is `resources/icon.ico` on Windows, the 16 px PNG on macOS, and
  the 24 px PNG on Linux, each with `@2x` files, imported as
  `?asset&asarUnpack`. Never reduce the 512 px master for tray use.

**Authority**

- Main owns account identity, sessions and epochs, `LocationAuthority` friend
  locations, settings policy, opaque Explore references, launch URLs, and
  `shell.openExternal`. The renderer submits friend IDs, opaque references, and
  expected targets for comparison only.
- Launch in two steps: resolve current main-owned data, then build the URL and
  check it with `isAllowedLaunchUrl` immediately before opening it.
  `JoinCoordinator` allows one launch per platform at a time.

**Credentials**

- `services/credentials.ts` is the only credential store. It accepts only
  `CREDENTIAL_KEYS`, writes an invalidation marker before any replacement or
  deletion, and writes a signed-out marker on explicit sign-out. A failed write
  fails closed and cannot revive old auth. A `credentials.json` that is not
  valid JSON is deleted and the store
  starts empty, so it restores nothing and the next sign-in can save.
- OS `safeStorage` comes first; the Linux `basic_text` backend counts as
  unavailable. The `localCredentialEncryption.ts` fallback is used only when OS
  encryption is unavailable or fails. An OS-protected credential that cannot be
  decrypted is never re-encrypted locally.
- Adapters persist a credential only after validating its authenticated owner.
  A failed save ends the login with `CREDENTIAL_PERSISTENCE_FAILED` and clears
  the session. Do not reintroduce a separate owner store.

**Sign-in from this PC** (`sessionImport.ts`, `vrcxSessionImport.ts`,
`cvrSessionImport.ts`)

- Discovery runs only from the `import-session` IPC, which the "Use my sign-in
  from this PC" button calls; the press is the consent. Startup restores VRX's
  own stored sessions only and never looks at VRCX, CVRX, or game files.
- Importers only read and return material; they never persist. The adapter's
  `importSession` checks it with the platform (VRChat `/auth/user`, CVR
  `AuthType: 1`) before it replaces anything, binds the owner, then persists.
  A dead, unreadable, or ownerless import leaves the current session as it was.
- Discovery is read-only and bounded in time, file size, entry and profile
  counts. Accept only local absolute paths; reject symlinks, sources that change
  during the read, XML DTD/CDATA, and ambiguous credential sets. The VRCX reader
  snapshots the database into private temp files, treats a non-empty `-wal`,
  `-shm`, or `-journal` file as VRCX running, and never creates or changes files
  in a VRCX folder.
- The signed-out marker is still written on ChilloutVR sign-out so an older
  build that still imports at startup keeps honoring the sign-out.

**Stores**

- `services/settings.ts` migrates and validates through `@shared/settings`. A
  failed normalization write keeps the parsed settings as unsaved and
  retryable, never defaults. Saves apply in memory, coalesce disk writes,
  refuse to overwrite a newer-version file, and reject failed writes. After an
  unreadable load, a save re-reads the file first and is refused while it stays
  unreadable, so defaults never replace the user's file. Read
  fire-time policy from `getSettingsSnapshot()`. Only an empty store (no
  settings file yet, and no set-aside `settings.corrupt-*.json`) loads
  `freshInstallSettings`, which queues the welcome setup; an unreadable,
  damaged or older file never does. A file that is not valid JSON
  is renamed to `settings.corrupt-<time>.json`, never deleted.
- Account registry, social store, and link graph validate bounded data and
  check account/epoch or reviewed revisions before mutation. They write a
  cloned snapshot, publish memory only after the write succeeds, and refuse
  newer-format or unloadable files. Link-graph operations reject reentry.

**Events, alerts, images**

- `adapterWiring.ts` feeds each event to app status, `LocationAuthority`,
  `FriendAlerts`, then the broadcast, isolating each consumer. The broadcast
  stamps `rosterRevision` from the same monotonic counter as roster seeds;
  event revisions never move per-friend location fences.
- A session boundary clears that platform's alerts, location authority, and
  Explore state, then sends `identity-boundary`. A VRChat data-path 401 sets
  `identityRetained`: clear main state but send no identity boundary; the
  following `auth-invalidated` quarantines the renderer.
- Alerts read settings at dispatch (`isFriendAlertEnabled`; every alert
  defaults off). Hot alerts gate only on `notifyHotInstance`;
  `hotInstancesEnabled` hides a Dashboard section only. Alert state is bounded
  and rate limited. Ask Me and DND friends never count toward hot alerts, and
  no alert names their world (`friendNotificationPrivacy.test.ts`). Failure
  logs carry no names or locations.
- `AvatarCache` is the only image proxy. Keep its HTTPS host allowlist,
  redirect, MIME, URL-length, body-size, LRU entry and byte, and TTL limits.
  API hops share platform admission. The VRChat cookie goes only to
  `api.vrchat.cloud`, under a captured account lease.
- `ImageDiskStore` is `AvatarCache`'s disk tier for `api.vrchat.cloud` images
  only, under `app.getPath('userData')/image-cache`. Keep it bounded (entries,
  bytes, 14-day TTL), validate every read like a network body (exact URL, MIME,
  size), write only lease-current results, never log URLs or paths, and clear
  it on an explicit VRChat sign-out. A disk hit never makes a request.
  `VrcMetadataStore` (`userData/vrchat-metadata`) keeps world and group names
  the same way: one validated file per account, atomic writes, entries keep
  their 24-hour expiry, and `clearAll()` on an explicit VRChat sign-out.
- `AppBackgroundStore` keeps the user's background picture in
  `userData/app-background`. It reads only the file picked in the native
  dialog (regular PNG or JPEG, bounded bytes, header pixel count and the
  shared size and shape refusal checked before decoding), keeps only a freshly encoded, bounded copy written
  atomically, never changes the picked file, and never logs paths.
- Round friend pictures ask for `AvatarCache`'s `avatar` rendition: a small
  copy built locally from already validated bytes (`avatarRendition.ts`). It
  never changes which URLs are requested or how often; any failure keeps the
  original.

**Network and logging**

- Requests go through `BaseAdapter` and the shared per-platform
  `ApiAdmissionController`. Every physical retry reacquires admission and
  honors the latest 429 cooldown. Cancellation, queue overflow, and a tentative
  session are control flow: stop later pages or enrichment, and never count or
  negative-cache them as failures.
- Updates stay consent-based: no automatic download unless the user enabled
  `autoUpdate` (default off), install only a `downloaded` update, and send only
  typed `UpdaterFailure` codes to the renderer. The saved `updateChannel`
  picks the feed. Stable uses `latest` and never admits a beta or dev build.
  Beta and dev are opt-in. Dev resolves the release list itself so a newer
  stable build is found; electron-updater only does that for its beta channel.
  A channel change cancels an in-flight download before the next check. Set
  `allowDowngrade` after `channel` and keep it off on every channel. A check
  never offers a build older than the one running, including after a channel
  change.
- Log through `logger.ts` (redaction hook). Never log tokens, friend names,
  identifier-bearing URLs, raw payloads, or absolute paths. Use `app.getPath()`;
  `pathConvention.test.ts` rejects hardcoded user paths. Redaction also masks
  the home folder as `~` (`setRedactedHomeDirectory`). Native copy goes
  through `mt()` with en and ja strings.

## Work Guidance

- Check the API catalog before adding a service, event, channel, parser, or
  constant. Reuse a documented boundary and update its entry in the same change.
- Adapter transport stays Electron-free and dependency-injected. Auth, HTTP
  retry, admission, and WebSocket reconnect each have one owner.
- Fence interactive auth at every await: a later login supersedes an earlier
  one, logout cancels active and queued work, and a tentative credential cannot
  serve data, persist, or borrow an old account.
- Treat API data as hostile. Keep usable partial rosters where their
  completeness contract allows; schema drift must not crash or delete friends.
- Before editing `services/adapters/VrcAdapter.ts` or `VrcApiClient.ts`, read
  the VRChat contract; for `CvrAdapter.ts` or `CvrApiClient.ts`, read the CVR
  contract. Their platform rules cover those files.

## Verification

- Run the root gate and focused tests for the changed boundary. IPC changes
  need trust, validation, rate-limit, and allowlist cases. Credential changes
  need persistence, invalidation, and plaintext-absence cases. Lifecycle and
  event changes need ordering, cleanup, and consumer-isolation cases.
- Inspect the diff for secrets, raw IPC additions, `console` use, and Electron
  imports in shared code. Update the API, volatility, policy, or changelog docs
  the root matrix names.

## Child DOX Index

- [`ipc/AGENTS.md`](ipc/AGENTS.md): typed handlers, sender trust, rate limits,
  URL policy, and the preload bridge.
- [`services/adapters/vrchat/AGENTS.md`](services/adapters/vrchat/AGENTS.md):
  VRChat parsers, roster, resolvers, Pipeline, and `VrcAdapter` rules.
- [`services/adapters/cvr/AGENTS.md`](services/adapters/cvr/AGENTS.md):
  ChilloutVR parsers, roster, instance resolver, `/users/ws`, and `CvrAdapter`
  rules.
