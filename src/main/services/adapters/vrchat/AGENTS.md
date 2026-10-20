# src/main/services/adapters/vrchat

## Purpose

VRChat-specific parsing, REST roster collection, world and group metadata,
launch URL building, Explore parsing, and the Pipeline client. These modules
stay pure and dependency-injected. The rules here also cover
[`../VrcAdapter.ts`](../VrcAdapter.ts) and
[`../VrcApiClient.ts`](../VrcApiClient.ts), which own session state, request
transport, and published adapter events.

## Ownership

- `fetchFriends.ts` (paginated roster), `VrcPipeline.ts` (receive-only live
  events), the world and group resolvers and batch fetchers, the `parse*.ts`
  converters, `buildJoinUrl.ts`, and `parseExplore.ts`.
- Symbols and the adapter contract: [`docs/INTERNAL-API.md`](../../../../../docs/INTERNAL-API.md).

## Local Contracts

- No Electron, storage, UI, or Node process imports. Inject HTTP, socket,
  clock, and logging. `BaseAdapter`, the admission controller, and
  `ReconnectingPipeline` own admission, retries, timeout, circuit, and
  reconnect; do not add a second limiter or retry loop.
- Treat every API value as untrusted. Validate envelopes, then each record;
  skip a malformed record and keep its siblings. A roster with failed pages,
  skipped records, duplicate rows, or the `MAX_FRIENDS` cap is `partial` and
  never removes absent cached friends.
- Presence has two axes. `state` comes from the current user's
  `onlineFriends`/`activeFriends`/`offlineFriends` bucket membership; `status`
  comes from the friend's own field. Keep them separate. Unknown values degrade
  safely.
- The roster bucket probe needs all three arrays; explicitly empty arrays are
  valid. Missing or malformed arrays return a degraded result, never an
  invented offline baseline.
- `VrcAdapter` may reuse auth-status buckets once, only for the same owner and
  session generation within 5 s of the probe start. A new status probe, any
  Pipeline event, and any session boundary discard them.
- `parseLocation` returns `null` for sentinels, a missing world or instance
  part, or a world ID without `wrld_`. An unrecognized access tag does not
  reject a location. `parseInstanceType` falls back to `public` for unknown
  non-group tags and to restrictive `group` for unknown group access. Parsing
  never authorizes a join.
- The Pipeline is live state, not a polling replacement. It never sends,
  decodes the double-encoded payload defensively, ignores malformed or unknown
  messages, and adds no heartbeat. Reconnect waits honor the shared 429
  cooldown, recheck it after token preparation and before dialing, and cancel
  on stop or session replacement.
- Metadata caches are TTL-bound and cleared at account boundaries; late writes
  from an older generation are fenced. `GroupResolver` is also size-capped.
  The launch-to-launch copy (`metadataStore`) is per account: seed only where a
  durable account is published, never extend an entry's expiry, and write only
  for the account and generation that owns the resolvers.
  Ordinary lookup failures resolve `null` and are negative-cached briefly.
  Auth, rate-limit, cancellation, and queue-overflow errors propagate and are
  never negative-cached. Enrichment never fails a roster already returned and
  emits narrow metadata events only for the current session generation.
- Cancellation, admission overflow, and a tentative session stop later pages
  and batch work. They are not circuit failures. A later request never borrows
  a replacement account's credentials.
- `buildJoinUrl` emits `vrchat://launch?ref=vrchat.com&id=<world>:<instance>`
  from main-owned instance data and returns `null` for a non-`wrld_` world or
  empty instance. The URI carries no desktop/VR mode. Final
  `isAllowedLaunchUrl` validation and `shell.openExternal` stay in IPC.
- `parseExplore.ts` accepts only internally consistent public candidates and
  returns evidence without references, actions, URLs, or raw responses.

## Work Guidance

- Record changed vendor shapes or certainty in
  [`docs/api-volatility.md`](../../../../../docs/api-volatility.md). Do not
  widen a parser because a value looks plausible; keep the safe degraded result
  until the format is known.
- Keep REST roster reads, Pipeline presence, and metadata enrichment separate.
  Never add per-friend polling.
- Synchronous callers read resolvers through `peek()` only. Background
  enrichment goes through the shared admission controller.

## Verification

- Follow the root gate. Run the affected parser, paginator, resolver, Pipeline,
  and `VrcAdapter*.test.ts` suites.
- Cover malformed and unknown data, partial pages, presence-axis independence,
  location rejection, cache expiry and generation fencing, and strict URL
  construction when those paths change.
- Confirm no Electron imports, browser launches, social polling, or raw
  payloads in events or logs.

## Child DOX Index

No child contracts. This directory is one VRChat integration boundary.
