# App-wide API traffic hardening plan

Prepared September 9, 2026. **Scope approved; implementation not started.**
This is the next prerequisite for Explore, not an Explore implementation run.

## Approved outcome and authority

Josh approved fixing unnecessary API calls and asked for this implementation
plan. He also settled the login approach: retain encrypted local session
credentials and do not persist account passwords. Do not require another
approval of these settled choices. The latest request is planning, so this
checkpoint does not start implementation or an unattended run.

Josh explicitly confirmed the rate-limit safety requirement after the VRCX
comparison: when a platform rate-limits VRX, stop new API dispatches for that
platform during its cooldown, including image and refresh paths. Honor the
server's wait instruction; use increasing jittered backoff when it supplies
none. Resume eligible work through normal pacing, never a queued burst or
automatic replay of obsolete account actions. Keep the other platform
independent. This strengthens the existing partial protection rather than
claiming VRX previously had no backoff.

Keep existing login, restore, two-factor prompts, account switching, logout,
manual refresh, recovery-interval controls, friends, linked profiles, Hot
Instances and user-initiated actions available. Background traffic may wait
longer when images and REST share capacity or a server requests a cooldown.
Cached data and existing image fallbacks must remain usable during that wait.

No authentication redesign, credential deletion/migration, password storage,
new account actions, endpoint-host migration, new polling interval, additional
WebSocket, Explore traffic, or UI redesign. No new live-account probe, app
restart, release or merge is authorized by this plan. Normal feature-branch
delivery authority remains subject to the owner contract and review gates.

## Baseline and evidence

- Planning checkout: `/Users/imperix/.codex/worktrees/8ca7/vrx`.
- Branch: `imperix/vrx-270-explore-plan`; head
  `f910da981567d6d324af4fa67c0fa3a9e7c279ec`.
- App baseline and remote main, rechecked September 9:
  `9dbac8b569efb27e03ef06882d96b89d8a45c969`.
- No open GitHub PRs were returned at the check. Local worktrees include other
  work; do not modify or remove them. The process-name check found Node/tool
  processes, but does not prove that all other work is idle. Recheck ownership
  and running jobs before implementation.
- [Audit and five offline reproductions](2026-09-08-api-etiquette-audit.md).
  Source still contains the audited split image queue, pre-queue headers,
  paginator error handling, socket-open backoff reset and CVR roster overlap.
- [Internal API catalog](../../INTERNAL-API.md),
  [API policy](../../api-policy.md), [API assumptions](../../api-volatility.md).
- [Explore plan](2026-09-08-explore-implementation-plan.md) remains on hold
  pending traffic hardening and a recalculated Explore allowance. Its old
  sixteen-request proposal is withdrawn, not approved.

The audit's temporary reproducer is optional evidence, not a dependency. Port
the scenarios into repository tests. No real credentials or traffic are needed.

### Saved-login conclusion

VRX stores a VRChat session cookie and CVR username/access key using safeStorage.
Passwords are submitted for login but are not persisted by that store.
The owner chose to retain this behavior after discussing the uncertainty.

Current public VRCX code saves cookies and optionally login credentials;
CVRX saves username/access key. These establish precedent, not permission for
VRX. VRChat staff have coordinated changes with VRCX, but that is not a verified
blanket endorsement of every feature or saved-session implementation.

