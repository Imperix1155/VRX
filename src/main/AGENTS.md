# src/main — Electron main process

## Purpose
The Electron main process: app lifecycle, windows, IPC handlers, platform adapters, and node-privileged services.

## Ownership
- `index.ts` — app bootstrap + main window; wires adapter registry and IPC handlers on `app.whenReady`.
- `logger.ts` — electron-log setup (file transport, level, redaction hook).
- `redact.ts` — pure credential scrubber for log arguments.
- `updater.ts` — electron-updater wiring to GitHub Releases; checks once on startup, packaged builds only (VRX-11).
- `services/adapters/IPlatformAdapter.ts` — the platform adapter interface (VRX-16): the contract VRChat/CVR adapters implement; stream-aware via `subscribe()`.
- `services/adapters/errors.ts` — structured error types (VRX-17): `AuthError`, `RateLimitError`, `NetworkError`. Main-process only; no electron imports.
- `services/adapters/BaseAdapter.ts` — abstract base class (VRX-17): all real platform adapters extend this. Provides `protected request<T>(url, schema, options?)` with rate limiting (1 req/sec + jitter), `AbortSignal.timeout`, `redirect:'error'`, 429 exponential backoff (honors `Retry-After`), Zod validation, and a circuit breaker (opens after 3 consecutive non-429 failures; resets on success or after 60s). Inject `sleepFn` in constructor for unit tests. **Does not import electron** — pure Node, unit-testable.
- `services/adapters/BaseAdapter.test.ts` — unit tests for `BaseAdapter` infrastructure (VRX-17): rate limiting, 429 backoff, circuit breaker, error classification, Zod validation.
- `services/adapters/FakeVrcAdapter.ts` — development stub returning hardcoded VRChat friends; implements `IPlatformAdapter` directly (NOT via `BaseAdapter` — it makes no HTTP calls). Replaced when real VRChat adapter lands.
- `ipc/security.ts` — `isTrustedIpcSender()` — call at the top of every `ipcMain.handle` callback (VRX-25).
- `ipc/friends.ts` — handles `get-friends`; delegates to the adapter registry (VRX-19/20).
- `ipc/index.ts` — `registerIpcHandlers(adapters)` — single entry point; imported once in `index.ts`.
- `platform/` — placeholder until real platform adapters land.
- `src/preload/index.ts`, `src/preload/index.d.ts` — `window.vrx` bridge: exposes typed IPC invoke helpers via `contextBridge`; `index.d.ts` declares the global so the renderer sees types without any import. Owned here because the preload is a main-process artifact and its contract is defined by the IPC channels in this directory (VRX-19).

## Local Contracts
- Security trinity on every BrowserWindow / IPC surface: `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`; `isTrustedIpcSender` guard on every handler; `safeStorage` for creds; URL allowlist before `shell.openExternal`; no `unsafe-inline` CSP; renderer never sees raw tokens (full rules in CLAUDE.md). Trinity applied in VRX-25.
- NO `console.*` — log through the `logger.ts` electron-log instance; everything routes through the redaction hook. Never log credentials/tokens/PII.
- No hardcoded paths — use `app.getPath()`.
- `redact.ts` MUST stay pure (no electron imports) so it remains unit-testable in isolation.
- Never write to VRCX/CVRX folders.

## Work Guidance

## Verification
`npm run typecheck && npm run lint && npm test`

## Child DOX Index
`ipc/` and `services/adapters/` have durable content; no child docs yet — `services/adapters/` now has 5 files (VRX-17 added errors.ts, BaseAdapter.ts, BaseAdapter.test.ts). Consider a child `AGENTS.md` for `services/adapters/` when a real platform adapter lands.
