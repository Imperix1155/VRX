# src/main/ipc — IPC handler layer

## Purpose

Maps every `IpcInvoke` channel (defined in `@shared/ipc`) to a main-process
handler. One file per domain. All handlers call `isTrustedIpcSender` first.

## Ownership

- `security.ts` — `isTrustedIpcSender()`: dev=origin-exact, prod=file://+top-frame (VRX-25).
- `friends.ts` / `friends.test.ts` — `get-friends`: captures a LocationAuthority revision before adapter delegation and seeds every successful roster response; failed responses never seed (VRX-166).
- `avatar.ts` / `avatar.test.ts` — `get-avatar`: shape-validates the URL request and rejects strings over 2,048 characters after the sender guard, delegates to the main-process avatar cache, and returns a CSP-safe `data:` URL result or `null` (VRX-48).
- `auth.ts` — `get-auth-status`, `login`, `verify-2fa`, `logout`: delegates to adapter. `login` shape-validates the payload before use — `username`/`password` must be strings and `twoFactorCode`, when present, must be a string (audit W3) — and is never logged (VRX-20); `verify-2fa` (VRX-159) takes only `{code}` and routes to `adapter.verify2fa`, so the renderer completes the 2FA leg via the session cookie without resending/holding the password. `logout` (VRX-191) sender-guards first, validates the platform, then calls `adapter.clearSession()`. `registerAuthHandlers` retains an optional `onLoginSuccess(platform)` callback for callers/tests; production account-boundary alert resets are wired directly through the adapters so non-IPC boundaries receive the same reset (VRX-84).
- `accounts.ts` — `get-accounts`: stub returning `[]` until VRX-24 lands the AccountStore.
- `instance.ts` / `instance.test.ts` — friendId-only `join-instance` and VRChat-only `self-invite` (VRX-166). Both sender-guard and shape-validate before resolving through LocationAuthority and the shared joinability predicate. Join alone calls the adapter's pure URL builder, final-validates via `isAllowedLaunchUrl`, then applies a per-platform in-flight lock + 3s cooldown before `shell.openExternal`. Expected denials return typed reasons; logs contain platform + reason only, never location.
- `app-status.ts` — `get-app-status`: stub returning all-'ok' until VRX-79/146/147 wire WS health (VRX-20).
- `launch.ts` / `launch.test.ts` — renderer-facing `open-url` is HTTPS-only through `isAllowedUrl`; custom game schemes are unreachable from this path (VRX-166).
- `settings.ts` — `get-settings`, `save-settings` (VRX-184): thin wiring over `services/settings.ts`. The save patch is shape-validated (plain object only — a spread string/array would smear indices); field validation is `parseSettings`' job downstream. The service's newer-version rollback refusal propagates as a rejected invoke — deliberate (the renderer stays dirty and keeps working in-memory).
- `settings.test.ts` — handler boundary tests (VRX-184): guard rejection on both channels, the patch shape table, delegation, and the newer-version refusal propagating.
- `url-allowlist.ts` — pure predicates, no electron imports. `isAllowedUrl()` is the HTTPS+known-host renderer/web-link gate. `isAllowedLaunchUrl()` is called only by `join-instance` and exact-validates the VRChat `vrchat://launch` or CVR `chilloutvr://instance/join` grammar: lowercase scheme/host/path, no userinfo/port/fragment, exact parameter-name allowlists, bounded strict values (VRX-166).
- `url-allowlist.test.ts` — unit tests for the allowlist predicate (VRX-20; W6 added Cyrillic-homoglyph + protocol-relative denials).
- `security.test.ts` — unit tests for `isTrustedIpcSender` (audit W6 — the guard on every channel finally has coverage): dev exact-origin incl. the `localhost:5173.evil.com` prefix-spoof, port/scheme mismatch, unset-env fail-closed, malformed URLs; prod top-frame-file:// incl. the subframe rejection. Mocks `@electron-toolkit/utils` (`is.dev` is read per call).
- `auth.test.ts` — handler boundary tests (audit W6): captures handlers via a mocked `ipcMain.handle`, then drives them with hostile payloads — untrusted sender, bad platform, non-string credentials/twoFactorCode (the W3 pin), no-adapter platform — plus happy-path delegation. Uses `stubPlatformAdapter` from the adapters' `__testutils__/adapterTestKit`.
- `index.ts` — `registerIpcHandlers(adapters, options)`: wires all handlers; options carry the required LocationAuthority, instance clock/logger, and optional `onLoginSuccess` callback (VRX-84/166); imported once in `src/main/index.ts`.
- **Push channel `'friend-event'`** (typed in `@shared/ipc` `IpcEvents`) is LIVE as of VRX-146: main broadcasts normalized `AdapterEvent`s via `webContents.send`; the preload exposes `onFriendEvent(cb) → unsubscribe`; the renderer applies them to the TanStack cache. Push-only — no sender guard applies (main → renderer direction).

## Local Contracts

- `isTrustedIpcSender` must be the FIRST call in every `ipcMain.handle` callback.
- `url-allowlist.ts` must stay pure (no electron imports) — it is unit-tested in isolation.
- `isAllowedLaunchUrl` is private to the trusted friendId join path; never re-expose custom schemes through `open-url`.
- `accounts.ts` and `app-status.ts` are explicit stubs: do not expand them without the owning issue (VRX-24, VRX-79).
- Deferred channels (`get-notifications`, `launch-app`) have no handler yet — add them when their owning issue ships (M3 notifications, VRX-98).
- `login` credentials are never logged or echoed back — the electron-log redaction hook (VRX-15) covers the adapter layer, but the handler must not introduce new log points.
