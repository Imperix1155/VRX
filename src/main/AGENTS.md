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
  logging and redaction, main-process copy (`i18n.ts`), sockets, and window
  reveal (`showGate.ts`).
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
- The window minimum is 900x670, clamped to the display work area. It reveals
  after the renderer reports hydration (3 s fallback). Second-instance and
  notification activation focus the current window, recreating it if
  destroyed; tray actions resolve the window at click time. One recovery dialog
  per window handles crashes and hangs.
- On Windows and Linux, close hides to the tray until `before-quit` sets the
  single `quitting` flag; macOS keeps native close. `before-quit` disposes
  Explore, flushes settings, and tears down adapter wiring; a throwing teardown
  must not skip the flag. Hide, minimize, close, and renderer loss stop Explore
  discovery.
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
  fails closed and cannot revive old auth.
- OS `safeStorage` comes first; the Linux `basic_text` backend counts as
  unavailable. The `localCredentialEncryption.ts` fallback is used only when OS
  encryption is unavailable or fails. An OS-protected credential that cannot be
  decrypted is never re-encrypted locally.
- Adapters persist a credential only after validating its authenticated owner.
  A failed save ends the login with `CREDENTIAL_PERSISTENCE_FAILED` and clears
  the session. Do not reintroduce a separate owner store.

**CVR session import** (`cvrImportConsent.ts`, `cvrSessionImport.ts`)

- A valid stored VRX session wins. An unreadable stored session or the
  signed-out marker skips import. Otherwise `cvrSessionImportChoice` consent
  (`ask`/`skip`/`import`) precedes any source I/O. A failed consent save is
  shown to the user and fails closed.
- Discovery is read-only and bounded in time, file size, entry and profile
  counts. Accept only local absolute paths; reject symlinks, sources that change
  during the read, XML DTD/CDATA, and ambiguous credential sets. Persist only a
  validated pair through `credentials.ts`.
- `vrcxSessionImport.ts` (not wired yet) follows the same rules: read-only,
  snapshot the VRCX database into private temp files, treat an active WAL,
  lock, or journal as VRCX running, and never create or change files in a
  VRCX folder. Wiring it needs the same consent and sign-out checks.

**Stores**

- `services/settings.ts` migrates and validates through `@shared/settings`. A
  failed normalization write keeps the parsed settings as unsaved and
  retryable, never defaults. Saves apply in memory, coalesce disk writes,
  refuse to overwrite a newer-version file, and reject failed writes. Read
  fire-time policy from `getSettingsSnapshot()`.
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

**Network and logging**

- Requests go through `BaseAdapter` and the shared per-platform
  `ApiAdmissionController`. Every physical retry reacquires admission and
  honors the latest 429 cooldown. Cancellation, queue overflow, and a tentative
  session are control flow: stop later pages or enrichment, and never count or
  negative-cache them as failures.
- Updates stay consent-based: no automatic download unless the user enabled
  `autoUpdate` (default off), install only a `downloaded` update, and send only
  typed `UpdaterFailure` codes to the renderer. Stable versions exclude
  prereleases; `-beta.N` and `-rc.N` builds keep electron-updater's channel.
- Log through `logger.ts` (redaction hook). Never log tokens, friend names,
  identifier-bearing URLs, raw payloads, or absolute paths. Use `app.getPath()`;
  `pathConvention.test.ts` rejects hardcoded user paths. Native copy goes
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
