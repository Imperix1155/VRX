# src/main/ipc

## Purpose

The narrow, typed renderer-to-main boundary. `index.ts` registers every
handler; each domain file validates its requests and calls main-owned
services. Persistence, network, cache and account-transition policy stay in
services.

## Ownership

- [`@shared/ipc`](../../shared/ipc.ts) defines invoke, notification and push
  types. The catalog's
  [IPC section](../../../docs/internal-api/2-ipc-channels.md) lists each
  channel, its input, result and budget.
- `index.ts` is the only registration point. It wraps each handler as sender
  check, then per-channel limiter, then domain handler, guards the
  `renderer-hydrated` notification the same way, and removes electron-store's
  unused `electron-store-get-data` listener.
- `security.ts` owns `isTrustedIpcSender`, `rate-limit.ts` owns budgets and
  denial shapes, and `url-allowlist.ts` owns the pure `isAllowedUrl` and
  `isAllowedLaunchUrl` predicates.
- The preload bridge ([`index.ts`](../../preload/index.ts),
  [`index.d.ts`](../../preload/index.d.ts)) exposes typed methods and
  subscriptions only. It may normalize the `rate_limited` error, adds no
  authority or policy, and every subscription returns an unsubscribe.

## Local Contracts

- **Trust.** Every handler first calls `isTrustedIpcSender(event.senderFrame)`
  and throws for an untrusted sender; the `index.ts` shell repeats the check
  before the limiter so untrusted calls never spend the budget. Dev trusts the
  exact `ELECTRON_RENDERER_URL` origin. Built runs trust only the top-level
  `out/renderer/index.html` under the app path, never another file or a
  subframe.
- **Validation.** Check shape before use: allowlisted platform, string types,
  length caps, rejected prototype keys, strict zod schemas where a domain has
  them. Log no request data; denial logs carry platform and reason only.
- **Budgets.** Every invoke and notification channel has an
  `IPC_RATE_LIMIT_BUDGETS` entry (`satisfies` enforces it). Windows are
  timer-free and monotonic and warn once per window. Action channels return
  their typed denial (`{ ok: false, reason: 'rate-limited' }`); query channels
  throw `rate_limited`. Never return retry timing or payloads.
- **Push channels** are main-to-renderer only. Never make one callable.
- **Authority.** The renderer never names an account, a world ID to act on, a
  launch URL or a file path. Writes accept only a platform, bounded IDs main
  already knows (a friend, a listed search result, an inbox row, an issued
  world reference, a listed avatar) and the user's text, and delegate to the
  owning service, which decides who may be acted on and paces the write.
  Account-scoped reads and writes capture a main-owned epoch or lease and
  recheck it before mutation; a stale request gets `stale` and never writes
  across accounts.
- **Join.** `join-instance` order: allow-join setting, `LocationAuthority`
  lookup, `isFriendJoinable`, `expectedTarget` comparison by `hotInstanceKey`
  (never launch input), adapter URL build, `isAllowedLaunchUrl`, then
  `GameHandoff.deliver` under `JoinCoordinator`. The Join captures the
  signed-in account first and `deliver` rechecks it after each wait; a changed
  account gets `stale` and nothing launches. `self-invite` is VRChat-only, has
  its own lock and 3 s cooldown, and refuses a public instance.
- **Links.** `open-url` opens only `isAllowedUrl` HTTPS links. Game schemes
  are reachable only from main-built join paths. `open-logs-folder`,
  `open-bug-report`, `test-vr-alert` and the `*-app-background` channels take
  no input; their results carry typed reasons, never paths or error text.
- **Local-only channels.** Inbox, Activity, local favorites, alert picks,
  linked profiles and settings never reach a platform.
- **Auth.** `login` and `verify-2fa` route by the validated platform and never
  log or return credentials. `import-session` takes only a platform and runs
  the injected importer. `logout` runs `onLogout` only after `clearSession()`
  succeeded and logs a throwing callback instead of failing the sign-out.
- **Roster.** `get-friends` seeds `LocationAuthority` before returning. Only a
  complete roster may reconcile missing friends; a failed read seeds nothing.
  VRChat replies carry provenance (base revision, `coveredIds`, follow-up
  override IDs). Admission limits and queue overflow surface as
  `rate_limited`.
- **Settings.** `save-settings` accepts only a plain-object patch and rejects
  a newer-file or failed write, so the renderer never reports an unsaved
  preference as saved. `get-settings` marks a pending save as `unsaved`.
- `get-avatar` takes a length-capped URL, delegates to `AvatarCache` and
  returns a `data:` result or `null`. It never exposes fetch, cookies or
  redirects.

## Work Guidance

- Add a channel only when no catalogued channel fits. Change `@shared/ipc`,
  preload `index.ts` and `index.d.ts`, registration, the budget table, handler
  tests, the design guide's `fixture-bridge.ts` and the catalog together.
- Keep URL predicates pure and tested without Electron. `get-app-status`
  returns the live `AppStatusService.snapshot()`, never a fixed value.

## Verification

- Run the changed handler's tests, plus `index.test.ts` and
  `src/preload/index.test.ts` when registration or the bridge changes, then
  the root gate.
- Cover trusted and untrusted senders, invalid shapes, stale leases, rate
  limits and denial paths. URL or launch changes need exact allowlist and
  target-mismatch cases.
- Confirm no handler leaks credentials, raw errors, locations or URLs in logs.

## Child DOX Index

No child contracts. Each handler file is one domain under this contract.
