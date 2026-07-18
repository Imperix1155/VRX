# src/shared — Shared cross-process layer

## Purpose

The common data model and constants shared across the main, preload, and renderer processes — the contract the whole app normalizes into.

## Ownership

- `types.ts` — the `Friend` model and all enums (platform, presence state, status, openness, trust, linking, `THEMES`/`Theme`, `LABEL_SCHEMES`/`LabelScheme` — the instance-pill naming scheme, VRX-183; `FRIEND_SECTIONS`/`FriendSection` — the friends-list presence-grouping section id, `'in-game' | 'online' | 'offline'`, VRX-67) + multi-account records (`Account.platformAccountId` is the canonical platform user id; `AccountScoped<T>` is the versioned `{schemaVersion, platform, platformAccountId, data}` persistence envelope and deliberately has no person id, VRX-24) + auth (`Credentials`/`AuthStatus`/`LoginResult` — `AuthStatus.twoFactorMethod` accompanies the `needs-2fa` state for the reprompt flow, VRX-173; required `AuthStatus.accountId` is the signed-in platform identity, null unless authenticated, and never a credential-storage key, VRX-24), `JoinMode`, and the live `AdapterEvent` union — extended in VRX-146 with the `friend-offline` (userId-only — the wire carries no user object) and `friend-updated` (profile merge; consumers preserve cached presence/instance) deltas, and in VRX-147 with `presence-snapshot` (CVR's ONLINE_FRIENDS: ids+instances only, no profiles — patch-by-id, absent ⇒ offline) and `roster-changed` (trigger-only refetch).
- `ipc.ts` — the typed IPC channel contract (`IpcInvoke` request/response + `IpcEvents` push); main↔preload↔renderer derive their types from it so a bad channel/payload is a compile error (VRX-18). `identity-boundary` carries `{ platform }` from each adapter's session boundary so the renderer can reset that account-owned friends cache — it empties the mounted query (`setQueryData([])`) and invalidates it, and clears that platform's buffered presence-snapshot, rather than removing the query (removal would leave a mounted observer showing the old account) (VRX-24). Instance actions accept friend IDs only (never renderer-supplied locations) and return typed expected-denial reasons (VRX-166).
- `joinability.ts` — pure `isFriendJoinable(friend)` predicate shared by main now and renderer later: requires in-game + visible non-sentinel instance, rejects VRChat `ask-me`/`dnd` authorization statuses, and rejects CVR offline instances (VRX-166).
- `constants.ts` — API bases, WebSocket URLs, timeouts, cache TTLs, limits.
- `settings.ts` — the user-settings Zod schema (`Settings`, `DEFAULT_SETTINGS`, `SETTINGS_VERSION`=3), versioned `runMigrations` runner, and `parseSettings` — the safe load path: migrate → strip unknown keys → fall back to defaults on missing/invalid (`.catch`), never throws (VRX-23). **Every additive persisted field gets a version bump and identity migration** (VRX-85): an older build otherwise strips its unknown field and rewrites the same-version file during a downgrade round-trip, losing the user's choice; the bumped version makes that older build refuse persistence, preserving it. v1→v2 is identity-only for `notifyHotInstance` (added default-on; ALL notify* defaults later flipped OFF by VRX-205 — a default-VALUE change, no bump: persisted explicit values win); v2→v3 is identity-only for `backgroundGlow` (VRX-211, default `'standard'`; the enum's single source is `BACKGROUND_GLOWS` in `@shared/types`). Persistence lives in main (`services/settings.ts`).

## Local Contracts

- MUST stay PURE: no `electron` or `node` imports. This layer bundles into the sandboxed renderer — types and plain values only. **Lint-enforced** since the 2026-07 audit W7: `no-restricted-imports` in `eslint.config.mjs` errors on `electron` and node builtins for `src/shared/**`.
- String-literal unions, not `const enum` (esbuild-safe, Zod-friendly).
- Imported via the `@shared` alias (wired in all three electron-vite builds + both tsconfigs).
- Presence is two axes — `presence.state` (the state dot) vs `status` (the VRChat pill); never conflate (DESIGN.md §5). `Friend` is discriminated by `platform`; CVR friends must have `status`, `statusDescription`, and `trustRank` set to `null`.
- `InstanceInfo.type` is the platform-true instance type; `InstanceInfo.openness` is the normalized shared openness tier.

## Work Guidance

## Verification

`npm run typecheck && npm run lint && npm test`

## Child DOX Index

No children.
