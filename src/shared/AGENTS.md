# src/shared — Shared cross-process layer

## Purpose
The common data model and constants shared across the main, preload, and renderer processes — the contract the whole app normalizes into.

## Ownership
- `types.ts` — the `Friend` model and all enums (platform, presence state, status, openness, trust, linking).
- `constants.ts` — API bases, WebSocket URLs, timeouts, cache TTLs, limits.

## Local Contracts
- MUST stay PURE: no `electron` or `node` imports. This layer bundles into the sandboxed renderer — types and plain values only.
- String-literal unions, not `const enum` (esbuild-safe, Zod-friendly).
- Imported via the `@shared` alias (wired in all three electron-vite builds + both tsconfigs).
- Presence is two axes — `presence` (the state dot) vs `status` (the VRChat pill); never conflate (DESIGN.md §5).

## Work Guidance

## Verification
`npm run typecheck && npm run lint && npm test`

## Child DOX Index
No children.
