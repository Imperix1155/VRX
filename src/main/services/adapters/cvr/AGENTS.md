# src/main/services/adapters/cvr — ChilloutVR parsers & pipeline

## Purpose

CVR-specific transforms, the friend fetcher/id extractor, and the real-time
WebSocket client, mirroring the `vrchat/` directory's contract: electron-free,
dependency-injected, unit-testable in isolation. Consumed by the concrete
`CvrAdapter` (`../CvrAdapter.ts`), now registered alongside VRChat (VRX-37/58).
A data-path 401 in `getFriends` clears the session AND emits an `auth-invalidated`
`AdapterEvent` (VRX-195) — the renderer's only signal that auth changed out of
band, so the Accounts card stops showing a stale "connected"; the shared `emit()`
fans out to `subscribers` (reused by the pipeline). A 5xx does NOT clear/emit.
The renderer auth GATE stays VRChat-first by design — CVR sign-in lives in
Settings → Accounts (owner's decision; VRX-110 wizard unifies later).

## Ownership

- `buildCvrJoinUrl.ts` — pure strict builder for the documented `chilloutvr://instance/join?instanceId=<encoded>&startInVR=<bool>` contract (VRX-166). Accepts only the official `i+` 16-6-6-8 hex id shape, percent-encodes `+` as `%2B`, maps desktop→false / vr→true, and returns null for malformed input.
- `fetchCvrFriends.ts` — `fetchCvrFriends(fetcher)` → `{ friends: CvrFriend[], skippedRecords }` (VRX-57). Pure, DI'd: ONE flat `GET /friends` (never paginated, never per-friend polled), per-entry defensive parse (a drifted entry is skipped + counted, never sinks the roster), total failure throws (no misleading `[]`). Presence initialized offline — real presence is the pipeline's job. Never logs.
- `cvrPlatformUserId.ts` — `extractCvrPlatformUserId(id)` → stable lowercased `platformUserId` from the CVR GUID (VRX-61): survives display-name changes; validates GUID shape, rejects malformed. Pure.
- `parseCvrPrivacy.ts` — `parseCvrPrivacy(privacy: string | number | null)` → `{ type, openness, isGroup }` (VRX-147). Pure parser for CVR's instance `Privacy`. The **live WS wire is a NUMERIC enum** (`PRIVACY_MAP_NUMERIC`, 0–7; `0`/`2`/`7` live-confirmed 2026-07-08, the rest from the owner's prior working app, understating on doubt); the string form (CVRX docs) is also mapped, case/punctuation-insensitive. Unknown number OR string → MOST RESTRICTIVE (`owner-must-invite`, the api-volatility convention). Never throws.
- `CvrPipeline.ts` — the CVR WebSocket client (VRX-147): extends the shared `ReconnectingPipeline` base (lifecycle/backoff/generation live there). CVR specifics: auth = `Username`/`AccessKey` (+ UA/Platform) headers on the UPGRADE handshake via the injected `headersProvider` (null with no session → wait+retry); clean JSON (NOT double-encoded); envelope accepted in BOTH casings (`ResponseType`/`responseType`). Routing: `10` **ONLINE_FRIENDS → `presence-snapshot`. LIVE-VERIFIED shape 2026-07-08: a FULL online set only on connect, then 1-entry DELTAS** — so entries **merge into a running `onlineSet`** (`IsOnline:false` evicts; cleared on reconnect via `prepareConnection`) and the FULL merged set is emitted every time (the renderer's absent-⇒-offline rule stays correct). Entries are **PascalCase** (`Id`/`IsOnline`/`Instance{Id,Name,Privacy}`, `Privacy` numeric; camelCase also accepted); ids are normalized via `extractCvrPlatformUserId` (lowercase + GUID-validate) so they **match the REST roster's ids** — non-GUID/id-less skipped, id-less `Instance` → null instance; per-entry validated (one bad entry skipped, rest survive); NO status/trust fabricated (§5). `11` FRIEND_LIST_UPDATED → `roster-changed` (trigger-only refetch); invites/requests/notifications (0/1/2/15/20/25/30/50) decoded + logged, deliberately unrouted until their features exist. BIDIRECTIONAL: `sendFriendRequest`/`acceptFriendRequest`/`declineFriendRequest`/`unfriend`/`sendInvite`/`requestInvite`/`block`/`unblock` send `{RequestType, Data}` (🟡 Data shapes mock-verified vs CVRX notes); sends while disconnected return false, never queue. No app-level keepalive (server pings ~60s; `ws` auto-pongs).
- `CvrPipeline.test.ts` — full lifecycle against a fake socket: header-auth dial, both envelope casings, snapshot mapping (real PascalCase + numeric privacy), **delta-merge (full-then-delta, set not replaced)**, `IsOnline:false` eviction, non-GUID/id-less skip, malformed-instance→null, roster trigger, unrouted/unknown/malformed tolerance, RequestType payloads, disconnected sends, null-headers wait, inherited reconnect.
- `parseCvrPrivacy.test.ts` — the verified value table + casing drift + most-restrictive unknown.
- `resolveCvrInstance.ts` — `createCvrInstanceResolver({fetcher, clock?, ttlMs?, negativeTtlMs?})` → `{ resolve(id), peek(id), clear() }` (VRX-59). Pure, DI'd instance-details resolver over `GET /instances/{id}` (id URI-encoded — VRX-51 path-injection class): returns `{instanceId, instanceName, worldId, worldName, worldImageUrl, playerCount, privacy}` — the response's **`world:{id,name,imageUrl}` object is the TRUE world identity** the WS wire lacks (shape confirmed vs CVRX source + the owner's prior app, 2026-07-10; verify live on first real session). Success TTL 5 min (`CVR_INSTANCE_TTL_MS`); failures resolve **null, never throw** + negative-cache 60 s (`CVR_INSTANCE_NEGATIVE_TTL_MS`); in-flight dedupe; `peek` = sync cache-only (`undefined` = never-resolved/expired, `null` = cached failure). Rate limiting/auth/typed errors ride the injected fetcher (`CvrApiClient.get`). **Consumed by `../CvrAdapter.ts`** (VRX-59): presence snapshots emit immediately with cache-only enrichment, then RE-EMIT enriched as resolutions land — worldId ← `world.id` (dashboard groups CVR hot cards by WORLD like VRChat), worldName ← `world.name` (no display-side suffix strip needed on resolved instances), thumbnail + userCount filled; WS `Privacy` stays authoritative for type/openness (fresher than a cached REST read). `getInstanceDetails(instanceId)` runs on the same resolver (REJECTS when unresolvable — the interface carries no null) ↻ VRX-215: **auth errors (`AuthError` subclasses) RETHROW and are NEVER negative-cached** — only genuine unavailable/private results and non-auth transient failures resolve null with the 60s negative TTL; the CvrAdapter routes rethrown auth errors through the generation-fenced session invalidation (`auth-invalidated`).
- `resolveCvrInstance.test.ts` — field mapping (clean world name/id/image/count/privacy), defensive world-less degrade, TTL + negative-TTL clock tests, in-flight dedupe, null-not-throw for NON-AUTH failures + auth-error propagation (VRX-215), URI-encoded path, peek's tri-state.

## Local Contracts

- Same as `vrchat/`: no electron imports; injected socketFactory/headers/log; defensive parsing — unknown values degrade, never throw; CVR has NO status/trust (§5) — never fabricate them.
- The shared lifecycle machinery lives in `../ReconnectingPipeline.ts` — don't fork it; extend it.

## Verification

`npm run typecheck && npm run lint && npm test`
