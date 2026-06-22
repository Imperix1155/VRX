# src/main/services/adapters/vrchat — VRChat parsers & builders

## Purpose
VRChat-specific transforms and fetchers that `VrcAdapter` composes. Two flavors,
both electron-free and unit-testable in isolation: (1) **pure parsers/builders**
(presence/instance-type/trust-rank/join-URL, VRX-44/45/49/50) — raw API shape →
typed VRX value, no I/O; (2) **dependency-injected fetchers** (`fetchFriends`,
`WorldResolver`) — take an injected `get`/fetch fn (never import HTTP/electron
directly), so they stay testable while doing real data work.

## Ownership
- `parsePresence.ts` — `parsePresence(friend, buckets)` → `{ state, status, statusDescription }` (VRX-44). `state` is DERIVED from the current-user friend-bucket arrays (`onlineFriends`→`'in-game'`, `activeFriends`→`'active'`, else `'offline'`), NOT a field. `status` maps the VRChat status string; unknown → `'online'`. DESIGN.md §5 — never conflate state (the dot) with status (the pill).
- `parseInstanceType.ts` — `parseInstanceType(instanceId)` → the 8-type VRChat taxonomy (`public`/`friends-plus`/`friends`/`invite`/`invite-plus`/`group-public`/`group-plus`/`group`), plus a documented `OpennessTier` mapping (VRX-45). Never throws — malformed/empty → `'public'`.
- `parseTrustRank.ts` — `parseTrustRank(tags[])` → `TrustRank` (VRX-49). Offset tag→rank map (`system_trust_veteran`→`'trusted'`, …), highest wins, `system_probable_troll`→`'nuisance'` wins, no tag → `'visitor'`.
- `buildJoinUrl.ts` — `buildJoinUrl(worldId, instanceId, region?)` → `vrchat://launch?...` URL or `null` (VRX-50). Built by string concat (NOT `URL()`) so the instanceId's `~()` tags aren't percent-encoded. ⚠️ **Follow-up:** `isAllowedUrl` (`src/main/ipc/url-allowlist.ts`) permits only `https:`, so a `vrchat:` URL is currently rejected by `open-url` — the launch path must be taught the `vrchat:` scheme before this is wired up.
- `fetchFriends.ts` — `fetchFriends(fetcher)` → `{ friends: VrcFriend[], failedPages }` (VRX-43). Dependency-injected (the `fetcher` is `VrcApiClient.get`, passed by `VrcAdapter`). Fetches `/auth/user` once for the presence buckets (degrades to all-offline on failure), then paginates online + offline passes (`offline=true|false`, `n=100`, capped at a local `MAX_FRIENDS=5000`), normalizing each raw friend via `parsePresence` + `parseTrustRank`. Never uses `console.*` (logging is the caller's job). `VrcAdapter.getFriends` throws when `failedPages>0` AND nothing was fetched.
- `WorldResolver.ts` — `new WorldResolver(fetcher, clock?)` with `resolve(worldId) → WorldMeta | null` (VRX-46). In-memory TTL cache (local `WORLD_CACHE_TTL_MS=24h`); injected fetcher + clock for testability. Defensive — null worldId / unknown / garbage / fetch throw → `null` (never throws), and nulls are not cached. Maps the API's `thumbnailImageUrl` → `WorldMeta.thumbnailUrl`. ⚠️ **Not yet wired** into `VrcAdapter.getInstanceDetails` — awaits a consumer (friend-card world name).

## Local Contracts
- Pure parsers/builders: no electron/node imports, no side effects, no I/O. Importable + testable in isolation.
- Fetchers (`fetchFriends`/`WorldResolver`): never import HTTP/electron directly — take an injected fetcher; stay electron-free + unit-testable (mock the fetcher).
- Defensive parsing — unknown enum/tag/suffix/shape values degrade gracefully, never throw (CLAUDE.md API etiquette).
- Read shared types from `@shared/types`; do not redefine the canonical model here.

## Verification
`npm run typecheck && npm run lint && npm test`
