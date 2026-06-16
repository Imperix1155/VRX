# src/main/ipc — IPC handler layer

## Purpose
Maps every `IpcInvoke` channel (defined in `@shared/ipc`) to a main-process
handler. One file per domain. All handlers call `isTrustedIpcSender` first.

## Ownership
- `security.ts` — `isTrustedIpcSender()`: dev=origin-exact, prod=file://+top-frame (VRX-25).
- `friends.ts` — `get-friends`: delegates to the platform adapter (VRX-19/20).
- `auth.ts` — `get-auth-status`, `login`: delegates to adapter. `login` payload is never logged (VRX-20).
- `accounts.ts` — `get-accounts`: stub returning `[]` until VRX-24 lands the AccountStore.
- `instance.ts` — `join-instance`, `self-invite`: delegates to adapter (VRX-20).
- `app-status.ts` — `get-app-status`: stub returning all-'ok' until VRX-79/146/147 wire WS health (VRX-20).
- `launch.ts` — `open-url`: validates via `isAllowedUrl()` before `shell.openExternal` (VRX-20).
- `url-allowlist.ts` — `isAllowedUrl()`: pure HTTPS+known-host predicate; no electron imports (VRX-20).
- `url-allowlist.test.ts` — unit tests for the allowlist predicate (VRX-20).
- `index.ts` — `registerIpcHandlers(adapters)`: wires all handlers; imported once in `src/main/index.ts`.

## Local Contracts
- `isTrustedIpcSender` must be the FIRST call in every `ipcMain.handle` callback.
- `url-allowlist.ts` must stay pure (no electron imports) — it is unit-tested in isolation.
- `accounts.ts` and `app-status.ts` are explicit stubs: do not expand them without the owning issue (VRX-24, VRX-79).
- Deferred channels (get-settings/save-settings, get-notifications, launch-app) have no handler yet — add them when their owning issue ships (VRX-23, M3 notifications, VRX-98).
- `login` credentials are never logged or echoed back — the electron-log redaction hook (VRX-15) covers the adapter layer, but the handler must not introduce new log points.

## Known gap (VRX-20 scope)
`src/main/index.ts:32` calls `shell.openExternal(details.url)` in `setWindowOpenHandler`
with no allowlist. The `isAllowedUrl` predicate is now available to fix this; left
intentionally untouched (VRX-20 scope is handlers only). File a follow-up to route
that call through the same guard.
