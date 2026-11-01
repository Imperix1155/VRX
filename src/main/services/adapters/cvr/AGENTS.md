# src/main/services/adapters/cvr

## Purpose

ChilloutVR parsing, roster mapping, instance resolution, launch URLs, Explore
parsing, and the `/users/ws` pipeline, kept pure and dependency-injected. The
rules here also cover [`../CvrAdapter.ts`](../CvrAdapter.ts) and
[`../CvrApiClient.ts`](../CvrApiClient.ts), which own session transitions,
request transport, and published adapter events.

## Ownership

- `fetchCvrFriends.ts` (flat `/friends` roster), `CvrPipeline.ts`
  (`/users/ws`), `parseCvrPrivacy.ts`, `cvrPlatformUserId.ts`,
  `resolveCvrInstance.ts`, `buildCvrJoinUrl.ts`, `parseExplore.ts`, and
  `parseAvatars.ts` (own uploads only: `authorGuid` or the `avtrmine` category),
  and `parseCommunity.ts` (people, profiles, search, worlds, groups, player
  count; IDs lower-cased GUIDs), and `parseOwnProfile.ts` (own bio and
  pronouns; the write is one multipart `POST /users/self` per field).
- Symbols and the adapter contract: [`docs/INTERNAL-API.md`](../../../../../docs/INTERNAL-API.md).

## Local Contracts

- No Electron, storage, UI, or Node process imports. Inject network, clock,
  socket, and logger. The shared base classes own admission, retry, circuit,
  and reconnect; these modules may choose request priority only.
- One `/friends` request per roster refresh; never poll a friend. Every REST
  friend starts offline with no instance; the pipeline supplies presence. A
  total fetch or envelope failure throws. Invalid records are skipped and
  counted; valid siblings survive.
- REST and WebSocket IDs both pass through `extractCvrPlatformUserId` (trim,
  lowercase, GUID check), so presence matches roster rows.
- `parseCvrPrivacy` accepts numeric and case-insensitive string forms; unknown
  values map to the most restrictive `owner-must-invite` with
  `opennessUnknown`.
- Pipeline auth rides on the upgrade headers and is never logged; with no
  session the loop waits. Accept both envelope and entry casings. Ignore
  malformed or unrelated messages; a malformed instance becomes `null` without
  dropping its friend.
- `ONLINE_FRIENDS` sends a full online set on connect, then deltas. Merge
  deltas into the running set (`isOnline: false` evicts) and always emit the
  complete merged `presence-snapshot`. A reconnect clears the set. A malformed
  full-set entry with a readable ID keeps only its earlier online state, never
  its old instance. A full set with no usable entry is never authoritative; it
  triggers at most `MAX_UNUSABLE_FULL_SET_RESYNCS` reconnects.
- `FRIEND_LIST_UPDATED` maps to the trigger-only `roster-changed`.
  `INVITES`, `REQUEST_INVITES` and `FRIEND_REQUESTS` become add-only `inbox`
  events through `parseInbox.ts` (🟡 shapes unconfirmed live; read both
  casings, cap records per frame, skip bad records). Other notification types
  stay unrouted. No application keepalive. Reconnect waits
  honor the shared 429 cooldown and cancel on stop or session replacement.
- The outgoing friend and invite senders are unwired. They drop, never queue,
  while disconnected. Wiring one is a social action under the root etiquette
  rules: no mass or automated actions.
- `CvrAdapter` auth failures: a data-path 401 signs out at once. A 403 signs
  out only when one confirming reauth with the same key is also rejected; at
  most one confirming reauth runs per session. Network and 5xx errors keep the
  session. A key rotated by reauth is adopted and persisted.
- `resolveCvrInstance` encodes the ID and keeps a bounded cache: success uses
  `INSTANCE_CACHE_TTL_MS`, ordinary failures a short negative TTL. A 403 is
  negative-cached too and still propagates for the one confirming reauth. A
  401, rate-limit, cancellation, and queue-overflow errors propagate uncached.
  `clear()` fences in-flight writes. An interactive request may bypass a
  pending background one but still uses shared admission.
- Resolved `world.id` is the world identity. The hot-instance key stays the
  globally unique instance ID, never a world ID. Merging REST detail keeps the
  fresher WebSocket privacy and any `opennessUnknown` flag.
- `buildCvrJoinUrl` accepts only `CVR_INSTANCE_ID_RE` IDs and returns `null`
  otherwise; the mode sets `startInVR`. Browser launch stays in IPC.
- `parseExplore.ts` emits only qualifying, internally consistent candidates
  and issues no references, actions, URLs, or raw vendor objects.

## Work Guidance

- Treat vendor formats as volatile. Record new shapes or changed certainty in
  [`docs/api-volatility.md`](../../../../../docs/api-volatility.md) before
  broadening accepted values.
- Keep enrichment null-safe: misses, malformed detail, and unavailable rooms
  never erase a valid roster or stop the pipeline.
- Cancellation and admission overflow are control flow, never a negative cache
  entry or session invalidation. Account-bound work never resumes with
  replacement credentials.

## Verification

- Follow the root gate. Run the affected parser, resolver, pipeline, and
  `CvrAdapter*.test.ts` suites, covering malformed records, casing, unknown
  privacy, full-set plus delta merging, reconnect clearing, ID encoding, cache
  expiry, auth propagation, and join URL rejection as relevant.
- Confirm no per-friend polling, Electron imports, or browser launches.

## Child DOX Index

No child contracts. This directory is one ChilloutVR integration boundary.
