# src/main/services/adapters/cvr

## Purpose

Own ChilloutVR-specific parsers, REST transforms, instance resolution,
discovery parsing, and the real-time pipeline. This directory stays pure and
dependency-injected; `CvrAdapter` composes it with shared transport policy.

## Ownership

- [`docs/INTERNAL-API.md` sections 3, 4, and 6](../../../../../docs/INTERNAL-API.md)
  define normalized events, the adapter contract, and registered parsers.
- `fetchCvrFriends.ts` maps the one flat `/friends` roster. `CvrPipeline.ts`
  maps the authenticated `/users/ws` presence stream. REST roster and WebSocket
  presence remain separate inputs.
- `parseCvrPrivacy.ts`, `cvrPlatformUserId.ts`, and join/discovery parsers own
  platform conversions. `resolveCvrInstance.ts` owns instance-detail caching.
  `CvrAdapter` owns account/session transitions and published events.

## Local Contracts

- No Electron, Node process, storage, or UI imports. Accept network, clock,
  socket, and logger dependencies explicitly so modules stay deterministic in
  unit tests.
- Make one `/friends` request per roster refresh. Do not poll each friend.
  Start every REST friend offline with no instance; the pipeline supplies live
  presence.
- Parse envelopes and records defensively. Skip invalid individual records,
  count them where the return contract allows, and preserve valid siblings.
  A total fetch failure throws. Unknown privacy values map to the most
  restrictive access and carry `opennessUnknown`.
- CVR's `ONLINE_FRIENDS` first provides a full online set, then deltas. Merge
  deltas into the running set and emit the complete result; clear the set on
  reconnect. Accept documented casing variants, normalize only valid GUID IDs,
  and tolerate malformed or unrelated messages.
- Pipeline authentication belongs on the WebSocket handshake. It waits and
  retries without credentials, never queues a social action while disconnected,
  and relies on shared reconnect and backoff policy. A data-path auth failure
  reaches the adapter's fenced invalidation path; ordinary 5xx failures do not
  clear a session.
- Reconnect waits honor a shared 429 cooldown, recheck it before a dial, and
  cancel on stop or session replacement. Do not add a heartbeat or queue
  disconnected friend actions.
- Resolve instance details with URI-encoded IDs. `world.id` is the resolved
  world identity, while CVR hot-location identity stays the globally unique
  instance ID. Preserve the WebSocket privacy value because it is fresher than
  cached REST details. Do not use a world ID in the CVR hot key.
- Instance success uses `INSTANCE_CACHE_TTL_MS`; non-auth unavailable or
  transient failures use the short negative TTL. Auth, admission, and
  cancellation errors propagate and are never negative-cached. Cache clearing
  fences in-flight results. An interactive request may bypass a pending
  background request, but it still goes through shared admission.
- Admission overflow and cancellation propagate as control flow. They do not
  become a negative cache entry or a session invalidation. Later account-bound
  requests must not resume with replacement credentials.
- Build join URLs only from the strict official CVR instance ID grammar. Return
  no URL for malformed IDs and keep browser launch outside this directory.
- Discovery parsing emits only qualifying, internally consistent candidates.
  Do not issue references, actions, URLs, or raw vendor objects from parsers.

## Work Guidance

- Treat vendor formats as volatile. Update `docs/api-volatility.md` with new
  observed shapes or changed certainty before broadening accepted values.
- Keep network paths, retry policy, and session persistence in the adapter and
  shared base classes. These modules may select request priority but must not
  make a second limiter or retry loop.
- Maintain null-safe enrichment: cache misses, malformed enrichment, and
  unavailable rooms degrade without erasing a valid roster or crashing the
  pipeline.

## Verification

- Follow `docs/DEVELOPMENT.md` and `docs/REVIEW.md`. Run affected parser,
  resolver, pipeline, and adapter tests.
- Test malformed records, casing variants, unknown privacy, full-set plus delta
  merging, reconnect clearing, ID encoding, cache expiry and clearing, auth
  propagation, and strict join URL rejection where relevant.
- Confirm changes still make no per-friend polling, no Electron imports, and no
  direct browser launches.

## Child DOX Index

No child contracts. Files in this directory are one CVR integration boundary.
