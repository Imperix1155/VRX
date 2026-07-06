# src/main/services/adapters/cvr — ChilloutVR parsers & pipeline

## Purpose
CVR-specific transforms, the friend fetcher/id extractor, and the real-time
WebSocket client, mirroring the `vrchat/` directory's contract: electron-free,
dependency-injected, unit-testable in isolation. Consumed by the concrete
`CvrAdapter` (`../CvrAdapter.ts`), now registered alongside VRChat (VRX-37/58).
The renderer auth GATE stays VRChat-first by design — CVR sign-in lives in
Settings → Accounts (owner's decision; VRX-110 wizard unifies later).

## Ownership
- `fetchCvrFriends.ts` — `fetchCvrFriends(fetcher)` → `{ friends: CvrFriend[], skippedRecords }` (VRX-57). Pure, DI'd: ONE flat `GET /friends` (never paginated, never per-friend polled), per-entry defensive parse (a drifted entry is skipped + counted, never sinks the roster), total failure throws (no misleading `[]`). Presence initialized offline — real presence is the pipeline's job. Never logs.
- `cvrPlatformUserId.ts` — `extractCvrPlatformUserId(id)` → stable lowercased `platformUserId` from the CVR GUID (VRX-61): survives display-name changes; validates GUID shape, rejects malformed. Pure.
- `parseCvrPrivacy.ts` — `parseCvrPrivacy(privacy)` → `{ type, openness }` (VRX-147). Pure parser for CVR's `instanceSettingPrivacy` / WS instance `privacy` values: 6 verified wire values mapped to platform-true `InstanceType`s; case/punctuation-insensitive; unknown/missing → the MOST RESTRICTIVE access (`owner-must-invite`, the api-volatility convention for access types). Never throws.
- `CvrPipeline.ts` — the CVR WebSocket client (VRX-147): extends the shared `ReconnectingPipeline` base (lifecycle/backoff/generation live there). CVR specifics: auth = `Username`/`AccessKey` (+ UA/Platform) headers on the UPGRADE handshake via the injected `headersProvider` (null with no session → wait+retry); clean JSON (NOT double-encoded); envelope accepted in BOTH casings (`ResponseType`/`responseType` — wire casing unconfirmed until observed live). Routing: `10` ONLINE_FRIENDS → `presence-snapshot` (FULL current-online set of ids+instances, per-entry validated — one bad entry skipped, rest survive; absent-from-snapshot ⇒ offline; NO status/trust fabricated, §5); `11` FRIEND_LIST_UPDATED → `roster-changed` (trigger-only refetch); invites/requests/notifications (0/1/2/15/20/25/30/50) decoded + logged, deliberately unrouted until their features exist. BIDIRECTIONAL: `sendFriendRequest`/`acceptFriendRequest`/`declineFriendRequest`/`unfriend`/`sendInvite`/`requestInvite`/`block`/`unblock` send `{RequestType, Data}` (🟡 Data shapes mock-verified vs CVRX notes); sends while disconnected return false, never queue. No app-level keepalive is sent (server pings ~60s; `ws` auto-pongs) — the RequestType-0 SelfOnline is deliberately omitted until observed necessary live.
- `CvrPipeline.test.ts` — full lifecycle against a fake socket: header-auth dial, both envelope casings, snapshot mapping (privacy→type/openness, isOnline:false, per-entry skip), roster trigger, unrouted/unknown/malformed tolerance incl. Buffer frames, RequestType payloads, disconnected sends, null-headers wait, inherited reconnect.
- `parseCvrPrivacy.test.ts` — the verified value table + casing drift + most-restrictive unknown.

## Local Contracts
- Same as `vrchat/`: no electron imports; injected socketFactory/headers/log; defensive parsing — unknown values degrade, never throw; CVR has NO status/trust (§5) — never fabricate them.
- The shared lifecycle machinery lives in `../ReconnectingPipeline.ts` — don't fork it; extend it.

## Verification
`npm run typecheck && npm run lint && npm test`
