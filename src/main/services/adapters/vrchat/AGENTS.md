# src/main/services/adapters/vrchat

## Purpose

Own VRChat-specific parsing, friend retrieval, metadata resolution, join URL
building, discovery parsing, and the Pipeline client. This code stays pure and
dependency-injected; `VrcAdapter` owns session state and publishes adapter
events.

## Ownership

- [`docs/INTERNAL-API.md` sections 3, 4, and 6](../../../../../docs/INTERNAL-API.md)
  define adapter events, the platform adapter contract, and registered parsers.
- `fetchFriends.ts` owns REST roster collection and normalization.
  `VrcPipeline.ts` owns live Pipeline messages. `WorldResolver` and
  `GroupResolver` own bounded metadata caches. Location, presence, trust, and
  instance-type parsers own vendor-to-shared conversion.

## Local Contracts

- Do not import Electron, storage, UI code, or Node process APIs. Inject HTTP,
  socket, time, and logging dependencies. Shared base classes own request
  admission, retries, timeout, circuit behavior, and reconnection.
- Treat every API value as untrusted. Validate page envelopes and individual
  records. Skip malformed records without discarding valid siblings. A partial
  roster must never claim completeness or remove absent cached friends.
- Optional auth-status presence buckets are one-use evidence, valid only for
  the same durably bound owner and session within five seconds of probe start.
  New status probes, Pipeline events, and session boundaries invalidate them;
  missing or malformed evidence falls back to the ordinary roster probe.
- The ordinary roster bucket probe requires all three presence arrays. Missing
  or malformed arrays degrade without publishing an invented offline baseline;
  explicitly empty arrays remain valid.
- VRChat presence has two axes. Derive `state` from the current user's bucket
  membership and `status` from each friend's status field. Keep them separate.
  Unknown values degrade safely and do not crash an update.
- `parseLocation` returns no instance for non-instance/sentinel values or a
  missing world/instance part. Do not reject an otherwise parseable location
  merely for an unrecognized access tag. `parseInstanceType` retains its public
  fallback for unknown non-group tags and restrictive `group` fallback for
  unknown group access. Parsed IDs still pass through main-owned
  `LocationAuthority` and strict launch validation; parsing alone never
  authorizes a join.
- The Pipeline is live state, not a polling replacement. Reconnect through the
  shared base, reject malformed messages safely, and emit normalized events.
  Account or auth boundaries fence stale events and metadata work.
- Reconnect waits honor a shared 429 cooldown, recheck it before token work and
  dialing, and cancel on stop or session replacement. Do not add a heartbeat.
- Metadata caches are bounded and account-safe. A cache miss or failed world or
  group lookup degrades to null and never rejects a roster already returned.
  Background enrichment emits metadata only for the current matching entity;
  it must not replay stale friends or cross an identity boundary.
- Cancellation, admission overflow, and a tentative session are control flow.
  Propagate them, stop later pagination or batch work, and do not turn them into
  circuit failures or negative cache entries. A later request never borrows a
  replacement account's credentials.
- Build only strict official VRChat launch URLs from main-owned instance data.
  The URI cannot choose desktop or VR mode. Return null for malformed pieces;
  final allowlist validation and `shell.openExternal` stay in IPC.
- Discovery parsers accept only internally consistent public candidates and do
  not expose raw responses, host choices, or action URLs to the renderer.

## Work Guidance

- Record changed vendor assumptions and observed shapes in
  `docs/api-volatility.md`. Do not widen a parser merely because a value looks
  plausible; preserve the safe degraded result until the format is known.
- Preserve the separation between friend REST reads, Pipeline presence, and
  metadata enrichment. Do not add per-friend polling or a parallel retry loop.
- Keep resolvers cache-only for synchronous callers and bound background work
  through the existing admission controller.

## Verification

- Follow `docs/DEVELOPMENT.md` and `docs/REVIEW.md`. Run targeted parser,
  paginator, resolver, Pipeline, and adapter tests for the changed behavior.
- Cover malformed and unknown data, partial page failure, presence-axis
  independence, location rejection, cache expiry and identity fencing, and
  strict URL construction when those paths change.
- Confirm there are no Electron imports, browser launches, social polling, or
  raw API payloads in emitted events or logs.

## Child DOX Index

No child contracts. Files in this directory are one VRChat integration boundary.
