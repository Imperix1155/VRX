# CLAUDE.md — VRX (Social VR Companion)

> Instructions for Claude (and other AI agents) working in this repository.
> Claude reads this file automatically when working in `~/dev/vrx`.
> Human contributor guide: see `docs/` (design system) and `README.md`.

## What VRX is
A local desktop Electron companion app for **VRChat** and **ChilloutVR** — like VRCX/CVRX, merged
into one. Authenticates AS THE USER on their own machine; reads only that user's social data
(friends, presence, instances, invites). NOT a bot, NOT a server, NOT a content uploader.

## Design language — the single source of truth
The full visual + interaction spec lives in **`docs/DESIGN.md`** (agent spec, MUST/NEVER rules) with
a human-rendered guide at `docs/design.html` and the living reference `docs/glass.html`.
Before touching ANY UI, read DESIGN.md. Hard rules in brief:
- Liquid-glass material; dark is default, light is a `[data-theme="light"]` override (parity, not a fork).
- **Color = meaning, never decoration.** Each meaning owns one fixed location + a non-color glyph (§5).
- Platform = blue (VRChat) / orange (ChilloutVR), carried by tint+spine+glyph only.
- Presence is TWO axes: `state` (the dot) vs `status` (the VRChat pill) — never conflate
  (`status:"active"`→Online vs `state:"active"`→not-in-game).
- All tokens/spacing come from the design tokens; never hardcode hex outside them.

## Architecture
- electron-vite + React 19 + TypeScript (strict). Three processes: `src/main`, `src/preload`, `src/renderer`.
- Cross-process shared code lives in `src/shared` (imported via the `@shared` alias). Keep it PURE —
  no `electron`/`node` imports (it bundles into the sandboxed renderer). Types + plain values only.
- Adapter pattern for the two platforms; Zustand stores; TanStack Query for fetch/cache.
- Use string-literal unions, not `const enum` (esbuild-safe, Zod-friendly).

## Security non-negotiables (every BrowserWindow / IPC PR)
`contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`; `isTrustedIpcSender` guard on every
IPC handler; `safeStorage` for all credentials; URL allowlist before `shell.openExternal`; no
`unsafe-inline` CSP; renderer never sees raw tokens. Never log credentials/tokens/PII (use electron-log).
Never write to VRCX/CVRX folders.

## API etiquette (VRChat + CVR are unofficial APIs)
- Real-time data via WebSocket (VRChat Pipeline / CVR `/users/ws`), NOT polling — polling friend status
  is the #1 cause of rate-limiting/account flags.
- 1 req/sec safe ceiling, exponential backoff, jittered intervals (never fixed clock), proper User-Agent.
- No mass-invite (= botting). Defensive parsing — unknown enum values degrade gracefully, never crash.

## Workflow rules
- **Never commit or push unless explicitly asked.** `main` is branch-protected; owner reviews + merges —
  agents never self-merge. STOP after opening a PR.
- Branch names exactly `imperix/vrx-XX-slug`; commit messages reference `vrx-XX`.
- No hardcoded `C:\`/`%APPDATA%`/`~` paths — use `app.getPath()`. No `console.log` (electron-log).
  No `any`/`@ts-ignore` without an explanation comment.
- Verify before declaring done: `npm run typecheck && npm run lint && npm run build` must pass.

## Linear
Project tracked on Linear (team VRX). Issues `VRX-N`. Release scope: `v1.0` label = ships in 1.0,
`v1.x` = deferred. M1 (Foundation) must be complete before other milestones.

**Board hygiene rule — update Linear as you go:**
- When starting work on an issue → set it to **In Progress**.
- When a PR is opened → set it to **In Review**.
- When work is confirmed done (`typecheck + lint + build` pass, PR merged) → set it to **Done**
  with a brief description of what was built/verified.
- Never leave the board stale. If you completed something and Linear still shows Backlog, fix it
  before ending the session.
- Use the Linear MCP tools (`save_issue` with `state:`) — do not ask the user to update the board
  manually unless the change requires their authorization (e.g. closing a milestone).

<!-- ───────────────────────────────────────────────────────────────────────── -->
<!-- ADD YOUR OWN NOTES BELOW THIS LINE -->

## Owner notes
<!-- Add anything you want Claude to always remember here. -->