- [VRCX login implementation](https://github.com/vrcx-team/VRCX/blob/e46ac924a69498b93fb0019881a7f800facf33ea/src/stores/auth.js#L475).
- [CVRX credential implementation](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/server/config.js#L222).
- [Staff API-change coordination](https://github.com/vrcx-team/VRCX/issues/429).
- [VRCX's terms/endorsement distinction](https://github.com/vrcx-team/VRCX/blob/e46ac924a69498b93fb0019881a7f800facf33ea/README.md#is-vrcx-against-vrchats-tos).
- [VRChat guidance](https://hello.vrchat.com/creator-guidelines#api-usage--bots)
  discourages credential/session storage and acknowledges the lack of OAuth.

Record this as a policy ambiguity with an explicit owner decision, not a
demonstrated violation requiring login removal, and not verified compliance or
zero account risk. Keep the current unofficial-app risk disclosure.

### VRCX traffic reference, not a policy template

At the owner's request, inspected public VRCX source at
`e46ac924a69498b93fb0019881a7f800facf33ea`. No installed VRCX data was opened
and no VRCX process was run. This is a bounded static comparison, not an audit
of every VRCX platform backend or proof of its runtime request frequency.

| Observed VRCX behavior                                                                                                                                                                  | Consequence for the VRX plan                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/request.js` shares a pending GET by full URL for up to ten seconds and remembers selected 403/404 failures for fifteen minutes.                                           | Reuse the deduplication idea, but key VRX work by session generation as well as operation. Never share a pending result across accounts. Keep existing negative caches and distinguish denial/not-found from 429 cooldown.                     |
| `src/stores/friend.js` creates a limiter per online/offline bulk pass, with fifty-record pages, five workers, sixty admissions per minute and up to five 429 retries.                   | These are VRCX implementation choices, not vendor allowances. Do not import its concurrency, page limits or cadence. VRX's shared controller must account for images, auth and retries as physical attempts, not only initial page admissions. |
| `src/shared/utils/retry.js` uses exponential retry delays without reading Retry-After or adding jitter. Its friend-loader caller acquires the limiter before entering the retry helper. | Keep VRX's server-wait handling and jitter. Every allowed retry must re-enter admission. Add a regression proving that retry paths cannot bypass it.                                                                                           |
| `src/services/websocket.js` applies live events and refreshes friends/notifications after an unexpected disconnect recovers; reconnect uses a five-second timer.                        | Reconnection reconciliation is useful precedent. Preserve it with generation-scoped dedupe; do not replace VRX's escalating backoff with a fixed timer or copy extra notification features.                                                    |
| The inspected Windows `Dotnet/WebApi.cs` Execute path returns status/body rather than response headers to its JavaScript caller.                                                        | VRX must consume Retry-After in main before reducing an error to its safe IPC representation. Do not infer all VRCX backends behave identically.                                                                                               |

Pinned references:

- [GET deduplication and failure cache](https://github.com/vrcx-team/VRCX/blob/e46ac924a69498b93fb0019881a7f800facf33ea/src/services/request.js#L88).
- [Friend loader and limiter placement](https://github.com/vrcx-team/VRCX/blob/e46ac924a69498b93fb0019881a7f800facf33ea/src/stores/friend.js#L658).
- [Backoff helper](https://github.com/vrcx-team/VRCX/blob/e46ac924a69498b93fb0019881a7f800facf33ea/src/shared/utils/retry.js), [limiter helper](https://github.com/vrcx-team/VRCX/blob/e46ac924a69498b93fb0019881a7f800facf33ea/src/shared/utils/throttle.js).
- [Socket recovery](https://github.com/vrcx-team/VRCX/blob/e46ac924a69498b93fb0019881a7f800facf33ea/src/services/websocket.js#L81).
- [Windows response boundary](https://github.com/vrcx-team/VRCX/blob/e46ac924a69498b93fb0019881a7f800facf33ea/Dotnet/WebApi.cs#L459).

The comparison reinforces units 1, 3, 4 and 5. It does not widen product scope,
authorize traffic, certify either app, or replace current platform guidance.

## Implementation sequence

The driver owns shared interfaces and integration. Sequence these units; no
parallel implementation depends on an unfinished scheduler or session contract.
Paths below are relative to the repository root. Read the root and nearer
contracts before editing each path.

### 1. One API admission controller per platform

**Owns:** `src/main/services/adapters/BaseAdapter.ts`, a small extracted
main-only scheduling module in that directory, `src/main/app.ts`,
`src/main/services/avatarCache.ts`, corresponding tests.

Extract existing pacing/cooldown scheduling rather than introduce a second
network stack. Construct/inject one controller per platform in main. All API
wire attempts, including auth, retries and API-backed image hops, use it.
Platform aliases must share the platform controller, not gain separate budgets.
Keep VRChat and CVR independent. CDN body transfers keep their separate bounded
concurrency and host-specific cooldowns; updater traffic is outside this scope.

Internal contract: `acquire({ priority, signal, notBefore })` admits one attempt;
`deferUntil(deadline)` monotonically extends the shared cooldown. It contains
no credentials, response decoding, IPC, or persistence. Use injectable clock,
sleep and randomness. Preserve the existing minimum one-second start spacing
and jitter, interactive priority, timeout and circuit-breaker behavior. This
is VRX's conservative ceiling, not a vendor-published numerical allowance.

Read Retry-After as seconds or HTTP date, with finite-value validation and
exponential jittered fallback. Never shorten a valid server wait, including
waits beyond timer limits. Recheck admission after every wake and immediately
before fetch. Bound pending admission entries with a named internal limit;
measure existing roster/enrichment fan-out to choose it before integration.
Overflow must fail once without automatic retry or silently losing an action.
Interactive work must not be starved by image backlog.

**Done when:** mixed API image/REST starts never violate spacing; a 429 on
either path blocks the other; different image URLs cannot evade cooldown;
simultaneous 429s extend rather than overwrite waits; CDN cooldown is honored;
another platform progresses independently; queue overflow/cancellation drains
cleanly; redirects retain existing URL restrictions and never forward cookies
to CDN hosts. Cancel unused response bodies before ending/retrying attempts.

### 2. Cancel obsolete account and login work before dispatch

**Depends on:** unit 1 admission cancellation.
**Owns:** `VrcApiClient.ts`, `CvrApiClient.ts`, `VrcAdapter.ts`, `CvrAdapter.ts`
under `src/main/services/adapters`, avatar wiring in main, focused adapter tests.

Capture a main-only request lease when an operation begins, with its generation
and AbortSignal. Reuse each adapter's session-generation and interactive-login
operation boundaries; do not replace them with a single global account epoch.
Background session invalidation must not cancel a newer deliberate login.
Every admitted dispatch, retry and authenticated image hop validates its lease.
Only then build headers from the matching session. Do not lend a replacement
account's cookie to an old image or request. Retain result/body/persistence
generation fences as well as the new dispatch fence.

Combine cancellation with the timeout rather than overriding caller signals.
Cancellation does not increment circuit failures, clear a replacement session,
or schedule retries. Already dispatched requests cannot be unsent; abort their
remaining work and discard stale results. A legitimately restarted read needs
a fresh operation and lease; never rebind or replay an old account action.

**Done when:** logout while queued sends zero old requests; switch while queued
uses neither account's credentials for the obsolete operation; cancellation
during cooldown prevents retry; tentative credentials never reach images or
REST; stale responses cannot change the new session; login/2FA/restore and
failed-persistence tests preserve their existing behavior.

### 3. Stop rate-limited batches and outer retry amplification

**Depends on:** units 1–2.
**Owns:** `vrchat/fetchFriends.ts`, adapters and metadata resolvers,
`errors.ts`, `IPlatformAdapter.ts`, `src/main/ipc/friends.ts`,
`src/preload/index.ts`, renderer `queries/friends.ts` and `queries/queryClient.ts`,
plus their tests. All adapter-relative paths are under `src/main/services/adapters`.

Use a per-operation retry policy. Roster and background enrichment stop at the
first 429, publish the host cooldown and do not sleep/replay that batch.
Other existing request kinds retain their current bounded retry policy unless
a focused test exposes an unsafe replay; never add retries to user actions.
One layer owns any allowed replay. Auth errors retain their current meaning.

Extend the main-only roster result with optional rate-limit metadata alongside
`friends` and `completeness`. With usable pages, return a partial roster, stop
both pagination passes and skip uncached metadata enrichment. Preserve cached
entries absent from a partial result; partial data must not imply removals or
offline transitions. Without usable pages, propagate RateLimitError rather
than relabel it as generic network failure or an empty successful roster.

Keep the current `get-friends` renderer return shape where possible. Map an
unavailable rate-limited roster to the existing sanitized `rate_limited` error
at IPC, already normalized in preload and excluded from query retries. Main
retains the deadline and suppresses background launches during it. Test actual
Electron error wrapping; do not depend on custom Error properties surviving
IPC. No raw response, token or account details cross this error boundary.

**Done when:** first-page or later-page 429 causes no subsequent page/pass or
metadata attempt, no outer query retry, and no burst at cooldown expiry;
successful partial/cached data survives; all-failed is not empty-success;
ordinary transient page/schema failures keep their existing bounded behavior;
manual/reconnect/interval triggers cannot bypass main cooldown.

### 4. Coalesce roster refreshes at the main-process owner

**Depends on:** unit 3 result/error behavior and unit 2 leases.
**Owns:** both adapters' `getFriends`, CVR name warming, renderer
`hooks/useLiveFriendEvents.ts` only if needed, and integration tests.

Share one in-flight roster promise per platform/session generation between
initial load, manual refresh, reconnect, selected recovery interval and CVR
name warming. Remove it in identity-checked finally cleanup. An old promise
must not clear a newer entry or satisfy a replacement account. Keep CVR's
successful name-warm guard and name-cache ordering protections.

Coalesce repeated reconnect/roster invalidations into at most one pending
follow-up while a refresh is active. That follow-up consults cooldown and the
current lease. Do not discard individual friend updates, permanently suppress
recovery, add a timer-based presence poll, or change saved interval controls.

**Done when:** simultaneous CVR warm/query paths cause one roster fetch; both
callers get the result; rejection cleans up for a later valid attempt; logout
and switch isolate promises; event storms produce bounded work and eventual
reconciliation, not an unbounded queue. Confirm the previously static A5
finding with an executable regression before claiming the fix.

### 5. Make socket reconnect backoff survive brief opens

**Depends on:** cooldown parsing from unit 1 and coalescing from unit 4.
**Owns:** `ReconnectingPipeline.ts`, `vrchat/VrcPipeline.ts`, `cvr/CvrPipeline.ts`,
`src/main/socketFactory.ts`, and existing socket/pipeline tests.

Reset failures only after a sustained open interval, using elapsed time rather
than extra network probes. Start with the existing backoff-cap duration as the
internal healthy interval. Preserve base/cap/jitter, single-socket ownership,
generation fences and handshake timeout. Short open-close flaps must escalate.

Extend the socket factory's minimal event contract to deliver sanitized upgrade
status/Retry-After data. Explicitly dispose of rejected upgrade responses and
settle failed connections once; adding an unexpected-response listener must
not leave a hung socket. A 429 delays subsequent attempts for at least the
server wait; repeated 429s without a header use escalating fallback. Propagate
that wait to the platform controller conservatively. Retain credential/header
redaction and stop semantics. No new heartbeat protocol or Explore socket.

**Done when:** fake open-close loops produce growing capped delays; a sustained
open resets backoff; upgrade 429 seconds/date/fallback cases honor waits;
stop/switch during wait prevents obsolete reconnect; close/error races settle
once; reconnect recovery does not duplicate REST; normal live events still flow.

### 6. Integrate, document, review, then revisit Explore

**Depends on:** units 1–5 verified together.
**Owns:** integration tests, `docs/INTERNAL-API.md`, `docs/api-policy.md`,
`docs/api-volatility.md`, `README.md`, `CHANGELOG.md`, affected contracts and
the Explore plan. Do not mark future behavior implemented before its gate passes.

Run mixed-load tests across both platforms, auth, image hops, roster pagination,
metadata, reconnect and explicit actions. Count physical attempts with fake
clock/transport, not only helper calls. Test cooldown extension under in-flight
responses, cancellation and retry-layer interaction. Mutation-check each
protection by safely bypassing it and proving its regression fails, then restore.

Correct claims of no polling, universal backoff, separate image API budgets and
guaranteed compliance. Document WebSockets as the live path plus the existing
jittered recovery REST cadence, without changing its controls. Explain that
one-per-second is local policy and the app must also respect server cooldowns.
Update owning contracts to distinguish live presence polling from approved
slow recovery reconciliation. Keep current risk disclosure and saved-login
decision explicit. Design artifacts remain unchanged unless a separately
approved visible change occurs.

Implementation risk is **T2**: these paths control account traffic and session
isolation. Before delivery use current `review-loop`, a fresh general review,
focused critical checks where evidence requires them, and substantive CodeRabbit
and Greptile coverage of the initial and later functional heads. Same-lineage
agreement is not external approval. Run focused tests plus:

```sh
npm run lint && npm run format:check && npm run build
```

Build already includes typechecks and the entry-chunk assertion. Run the
review-loop application dead-code/duplication checks and required final-head
CI. Bound waits; missing required review or failed checks remain blockers.
No merge without explicit owner authority. Owner-test packaging requires
`cut-release`; the local build gate is not a shipped test build.

After hardening is verified, recalculate Explore's allowance using measured
mixed-load scenarios through the one platform controller. Keep its approved
UI, public-room qualification and full-CVR-room behavior. Do not silently
reactivate the withdrawn sixteen-request allowance or start Explore.

## Separate remaining disclosure work

The audit also identified CVR's required non-affiliation sentence missing from
the app. Its visible placement and localization remain a separate product
decision, not a reason to block these traffic fixes. Do not silently choose a
new login/About notice or claim whole-app policy compliance before addressing
it. No further owner decision is needed to start the traffic work itself.

## Execution preflight and stopping point

### Separate-task handoff

The owner requested two separate new tasks, one for this API plan and one for
Explore. The original task coordinates the handoff, not implementation. API safety is the prerequisite producer and
does not wait for Explore. Explore may prepare sample-data components and pure
tests independently, but real API integration waits for this work's verified
completion and the revised Explore traffic approval. The Explore plan records
the exact gate. Do not interpret the request as a circular wait.

At completion, supply the reachable commit/PR, actual scheduler/request/lease
interfaces, test and final-head CI evidence, required critical review results,
unresolved findings if any, and whether the change is merged. Do not report
ready while a required gate is missing. Explore must inspect and integrate the
verified dependency; a status message alone does not open its gate.

The initial separate-task request is preparation and receipt verification,
not production implementation, merge, release or a scheduled background run.
The saved planning documents must be copied into that task's own checkout
before it claims the handoff is durable. Do not edit the original task's files.

Before implementation, recheck branch/worktrees, main, open PRs and running
jobs; preserve the local audit/Explore edits. Track the app-wide correction
separately from the Explore feature and resolve its tracker identifier before
choosing the issue branch. Do not guess an issue number. Start from verified
main with these local planning documents reachable. Read the current contracts
and establish focused baseline test results before changing production code.

Next safe unit: turn A1's mixed image/REST and 429 scenarios into deterministic
repository tests, then extract/inject the shared admission controller. The
current checkpoint saves the plan only. No implementation, runtime validation,
tracker transition, PR, push, release or unattended run is claimed.
