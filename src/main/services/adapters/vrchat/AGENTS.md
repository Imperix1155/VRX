# src/main/services/adapters/vrchat — VRChat parsers & builders

## Purpose
VRChat-specific transforms and fetchers that `VrcAdapter` composes. Two flavors,
both electron-free and unit-testable in isolation: (1) **pure parsers/builders**
(presence/instance-type/openness/trust-rank/join-URL/location, VRX-44/45/49/50/162) — raw API shape →
typed VRX value, no I/O; (2) **dependency-injected fetchers** (`fetchFriends`,
`WorldResolver`, `fetchWorldMetadata`) — take an injected `get`/fetch fn or resolver
(never import HTTP/electron directly), so they stay testable while doing real data work.

## Ownership
- `parsePresence.ts` — `parsePresence(friend, buckets)` → `{ state, status, statusDescription }` (VRX-44). `state` is DERIVED from the current-user friend-bucket arrays (`onlineFriends`→`'in-game'`, `activeFriends`→`'active'`, else `'offline'`), NOT a field. `status` maps the VRChat status string; unknown → `'online'`. DESIGN.md §5 — never conflate state (the dot) with status (the pill).
- `parseInstanceType.ts` — `parseInstanceType(instanceId)` → the 8-type VRChat taxonomy (`public`/`friends-plus`/`friends`/`invite`/`invite-plus`/`group-public`/`group-plus`/`group`); also exports `opennessFor(type) → OpennessTier` — the canonical type-to-openness table (VRX-45/162). Never throws — malformed/empty → `'public'`.
- `parseLocation.ts` — `parseLocation(location) → InstanceInfo | null` (VRX-162). Pure parser. Returns `null` for sentinel values (`''`, `'private'`, `'offline'`, `'traveling'`) and any string without a colon (the reliable gate for real instances). For real locations splits on the first `:` into `worldId` / `instanceId`, derives `type` via `parseInstanceType`, `openness` via `opennessFor`, `isGroup` from the group-type set, and `region` from the `~region(..)` tag. `worldName`, `thumbnailUrl`, `groupName`, and `userCount` are left `null` — enrichment via `WorldResolver` is a separate step. Never throws.
- `parseTrustRank.ts` — `parseTrustRank(tags[])` → `TrustRank` (VRX-49). Offset tag→rank map (`system_trust_veteran`→`'trusted'`, …), highest wins, `system_probable_troll`→`'nuisance'` wins, no tag → `'visitor'`.
- `buildJoinUrl.ts` — `buildJoinUrl(worldId, instanceId, region?)` → `vrchat://launch?...` URL or `null` (VRX-50). Built by string concat (NOT `URL()`) so the instanceId's `~()` tags aren't percent-encoded. The `open-url` IPC handler now accepts `vrchat://launch` URLs via `isAllowedLaunchUrl` (VRX-161), so the launch path is fully wired. Note: the inline comment in `buildJoinUrl.ts` still carries the old `⚠️ Follow-up` warning — that source comment is stale but is a code change (out of this DOX pass's scope).
- `fetchFriends.ts` — `fetchFriends(fetcher)` → `{ friends: VrcFriend[], failedPages }` (VRX-43). Dependency-injected (the `fetcher` is `VrcApiClient.get`, passed by `VrcAdapter`). Fetches `/auth/user` once for the presence buckets (degrades to all-offline on failure), then paginates online + offline passes (`offline=true|false`, `n=100`, capped at a local `MAX_FRIENDS=5000`), normalizing each raw friend via `parsePresence` + `parseTrustRank`; the raw `location` field is read (defensive Zod, nullable/optional) and passed to `parseLocation` to populate `instance` — no longer always null (VRX-162). Never uses `console.*` (logging is the caller's job). `VrcAdapter.getFriends` throws when `failedPages>0` AND nothing was fetched.
- `WorldResolver.ts` — `new WorldResolver(fetcher, clock?)` with `resolve(worldId) → WorldMeta | null` (VRX-46). In-memory TTL cache (local `WORLD_CACHE_TTL_MS=24h`); injected fetcher + clock for testability. Defensive — null worldId / unknown / garbage / fetch throw → `null` (never throws), and nulls are not cached. Maps the API's `thumbnailImageUrl` → `WorldMeta.thumbnailUrl`. `WorldMeta` now includes `shortName: string | null`; companion export `worldShortLink(shortName) → string | null` converts a shortName to `https://vrch.at/<shortName>` (VRX-52). ⚠️ **Not yet wired** into `VrcAdapter.getInstanceDetails` — awaits a consumer (friend-card world name).
- `fetchWorldMetadata.ts` — `fetchWorldMetadata(worldIds, resolver, limit=CONCURRENCY_LIMIT)` → `Map<worldId, WorldMeta>` (VRX-47). Concurrency-limited batch over `WorldResolver.resolve`: dedupes ids, drops null/empty, runs at most `CONCURRENCY_LIMIT=10` resolves in flight (index-cursor promise-pool, no dependency), omits null (private/unknown) results. The resolver's TTL cache handles cross-call repeats; the dedupe here handles within-batch repeats. Intended to enrich a friend-list refresh with world names. ⚠️ **No consumer yet** (the friend-card world display).

## Local Contracts
- Pure parsers/builders: no electron/node imports, no side effects, no I/O. Importable + testable in isolation.
- Fetchers (`fetchFriends`/`WorldResolver`/`fetchWorldMetadata`): never import HTTP/electron directly — take an injected fetcher/resolver; stay electron-free + unit-testable (mock the fetcher).
- Defensive parsing — unknown enum/tag/suffix/shape values degrade gracefully, never throw (CLAUDE.md API etiquette).
- Read shared types from `@shared/types`; do not redefine the canonical model here.

## Verification
`npm run typecheck && npm run lint && npm test`
