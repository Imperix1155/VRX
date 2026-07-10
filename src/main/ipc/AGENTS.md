# src/main/ipc — IPC handler layer

## Purpose

Maps every `IpcInvoke` channel (defined in `@shared/ipc`) to a main-process
handler. One file per domain. All handlers call `isTrustedIpcSender` first.

## Ownership

- `security.ts` — `isTrustedIpcSender()`: dev=origin-exact, prod=file://+top-frame (VRX-25).
- `friends.ts` — `get-friends`: delegates to the platform adapter (VRX-19/20).
- `avatar.ts` — `get-avatar`: shape-validates the URL request after the sender guard, delegates to the main-process avatar cache, and returns a CSP-safe `data:` URL result or `null` (VRX-48).
- `auth.ts` — `get-auth-status`, `login`, `verify-2fa`: delegates to adapter. `login` shape-validates the payload before use — `username`/`password` must be strings and `twoFactorCode`, when present, must be a string (audit W3) — and is never logged (VRX-20); `verify-2fa` (VRX-159) takes only `{code}` and routes to `adapter.verify2fa`, so the renderer completes the 2FA leg via the session cookie without resending/holding the password.
- `accounts.ts` — `get-accounts`: stub returning `[]` until VRX-24 lands the AccountStore.
- `instance.ts` — `join-instance`, `self-invite`: delegates to adapter (VRX-20).
- `app-status.ts` — `get-app-status`: stub returning all-'ok' until VRX-79/146/147 wire WS health (VRX-20).
- `launch.ts` — `open-url`: validates via `isAllowedUrl() || isAllowedLaunchUrl()` before `shell.openExternal`; accepts both HTTPS web links and VRChat desktop-launch URLs (VRX-20/161).
- `settings.ts` — `get-settings`, `save-settings` (VRX-184): thin wiring over `services/settings.ts`. The save patch is shape-validated (plain object only — a spread string/array would smear indices); field validation is `parseSettings`' job downstream. The service's newer-version rollback refusal propagates as a rejected invoke — deliberate (the renderer stays dirty and keeps working in-memory).
- `settings.test.ts` — handler boundary tests (VRX-184): guard rejection on both channels, the patch shape table, delegation, and the newer-version refusal propagating.
- `url-allowlist.ts` — `isAllowedUrl()`: pure HTTPS+known-host predicate; no electron imports (VRX-20). Also exports `isAllowedLaunchUrl()`: permits `vrchat://launch?id=wrld_…` strictly — `vrchat:` scheme only, hostname must be exactly `launch`, no userinfo/port, `id` param must start with `wrld_`; all other schemes remain rejected (VRX-161). The two predicates are intentionally separate so `setWindowOpenHandler` (web links) never accepts a custom scheme.
- `url-allowlist.test.ts` — unit tests for the allowlist predicate (VRX-20; W6 added Cyrillic-homoglyph + protocol-relative denials).
- `security.test.ts` — unit tests for `isTrustedIpcSender` (audit W6 — the guard on every channel finally has coverage): dev exact-origin incl. the `localhost:5173.evil.com` prefix-spoof, port/scheme mismatch, unset-env fail-closed, malformed URLs; prod top-frame-file:// incl. the subframe rejection. Mocks `@electron-toolkit/utils` (`is.dev` is read per call).
- `auth.test.ts` — handler boundary tests (audit W6): captures handlers via a mocked `ipcMain.handle`, then drives them with hostile payloads — untrusted sender, bad platform, non-string credentials/twoFactorCode (the W3 pin), no-adapter platform — plus happy-path delegation. Uses `stubPlatformAdapter` from the adapters' `__testutils__/adapterTestKit`.
- `index.ts` — `registerIpcHandlers(adapters)`: wires all handlers; imported once in `src/main/index.ts`.
- **Push channel `'friend-event'`** (typed in `@shared/ipc` `IpcEvents`) is LIVE as of VRX-146: main broadcasts normalized `AdapterEvent`s via `webContents.send`; the preload exposes `onFriendEvent(cb) → unsubscribe`; the renderer applies them to the TanStack cache. Push-only — no sender guard applies (main → renderer direction).

## Local Contracts

- `isTrustedIpcSender` must be the FIRST call in every `ipcMain.handle` callback.
- `url-allowlist.ts` must stay pure (no electron imports) — it is unit-tested in isolation.
- `accounts.ts` and `app-status.ts` are explicit stubs: do not expand them without the owning issue (VRX-24, VRX-79).
- Deferred channels (`get-notifications`, `launch-app`) have no handler yet — add them when their owning issue ships (M3 notifications, VRX-98).
- `login` credentials are never logged or echoed back — the electron-log redaction hook (VRX-15) covers the adapter layer, but the handler must not introduce new log points.
