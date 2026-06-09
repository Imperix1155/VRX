# src/main — Electron main process

## Purpose
The Electron main process: app lifecycle, windows, IPC handlers, platform adapters, and node-privileged services.

## Ownership
- `index.ts` — app bootstrap + main window.
- `logger.ts` — electron-log setup (file transport, level, redaction hook).
- `redact.ts` — pure credential scrubber for log arguments.
- `ipc/`, `platform/`, `services/` — empty placeholders until their features land (IPC → VRX-18/20, adapters → VRX-16/17).

## Local Contracts
- Security trinity on every BrowserWindow / IPC surface: `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`; `isTrustedIpcSender` guard; `safeStorage` for creds; URL allowlist before `shell.openExternal`; no `unsafe-inline` CSP; renderer never sees raw tokens (full rules in CLAUDE.md). NOTE: the current scaffold still has `sandbox:false` — corrected in VRX-25.
- NO `console.*` — log through the `logger.ts` electron-log instance; everything routes through the redaction hook. Never log credentials/tokens/PII.
- No hardcoded paths — use `app.getPath()`.
- `redact.ts` MUST stay pure (no electron imports) so it remains unit-testable in isolation.
- Never write to VRCX/CVRX folders.

## Work Guidance

## Verification
`npm run typecheck && npm run lint && npm test`

## Child DOX Index
No children yet — `ipc/`, `platform/`, `services/` get their own docs when they gain durable content.
