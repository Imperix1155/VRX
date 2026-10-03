# src/main

## Purpose

Own Electron's privileged process: startup, windows, IPC registration, local
services, credentials, platform adapters, and external launches. Keep privileged state
and Node/Electron access on this side of the process boundary.

## Ownership

- `index.ts` obtains the single-instance lock before importing `app.ts`. Keep it
  Electron-only: a losing duplicate must exit before loading credentials,
  logging, sockets, or a window.
- `app.ts` wires live adapters, services, IPC, the window, tray, updater, and
  shutdown disposal. It is the composition root, not a second implementation
  of adapter or IPC policy.
- `ipc/` owns renderer-facing handlers. [`docs/INTERNAL-API.md` sections 1-3](../../docs/INTERNAL-API.md)
  define the bridge, typed channels, and live events.
- `services/` owns main-only state, persistence, policy, and coordination.
  `services/adapters/` owns platform HTTP and WebSocket integration. Its
  contracts are in [`docs/INTERNAL-API.md` sections 3, 4, and 6](../../docs/INTERNAL-API.md).
- [`../preload/index.ts`](../preload/index.ts) is part of this boundary. Its
  public bridge must remain a narrow, typed projection of `@shared/ipc`; see
  the IPC child contract.

## Local Contracts

- Keep `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  web security enabled, and untrusted renderer navigation blocked. Allow
  external URLs only through the allowlist. Do not expose game schemes through
  renderer `open-url`.
- Keep the renderer CSP and default-session permission policy restrictive. Do
  not broaden network sources or add `unsafe-inline`; deny permission requests
  except the existing sanitized clipboard write needed for local diagnostics.
- Use `isTrustedIpcSender` at every renderer-to-main entry. Validate untrusted
  shapes before use and keep all IPC types in `@shared/ipc`. New or changed
  callable channels require the matching catalog update.
- Main owns account identity, sessions, current friend locations, action
  policy, game URL construction, and `shell.openExternal`. Renderer values may
  request an action and compare an expected target, but never authorize an
  instance, URL, account, or host.
- Credentials use OS-backed `safeStorage` when available. If it is not, use
  the approved authenticated local fallback with a random installation key.
  Never use Electron `basic_text`, hardcoded keys, plaintext storage, or
  renderer-visible tokens. Clear memory and durable state when a session is
  invalidated.
- Credential persistence stays behind `services/credentials.ts`: allowlist
  credential keys, validate the authenticated owner before recording it, and
  write an invalidation marker before replacement or deletion. A failed write,
  digest mismatch, or owner mismatch fails closed and cannot revive old auth.
- Log through `electron-log` and redaction. Do not log credentials, tokens,
  friend data, URLs containing identifiers, or raw upstream payloads. Use
  `app.getPath()` for application files. Do not write VRCX or CVRX paths.
- `AvatarCache` is the only renderer image proxy. Keep HTTPS host, redirect,
  MIME, URL-length, body-size, LRU, and TTL validation; API hops share platform
  admission while CDN body work stays bounded. Send a VRChat cookie only to
  `api.vrchat.cloud`, fence cache publication to the account lease, and never
  make the renderer fetch a vendor image directly.
- Settings load through migration and validation, coalesce writes, flush before
  quit, and refuse to overwrite a newer-version file. Account, social, and
  linked-profile stores validate bounded data and account/epoch ownership before
  mutation. They write cloned, revision-checked snapshots; link-graph public
  operations reject same-realm reentry. Failed or stale writes must not corrupt
  or cross account data.
- Session importers are read-only. Bound path discovery, directory traversal,
  file size, parsing time, and accepted credential shape; reject aliases,
  symlinks, changing sources, ambiguity, and active database sidecars. Persist
  only a validated import through `services/credentials.ts` and never write a
  source directory.
- Feed each accepted adapter event to `LocationAuthority` before alerts and
  renderer fan-out. Identity boundaries clear the affected account-scoped
  authority and renderer data. One failing event consumer must not block the
  other consumers.
- Platform requests use shared admission, backoff, timeout, and circuit rules.
  One request per second is the ceiling. Prefer VRChat Pipeline and CVR
  `/users/ws`; never poll social presence or add mass actions. Unknown upstream
  values must degrade safely. Record changed API assumptions in
  [`docs/api-volatility.md`](../../docs/api-volatility.md) and policy changes in
  [`docs/api-policy.md`](../../docs/api-policy.md).
- Every physical retry reacquires admission and observes the latest shared 429
  cooldown. Cancellation, queue overflow, and a tentative session are control
  flow: stop later pages or enrichment, do not count them as circuit failures,
  and do not negative-cache them.
- Shared code stays pure. Do not add Electron or Node imports under `src/shared`.
  Avoid `any` and `@ts-ignore`; an unavoidable exception needs an explanation.
- Keep window visibility recoverable. The window must stay within its display's
  work area, tray and second-instance actions must focus the current window,
  and renderer failure recovery must not create duplicate recovery dialogs. On
  Windows and Linux, close hides to the tray until `before-quit` sets the sole
  quit flag; macOS keeps its native close behavior.
- Native friend alerts are settings-gated at dispatch and bounded in memory and
  rate. A disabled hot-instance feature suppresses hot alerts without erasing
  its saved notification preference. Alert payloads and failure logs stay free
  of private location data.
- Stable builds exclude prereleases; beta/rc builds retain the locked updater
  channel selection. No implicit channel selector or rc-to-stable promotion.
- Updates remain consent-based: no silent download, no raw updater error passed
  to the renderer, and a restart only installs a verified staged update.

## Work Guidance

- Check [`docs/INTERNAL-API.md`](../../docs/INTERNAL-API.md) before adding a
  service, event, channel, parser, or shared constant. Reuse a documented
  boundary when one exists and update its entry in the same change.
- Keep adapter transport code Electron-free and dependency-injected. Auth,
  HTTP retries, request admission, and WebSocket reconnection have one owner;
  do not duplicate them in feature code.
- Fence interactive authentication at every await. A later login supersedes an
  earlier one, logout cancels active and queued work, and tentative replacement
  credentials cannot serve data, persist an identity, or borrow an old account.
- Treat API data as hostile. Validate envelopes and individual records, preserve
  usable partial rosters where their completeness contract permits it, and do
  not turn schema drift into a crash or an absent-means-removed deletion.
- Keep game launching two-step: resolve current main-owned data, then validate
  the main-built URL immediately before launch. Do not trust a renderer-supplied
  location or URL.
- Keep lifecycle cleanup explicit: unsubscribe sockets and event wiring, stop
  visible discovery work when the window is hidden or destroyed, flush pending
  settings, and dispose owned timers and listeners on quit.

## Verification

- Follow the canonical project gate in `docs/DEVELOPMENT.md` and the
  repository review procedure in `docs/REVIEW.md`.
- Run focused unit tests for the changed boundary. IPC changes need trust,
  validation, rate-limit, and allowlist coverage as applicable. Lifecycle or
  event changes need a probe that proves ordering, cleanup, and failure
  isolation. Credential changes need persistence, invalidation, and plaintext
  absence coverage.
- Inspect the diff for exposed secrets, raw IPC additions, `console` use, and
  new Electron imports in shared code. Perform the DOX pass; update the API,
  volatility, policy, or user-visible documentation when the change requires it.

## Child DOX Index

- [`ipc/AGENTS.md`](ipc/AGENTS.md): typed renderer-to-main handlers and URL
  policy.
- [`services/adapters/cvr/AGENTS.md`](services/adapters/cvr/AGENTS.md):
  ChilloutVR parsing, discovery, and pipeline code.
- [`services/adapters/vrchat/AGENTS.md`](services/adapters/vrchat/AGENTS.md):
  VRChat parsing, metadata, and pipeline code.
