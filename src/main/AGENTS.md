# src/main — Electron main process

## Purpose
The Electron main process: app lifecycle, windows, IPC handlers, platform adapters, and node-privileged services.

## Ownership
- `index.ts` — app bootstrap + main window; wires adapter registry and IPC handlers on `app.whenReady`, and loads persisted settings at startup.
- `logger.ts` — electron-log setup (file transport, level, redaction hook).
- `redact.ts` — pure credential scrubber for log arguments.
- `updater.ts` — electron-updater wiring to GitHub Releases; checks once on startup, packaged builds only (VRX-11).
- `services/adapters/IPlatformAdapter.ts` — the platform adapter interface (VRX-16): the contract VRChat/CVR adapters implement; stream-aware via `subscribe()`.
- `services/adapters/errors.ts` — structured error types (VRX-17/55): generic `AuthError`, `RateLimitError`, `NetworkError` plus CVR-specific subclasses. Main-process only; no electron imports.
- `services/adapters/BaseAdapter.ts` — abstract base class (VRX-17): all real platform adapters extend this. Provides `protected request<T>(url, schema, options?)` with atomically reserved rate-limit slots (1 req/sec + jitter), a shared 429 cooldown queue that honors `Retry-After`, `AbortSignal.timeout`, `redirect:'error'`, exponential fallback backoff, Zod validation, and a circuit breaker (opens after 3 consecutive non-429 failures; resets on success or after 60s). Inject `sleepFn` in constructor for unit tests. **Does not import electron** — pure Node, unit-testable.
- `services/adapters/BaseAdapter.test.ts` — unit tests for `BaseAdapter` infrastructure (VRX-17): rate limiting, 429 backoff, circuit breaker, error classification, Zod validation.
- `services/adapters/VrcApiClient.ts` — low-level VRChat HTTP client (VRX-41): abstract subclass of `BaseAdapter` adding `protected get`/`post` against `VRC_API_BASE` with the auth cookie (in-memory, set after login — VRX-42) + VRChat `User-Agent`. The chain is `BaseAdapter → VrcApiClient → VrcAdapter` (the concrete IPlatformAdapter impl, later). Reuses the generic `errors.ts` types (not VRC-prefixed).
- `services/adapters/VrcApiClient.test.ts` — unit tests for the client delta (VRX-41): URL = base+path, cookie/User-Agent headers, POST JSON body, 401→`AuthError`.
- `services/adapters/CvrApiClient.ts` — low-level ChilloutVR HTTP client (VRX-55): abstract `BaseAdapter` subclass with clearable in-memory `Username`/`AccessKey` credentials, CVR headers, validated `{ message, data }` envelope unwrapping, typed CVR errors, and separate password-login/access-key re-auth helpers. Does not persist credentials.
- `services/adapters/CvrApiClient.test.ts` — unit tests for CVR headers, envelope validation, auth flows, typed errors, and 429 retry behavior (VRX-55).
- `services/adapters/FakeVrcAdapter.ts` — development stub returning hardcoded VRChat friends; implements `IPlatformAdapter` directly (NOT via `BaseAdapter` — it makes no HTTP calls). Replaced when the real `VrcAdapter` lands.
- `services/settings.ts` — electron-store-backed settings persistence (VRX-23): `loadSettings()` (migrate + validate on read, then persist the normalized form back) and `saveSettings(patch)`. Schema/migration/defaults live in `@shared/settings`; this is the thin wiring. electron-store@11 is ESM-only, so it is **bundled** into the main process (not externalized) via `externalizeDepsPlugin({ exclude: ['electron-store'] })` in `electron.vite.config.ts` — a CJS `require()` of it would throw at runtime.
- `services/credentials.ts` — main-only credential persistence (VRX-34): encrypts values with Electron `safeStorage`, stores only base64-encoded encrypted blobs in the `credentials` electron-store, and exposes save/load/delete operations for main-process auth and logout flows.
- `ipc/` — all `IpcInvoke` channel handlers; see [`ipc/AGENTS.md`](ipc/AGENTS.md) for the full index (VRX-19/20/25).
- `platform/` — placeholder until real platform adapters land.
- `src/preload/index.ts`, `src/preload/index.d.ts` — `window.vrx` bridge: exposes typed IPC invoke helpers via `contextBridge`; `index.d.ts` declares the global so the renderer sees types without any import. Owned here because the preload is a main-process artifact and its contract is defined by the IPC channels in this directory (VRX-19).

## Local Contracts
- Security trinity on every BrowserWindow / IPC surface: `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`; `isTrustedIpcSender` guard on every handler; `safeStorage` for creds; URL allowlist before `shell.openExternal`; no `unsafe-inline` CSP; renderer never sees raw tokens (full rules in CLAUDE.md). Trinity applied in VRX-25.
- NO `console.*` — log through the `logger.ts` electron-log instance; everything routes through the redaction hook. Never log credentials/tokens/PII.
- No hardcoded paths — use `app.getPath()`.
- `redact.ts` MUST stay pure (no electron imports) so it remains unit-testable in isolation.
- Never write to VRCX/CVRX folders.
- Credential values must enter and leave persistence only through `services/credentials.ts`; never expose `loadCredential()` through IPC or log its inputs/outputs. Credential keys are runtime-allowlisted and dot notation stays disabled. Encryption unavailability must fail closed, and Linux must also reject Electron's `basic_text` storage backend even when `isEncryptionAvailable()` is true; deletion remains available.

## Work Guidance

## Verification
`npm run typecheck && npm run lint && npm test`

## Child DOX Index
- [`ipc/AGENTS.md`](ipc/AGENTS.md) — all IPC handler files (10 files, VRX-19/20/25)
- `services/adapters/` — adapter interface, shared HTTP base, VRChat/CVR API clients, errors, and fake adapter (9 files, VRX-16/17/41/55); no child doc yet. Add one when a concrete platform adapter lands.
- [`services/adapters/vrchat/AGENTS.md`](services/adapters/vrchat/AGENTS.md) — pure VRChat parsers/builders: presence, instance-type, trust-rank, join-URL (VRX-44/45/49/50).
