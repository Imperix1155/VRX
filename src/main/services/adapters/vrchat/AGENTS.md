# src/main/services/adapters/vrchat — VRChat parsers & builders

## Purpose
Pure, stateless VRChat-specific transforms that the (future) `VrcAdapter` composes:
each takes raw VRChat API shapes → typed VRX model values. No electron/node imports,
no HTTP, no I/O — unit-testable in isolation. Built in parallel (VRX-44/45/49/50).

## Ownership
- `parsePresence.ts` — `parsePresence(friend, buckets)` → `{ state, status, statusDescription }` (VRX-44). `state` is DERIVED from the current-user friend-bucket arrays (`onlineFriends`→`'in-game'`, `activeFriends`→`'active'`, else `'offline'`), NOT a field. `status` maps the VRChat status string; unknown → `'online'`. DESIGN.md §5 — never conflate state (the dot) with status (the pill).
- `parseInstanceType.ts` — `parseInstanceType(instanceId)` → the 8-type VRChat taxonomy (`public`/`friends-plus`/`friends`/`invite`/`invite-plus`/`group-public`/`group-plus`/`group`), plus a documented `OpennessTier` mapping (VRX-45). Never throws — malformed/empty → `'public'`.
- `parseTrustRank.ts` — `parseTrustRank(tags[])` → `TrustRank` (VRX-49). Offset tag→rank map (`system_trust_veteran`→`'trusted'`, …), highest wins, `system_probable_troll`→`'nuisance'` wins, no tag → `'visitor'`.
- `buildJoinUrl.ts` — `buildJoinUrl(worldId, instanceId, region?)` → `vrchat://launch?...` URL or `null` (VRX-50). Built by string concat (NOT `URL()`) so the instanceId's `~()` tags aren't percent-encoded. ⚠️ **Follow-up:** `isAllowedUrl` (`src/main/ipc/url-allowlist.ts`) permits only `https:`, so a `vrchat:` URL is currently rejected by `open-url` — the launch path must be taught the `vrchat:` scheme before this is wired up.

## Local Contracts
- PURE functions only — no electron/node imports, no side effects. Importable + testable in isolation.
- Defensive parsing — unknown enum/tag/suffix values degrade gracefully, never throw (CLAUDE.md API etiquette).
- Read shared types from `@shared/types`; do not redefine the canonical model here.

## Verification
`npm run typecheck && npm run lint && npm test`
