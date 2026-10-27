# src/main/ipc

## Purpose

The narrow, typed renderer-to-main boundary. `index.ts` registers every
handler; each domain file validates its requests and calls main-owned services.
Persistence, network, cache, and account-transition policy stay in services.

## Ownership

- [`@shared/ipc`](../../shared/ipc.ts) defines invoke, notification, and push
  types. [`docs/INTERNAL-API.md`](../../../docs/INTERNAL-API.md) catalogs each
  channel and event.
- `index.ts` is the only registration point. It wraps each `ipcMain.handle` as
  sender check, then per-channel limiter, then domain handler; guards the
  `renderer-hydrated` notification the same way; and removes electron-store's
  unused `electron-store-get-data` listener.
- `security.ts` owns `isTrustedIpcSender`. `rate-limit.ts` owns budgets and
  denial shapes. `url-allowlist.ts` owns the pure `isAllowedUrl` and
  `isAllowedLaunchUrl` predicates.
- The preload bridge ([`index.ts`](../../preload/index.ts),
  [`index.d.ts`](../../preload/index.d.ts)) exposes typed methods and
  subscriptions only. It may normalize the `rate_limited` error. It adds no
  authority or policy, and every subscription returns an unsubscribe.

## Local Contracts

- Every handler first calls `isTrustedIpcSender(event.senderFrame)` and throws
  for an untrusted sender. The `index.ts` shell repeats the check before the
  limiter so untrusted calls never spend the trusted budget. Dev trusts the
  exact `ELECTRON_RENDERER_URL` origin. Packaged and built-preview runs trust
  only the top-level `out/renderer/index.html` under the app path; never admit
  another local file or a subframe.
- Validate shape before use: allowlisted platform, string types, length caps,
  and rejected prototype keys. Explore and links use strict zod schemas. Log no
  request data; denial logs carry platform and reason only.
- Every invoke and notification channel has an `IPC_RATE_LIMIT_BUDGETS` entry
  (`satisfies` enforces it). Windows are timer-free, use a monotonic clock, and
  warn once per window. Action channels return their typed denial; query
  channels throw `rate_limited`. Never return retry timing or payloads.
- Push channels are main-to-renderer only. Never make one callable.
- `join-instance` order: allow-join setting, `LocationAuthority` lookup,
  `isFriendJoinable`, `expectedTarget` comparison by `hotInstanceKey` (never
  launch input), adapter URL build, `isAllowedLaunchUrl`, then launch under
  `JoinCoordinator`.
  `self-invite` is VRChat-only with its own in-flight lock and 3 s cooldown.
- `get-inbox`, `dismiss-inbox-item` and `clear-inbox` are local to VRX: they
  read or hide rows in `InboxService` and never reach a platform. Item IDs are
  pattern- and length-checked; `clear-inbox` takes one or two allowlisted
  platforms.
- `open-url` opens only `isAllowedUrl` HTTPS links. Game schemes are reachable
  only from main-built join paths. `open-logs-folder` takes no input.
- `get-activity` and `clear-activity` take no input and only read or clear
  `ActivityFeed`; neither makes a platform request.
- `get-avatar` accepts a length-capped URL string, delegates to `AvatarCache`,
  and returns a `data:` result or `null`. It never exposes fetch, cookies, or
  redirects.
- The `*-app-background` channels take no input. `choose-app-background`
  opens main's own dialog and imports only the path it returns; a press while
  it is open joins that dialog. Results carry typed reasons, never paths.
- Auth handlers route `login` and `verify-2fa` by the validated platform; a
  direct ChilloutVR login is a normal path. They never log or return
  credentials. 2FA completes the adapter's pending session from the code
  alone. Failures that clear auth keep the typed `sessionCleared` result.
  `import-session` takes only a validated platform and runs the injected
  importer; success runs the same `onLoginSuccess` as `login`. `logout` runs
  `onLogout` only after `clearSession()` succeeded, and logs a throwing
  callback instead of failing the sign-out.
- Account-scoped reads and writes (notes, linked profiles) capture a
  main-owned epoch or lease and recheck it before mutation. A stale request
  gets the documented `stale` result and never writes across accounts.
- `get-friends` seeds `LocationAuthority` before returning and passes the
  authority's merged rows to alerts. Only a complete roster may reconcile
  missing friends; a failed read seeds nothing. VRChat replies carry
  provenance: a base revision, deduplicated `coveredIds` for partial reads, and
  follow-up override IDs, without duplicating rows or leaking rate-limit
  timing. Admission rate limits and queue overflow surface as `rate_limited`.
- `save-settings` accepts only a plain-object patch and rejects a newer-file or
  durable-write failure, so the renderer never reports an unsaved preference as
  saved. `get-settings` marks a pending save as `unsaved`.
- Explore accepts only bounded main-issued references and delegates discovery,
  admission, caching, and launch to `ExploreService`.
- Avatar library handlers accept only a platform and a bounded avatar ID and
  delegate to `AvatarLibraryService`. `switch-avatar` wears only an ID the
  current account's library listed, one at a time, with a cooldown; a denial
  keeps the `{ ok: false, reason: 'rate-limited' }` shape.

## Work Guidance

- Add a channel only when no catalogued channel fits. Change `@shared/ipc`,
  preload `index.ts` and `index.d.ts`, registration, the budget table, handler
  tests, and the catalog together.
- Keep URL predicates pure and tested without Electron. `get-app-status`
  returns the live `AppStatusService.snapshot()`, never a fixed value.

## Verification

- Follow the root gate. Run the changed handler's tests, plus
  `index.test.ts` and `src/preload/index.test.ts` when registration or the
  bridge changes.
- Cover trusted and untrusted senders, invalid shapes, stale leases, rate
  limits, and denial paths that apply. URL or launch changes need exact
  allowlist and target-mismatch cases.
- Confirm registration lists only the typed channels and no handler leaks
  credentials, raw errors, locations, or URLs in logs.

## Child DOX Index

No child contracts. Each handler file is one domain under this contract.
