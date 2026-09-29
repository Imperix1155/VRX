# src/main/ipc

## Purpose

Implement the narrow, typed renderer-to-main boundary. `index.ts` registers
handlers; domain files validate requests and call main-owned services.

## Ownership

- [`@shared/ipc`](../../../src/shared/ipc.ts) is the source of truth for invoke,
  notification, and push types. [`docs/INTERNAL-API.md` sections 1-3](../../../docs/INTERNAL-API.md)
  list callable contracts and event meanings.
- `index.ts` is the only registration point. It owns the trust-first,
  per-channel limiter shell and removes unused third-party listener bootstrap.
- Domain modules own handler-specific request validation. `security.ts` owns
  sender admission; `url-allowlist.ts` owns pure renderer-link and main-built
  launch URL validation.
- Preload exposes only typed bridge methods and subscriptions. It may normalize
  the documented `rate_limited` error but must not add authority or policy.

## Local Contracts

- Every handler calls `isTrustedIpcSender` first. Register it through the
  `index.ts` shell before its limiter. Deny malformed, oversized, unknown, and
  stale requests without logging sensitive request data.
- Keep push channels main-to-renderer only. Do not make a push event callable
  from the renderer, and unsubscribe listeners in preload.
- Main owns account identity, session epoch, location authority, settings,
  action policy, opaque references, and final URL construction. A renderer may
  submit `expectedTarget` world and instance IDs only for comparison with the
  current main-owned location. It never supplies URL authority.
- `join-instance` checks the main-owned allow-join setting before lookup or URL
  building, compares `expectedTarget`, checks joinability, validates the
  main-built URL, then launches under the shared coordinator. `self-invite` has
  its own lock and cooldown. Keep denial logs to platform and reason.
- `open-url` accepts only allowlisted HTTPS web links. Custom game schemes are
  reachable only from main-owned join paths after strict URL validation.
- `get-avatar` admits only a bounded URL string and delegates to `AvatarCache`.
  Return its CSP-safe `data:` result or `null`; do not expose fetch, cookies,
  redirects, or vendor image URLs to the renderer as an authority.
- Authentication handlers never log or return credentials. Complete 2FA with
  the adapter's pending session, not a resent password. Failure paths that
  clear auth must preserve the typed session-cleared result contract.
- Route `login` and `verify-2fa` by the validated request platform. A direct
  CVR login is a normal authentication path; do not hardcode VRChat at this
  boundary or require the app's initial screen to choose the platform.
- `get-app-status` returns `AppStatusService.snapshot()`. Do not replace this
  live connection and reconcile status with a fixed success value.
- Account-scoped reads and writes capture a main-owned lease and recheck it
  before mutation. A stale account or epoch returns the documented stale result,
  never writes across accounts.
- Rate limits are timer-free sliding windows with a monotonic clock. Keep the
  per-channel policy table, warning suppression, and error mapping in one
  place. Do not return retry timing or request payloads to the renderer.

## Work Guidance

- Add a channel only when no catalogued channel fits. Change `@shared/ipc`,
  preload types, registration, handler tests, and `docs/INTERNAL-API.md`
  together.
- Keep URL predicates pure and test them without Electron. Keep IPC handlers
  thin; put persistence, network, cache, and account-transition policy in
  services.
- Preserve roster completeness and location revisions through `get-friends`.
  Only a complete roster may reconcile missing friends. Partial results preserve
  cached omissions; failed reads do not seed authority.
- Settings reads migrate and validate in main. A save must reject a newer-file
  overwrite or durable-write failure so the renderer does not report an
  unsaved preference as durable.
- Explore accepts only bounded main-issued opaque references. It delegates
  discovery, admission, caching, and launch decisions to `ExploreService`.

## Verification

- Follow `docs/DEVELOPMENT.md` and `docs/REVIEW.md`. Run focused handler tests
  and `ipc/index.test.ts` when registration changes.
- Exercise trusted and untrusted senders, invalid request shapes, stale account
  leases, rate limits, and denial paths that apply to the changed handler.
  URL or launch changes need exact allowlist and target-mismatch tests.
- Confirm registration enumerates only the typed expected channels and no
  handler leaks credentials, raw errors, locations, or URLs in logs.

## Child DOX Index

No child contracts. Each handler file is one domain under this contract.
