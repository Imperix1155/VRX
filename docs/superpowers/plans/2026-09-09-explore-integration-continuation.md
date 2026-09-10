# Explore integration continuation

Recorded September 9, 2026 Central. This is the current continuation of the
[implementation plan](2026-09-08-explore-implementation-plan.md), following
phase A and the merged API-safety work. It records decisions for implementation;
it does not claim they are implemented or live-tested.

## Authority and status

Josh asked how Friends and Hot Instances handle refresh, then directed:
"use your best judgment to figure out all this, as long as it respects each
platform's API guidelines." The originating liaison task
`01a08848-992f-7412-875b-a4a6ee9fc833` relayed that direction here.

That grant delegates the remaining freshness, trigger, caching and discovery
volume choices. It supersedes the earlier requirement to return for a numeric
Explore allowance approval. Global pacing was already settled. The withdrawn
16-request proposal remains historical; the choices below are newly selected
by the driver under the latest grant, not numbers Josh previously approved.

The API dependency merged as `e6960c1d6cb7b717fe668370bb99cfd901040039` in
[PR 307](https://github.com/Imperix1155/VRX/pull/307). Its tree matches reviewed
head `81fc6d88f92d09d5d91a465af2ca070e28c860ac`; exact-merge
[CI](https://github.com/Imperix1155/VRX/actions/runs/34420393143) and
[CodeQL](https://github.com/Imperix1155/VRX/actions/runs/34420393210) passed.
The [closeout](https://github.com/Imperix1155/VRX/pull/307#issuecomment-5610660559)
records tests and scoped review/merge authority. Its upstream delivery gate is
satisfied. The dependency is not yet integrated into Explore's branch.

This clarification finishes a bounded planning/handoff task. It does not start
another autonomous implementation block or authorize live-account traffic,
capture, app restart, Explore merge or release. The next executable unit is
listed below. No additional request-cap decision is pending.

## Existing behavior and reusable code

The following paths and line references are pinned to the API merge above.

| Evidence                                                                                                                           | Observed behavior and consequence for Explore                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/queries/friends.ts:41-80`, `src/shared/constants.ts:23-34`                                                       | Friends uses one query per platform. WebSockets supply live updates; REST reconciles initially, manually and at the configured jittered 5/10/30-minute interval, or manually only. The default is five minutes. |
| `src/renderer/src/hooks/useLiveFriendEvents.ts:62-99,124-139`                                                                      | Friend events update that cache; a live reconnect or roster-change trigger invalidates it for reconciliation. These events do not describe a public-world directory.                                            |
| `src/renderer/src/components/DashboardView.tsx:307-310,332-347`, `src/renderer/src/utils/dashboardAggregations.ts:133-185,246-265` | Hot Instances derives up to six cards from the same friends cache. It has no independent discovery fetch or timer. Preserve that behavior.                                                                      |
| `src/main/services/adapters/RosterRefresh.ts:11-78`                                                                                | Same-session roster calls coalesce, with at most one dirty follow-up. Reuse the principle, not the roster-specific helper or its friend-event follow-up for Explore.                                            |
| `src/main/app.ts:382-384,459-460`, `src/main/services/adapters/ApiAdmissionController.ts:109-220`                                  | Main injects one controller per platform. It spaces physical attempts, bounds queued waits and shares cooldown across callers. It does not limit total discovery work.                                          |
| `src/main/services/adapters/BaseAdapter.ts:23-30,74-107,124-139`, `src/main/services/adapters/RequestLease.ts:3-16`                | Existing request options provide `priority`, `signal`, `lease`, `retry` and `beforeDispatch`. Admission and session checks precede credential construction. Discovery can use these without another scheduler.  |
| `src/main/services/avatarCache.ts:155-185,225-278`                                                                                 | The image cache deduplicates URLs, permits at most two redirects, and uses shared admission for API-host hops. CDN transfers have separate bounded concurrency. A 429 ends that image fetch.                    |

Explore and Dashboard will share their own discovery snapshot and selector.
Friends data is not a substitute for public-world discovery or evidence that
a room is Public/Group Public. Existing friend presence and Hot Instances stay
on their current path.

## Platform guidance checked

Checked the current primary pages on September 9 Central, September 10 UTC.
[VRChat's API Usage / Bots guidance](https://hello.vrchat.com/creator-guidelines#api-usage--bots)
requires metered requests, suitable caching, error backoff, a proper User-Agent
and avoidance of synchronized schedules. It gives no universal numeric quota.
Its credential guidance remains as recorded in the earlier audit; this task
does not reinterpret encrypted session storage as a platform-granted exception
or reopen Josh's settled local-login decision.

[ChilloutVR's terms, version 2026-V10, sections 4 and 8](https://docs.chilloutvr.net/official/legal/tos/)
prohibit abuse and bots and permit third-party applications with an affiliation
disclaimer. No general REST quota was found in the official pages checked.
In-game CCK timing limits are not REST allowances. Community endpoint references
and prior sanitized feasibility observations establish expected shapes, not
official rate permission. Preserve the existing host/auth boundary; this plan
does not authorize a host migration or access bypass.

The merged controller's one-second-plus-jitter interval is VRX's conservative
client policy, not a published platform guarantee. The choices below reduce
work within it. No newly found refresh-policy conflict requires an owner choice.

## Chosen refresh and cache behavior

| Case                                               | Implementation decision                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter visible Explore or Dashboard                 | Show the current session's cache immediately. With no snapshot, request one eligible initial load for each selected, authenticated platform. With a snapshot, revalidate only when stale and automatic eligibility permits.                                                                                         |
| Freshness                                          | Candidate/room display evidence is fresh for 60 seconds. Preserve the last successful display snapshot when stale. Automatic candidate starts have a five-minute minimum since the last candidate attempt; explicit refresh may start after 60 seconds. Both are elapsed-time gates, not timers that schedule work. |
| Manual refresh, repeated clicks, concurrent mounts | A refresh goes through main eligibility and shares any current same-platform job. No queued extra refresh, timer replay or TanStack retry. Manual refresh does not bypass cooldown, budget or session checks.                                                                                                       |
| Focus, reconnect or authentication becomes ready   | If a relevant view is visible and the cache is missing/stale, use the same eligibility check. A socket reconnect is only a possible discovery trigger, not evidence of world changes. Coalesce initial/auth/focus/reconnect signals. With no relevant view, do nothing.                                             |
| Filters and 2/4/6 control                          | Select cached results locally. A newly selected authenticated platform may get its eligible initial load. Increasing the count does not start another scan or qualification pass. Dashboard's two cards are a prefix of the same ranking.                                                                           |
| Leave relevant views or switch world sheet         | Cancel obsolete candidate/sheet jobs and queued JSON requests; keep display cache. Dashboard-to-Explore navigation shares ownership without a redundant fetch. Close/switch cancels the old sheet's work.                                                                                                           |
| Stale/open room sheet                              | Show cached permitted rows, with stale Join disabled. Opening or explicit refresh may fetch one bounded batch. No periodic sheet polling or silent continuation when its allowance returns. Cache identical detail reads across the grid and sheet.                                                                 |
| Error, malformed envelope, 401, queue full or 429  | End that platform's batch. Keep last good display data and expose the existing localized state. A 429 from any shared caller invalidates discovery's captured rate-limit revision, even for zero Retry-After. Expiry never restarts the old batch. Ordinary invalid entries are skipped within fixed input bounds.  |
| Account/logout/session change                      | Abort using the original adapter session lease; clear that platform's discovery snapshots, opaque references and renderer queries. Capture generation at job start and recheck before dispatch and publication. No discovery disk persistence.                                                                      |

Five minutes matches Friends' default reconciliation scale without copying its
periodic timer. Manual refresh remains responsive within the already specified
60-second minimum. Candidate metadata may be stale between visits; Join always
has its own stricter freshness check. The Friends reconciliation preference is
not silently repurposed as an Explore preference.

## Finite discovery work

These ceilings are limits, never targets or repeating schedules. Each platform
uses its existing admission controller; feature accounting only rejects work,
and does not pace, sleep, retry or create another transport queue.

- One candidate job and one selected-world job per platform, each with at most
  one outstanding JSON operation. Candidate jobs have a 45-second deadline;
  sheet jobs use the same deadline. Abort stops queued work and future steps.
- At most 20 Explore JSON wire attempts per platform in any rolling 60 seconds,
  including candidate/detail failures and Join revalidation. Charge through
  the existing `beforeDispatch` option after admission, before fetch. A rejected
  budget check ends the job. Keep this account-independent per-platform ledger
  across account switches so switching cannot reset an allowance.
- VRC reads one active page with at most 12 candidates, with no replacement
  pages for bad or duplicate entries. Its summaries supply ranking. No initial
  per-world detail fan-out is needed.
- CVR reads only the first active-category page, considers at most 12 distinct
  valid entries and retrieves at most six uncached world-detail records. It
  spends at most six room-detail reads on public qualification, round-robin
  across those worlds. Stop early when sufficient cached evidence exists.
  Cold maximum is `1 category + 6 worlds + 6 rooms = 13` JSON attempts.
- A world sheet spends at most seven JSON attempts: at most one world refresh
  plus six room details. Cached details reduce that work. Retain at most 100
  validated room IDs per world; report incomplete coverage instead of crawling
  to completion. Explicit refresh/reopening may continue within the same main
  limits; a partial result does not start its own follow-up.
- The 20-attempt JSON ceiling accommodates one cold CVR qualification and one
  seven-attempt sheet batch. They still share admission with normal app work.
  VRC Join may need one revalidation within that same ceiling, never an extra
  allowance or an automatic retry. Budget pressure can produce partial rows
  or a denied stale action rather than extra traffic.
- Images reuse the existing bridge/cache. Request only visible card/sheet
  world images, with no separate sheet image when the card already supplied it.
  Deduplicate by canonical URL; main permits at most six new Explore image
  operations per platform per rolling 60 seconds and at most two outstanding.
  Reuse a completed same-session image without a new operation. A budget denial
  leaves the existing placeholder and never schedules a delayed retry. An
  already handed-off image follows the existing cache's admission/session
  rules; leaving a view stops new image work, not shared Friends image work.

The JSON ceiling is not an all-traffic ceiling. One cold six-image group can
add at most 18 HTTP attempts over its lifetime because the existing bridge
allows the initial fetch plus two redirects. CDN hops are not platform API
calls. A rolling window may also contain remaining hops from the two already
outstanding image operations: a conservative bound is 24 image HTTP attempts
plus 20 JSON attempts attributable to Explore, before global pacing further
reduces API-host starts. This counts cache hits conservatively and must be
proved with fake transport/clock tests. It is not 44 requests of reserved
bandwidth, nor a statement about all app/CDN traffic.

Visible results can be fewer than the selected count. CVR worlds require actual
qualifying Public/Group Public room evidence before promotion; category
`playerCount` cannot stand in for public occupancy. Partial room totals remain
unknown. Cache eviction is bounded to 12 worlds per platform, with unused
details expiring after five minutes. No owner/group profiles, occupants or
offscreen images are fetched just to fill optional fields.

## Join and preserved product behavior

Retain the implementation plan's main-owned selection references, five-minute
reference lifetime, 60-second access evidence, existing confirmation and shared
join lock/cooldown. VRC requires its explicit eligibility evidence and may do
one no-retry revalidation. CVR requires fresh Public/Group Public evidence;
full qualifying rooms remain visible and joinable under the approved rule.
Expired CVR evidence requires sheet refresh, with no admission probe or API
`/join` request. Recheck settings, account, identity and target after awaits.
No automatic action, invented friend ID or replacement target is permitted.

The mixed grid, platform symmetry, native ranking, persisted 2/4/6 default 4,
contained nonmodal sheet and Dashboard order remain approved and unchanged.
This continuation adds no timer control, global completeness claim or new UI.

## Next executable unit and verification

1. Integrate exact API merge `e6960c1d6cb7b717fe668370bb99cfd901040039` into the
   feature branch. Inspect conflicts against the phase-A parsers and contracts;
   preserve both lanes. Run existing admission/session/roster/image tests and
   Explore/parser tests plus applicable gates on the combined source.
2. Implement the original plan's adapter methods and main `ExploreService`
   against synthetic transport. Adapter methods use the original `RequestLease`,
   `retry: 'none'`, background priority for candidates, interactive priority for
   sheet/Join, and the existing dispatch guard. Main owns eligibility, bounded
   inputs, cache, in-flight sharing and the JSON/image operation counters.
   No raw fetch or new `ApiAdmissionController` belongs to Explore.
3. Follow the existing plan's guarded IPC/query/settings, image and Join units,
   then connect the prepared UI. Explicitly disable query interval, automatic
   query retries and implicit focus/reconnect fetching; validated visible
   triggers call main's refresh decision. Snapshot invalidation only reads the
   cache. Update the internal API catalog and owning contracts as code changes.

Use fake clocks and recorded synthetic schemas, with request counts observed
at fetch. Prove global admission across Friends, discovery, images and retries;
13/7/20 bounds; image operation/redirect bounds; no work from 1,000 duplicate
triggers, filter/count changes or cooldown expiry; five-minute automatic and
60-second manual gates; no retry or tail after 429 including zero Retry-After;
queue-full/deadline cleanup; account switch during admission/response; shared
Dashboard cache; incomplete CVR counts; stale Join and preserved friend joining.
Mutation-check the critical guards. Large fixtures must increase partial-result
frequency, not work. Run the applicable complete project gate and risk-based
review before claiming the integrated implementation verified. Real UI and
live-account evidence remain separate consent-dependent gates.

DOX pass for this clarification: the implementation plan, readiness receipt and
block ledger point here. The imported historical bodies and evidence are
preserved. No application code, runtime API policy, API shape, callable export,
design rendering or shipped behavior changed; production contracts, API docs,
design guides, README and CHANGELOG are intentionally unchanged. This plan's
limits must be implemented and tested before they describe runtime behavior.
