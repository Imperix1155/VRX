# Explore implementation plan

Current continuation, September 9 Central: the API-safety dependency has merged
and Josh delegated remaining refresh, caching and discovery-volume choices to
the driver's judgment. Follow the
[integration continuation](2026-09-09-explore-integration-continuation.md) for
the selected limits, current dependency state and next executable unit. Its
authority and loading policy supersede the historical approval hold and bounded
loading proposal below. The 16-request proposal remains withdrawn. This update
records a plan; it does not start another implementation block.

The remainder of this document preserves the imported historical body.

Readiness update after the owner's whole-app review request: **live integration on hold**.
The [API etiquette audit](2026-09-08-api-etiquette-audit.md) reproduced existing
transport gaps and identified policy/disclosure questions. Follow the
[approved traffic-hardening scope and plan](2026-09-09-api-traffic-hardening-plan.md)
before adding Explore traffic. On September 9 the owner settled saved login:
retain encrypted sessions without password persistence. That policy ambiguity
does not require a login redesign or block traffic fixes. CVR's application
disclaimer remains separate disclosure work. The 16-request proposal below is
withdrawn from approval pending that work, not a platform-approved allowance.
This update supersedes the earlier statement that only ceiling approval remained.

Prepared September 8, 2026 for VRX-270. Product decisions and route feasibility
are settled. The work units below are ready to follow once the owner approves
the production request ceiling and authorizes implementation. Neither this
document nor the earlier diagnostic grant starts an overnight run.

## Start here

- [Approved design](../specs/2026-09-04-cross-platform-explore-design.md).
- [Historical planning checkpoint](../specs/2026-09-05-explore-planning-handoff.md).
- [Feasibility record](2026-09-08-explore-feasibility-preparation.md), including
  pinned public sources, sanitized observations and diagnostic authority.
- [API observations](../../api-volatility.md).
- [Internal API catalog](../../INTERNAL-API.md) and [API policy](../../api-policy.md).

These documents are together in this checkout. The two historical specs were
copied from the original design checkout without changing their approved body;
only continuation notices were added. The CVR override below takes precedence.
Temporary probe files are supplementary evidence, not a build dependency.

### Source and linking dependency

Execution checkout: `/Users/imperix/.codex/worktrees/8ca7/vrx`.
Planning branch: `imperix/vrx-270-explore-plan`.
Application baseline: `9dbac8b569efb27e03ef06882d96b89d8a45c969`, current GitHub
`main` when checked September 8. This checkout was advanced to that commit on
the planning branch, preserving the local API notes and adding these documents.

GitHub confirms the linking foundation, complete linked UI and smoke fixes
merged in [PR 299](https://github.com/Imperix1155/VRX/pull/299),
[PR 302](https://github.com/Imperix1155/VRX/pull/302) and
[PR 303](https://github.com/Imperix1155/VRX/pull/303).
The latest baseline also includes the review-policy update in
[PR 304](https://github.com/Imperix1155/VRX/pull/304). Linking no longer blocks
Explore. The installed diagnostic source, `9f9b44f`, has identical application
code to this baseline; the intervening four files are workflow/contracts.

Do not implement from the old `imperix/vrx-270-explore-design` checkout or the
former detached `60ce0a0` baseline. Do not cherry-pick linking again. At execution
start, inspect status, current main, open PRs and running jobs. If main changed,
compare affected paths before carrying this plan forward. Preserve unrelated
local changes. Read the current root and every nearer AGENTS.md before edits.

## Settled outcome

1. Replace the Instances stub/sidebar label with Explore. One world-first
   Popular now grid, existing All/VRC/CVR selector, persisted Worlds shown
   values 2/4/6 with default 4. No hard-coded two-world CVR cap.
2. Rank within each platform. Use a deterministic, platform-neutral alternating
   merge with equal shares and symmetric backfill. Never compare raw platform
   populations to choose platform precedence. Never add balancing placeholders.
3. Open a contained non-modal world sheet. Preserve sidebar access, dismissal,
   filter/count state, keyboard focus and guarded user-initiated joining.
4. Dashboard shows existing stats, up to two cards from the same Explore cache
   and ranking, then unchanged Hot Instances. Preserve its 1–10 threshold
   control, persisted value, exact-instance grouping, six-card cap and actions.
5. No friend-location substitution, occupant collection, background crawler,
   mass actions or new authentication flow. Keep both platforms independent
   during loading, logout, stale data and failures.

### Later approved CVR rule

Include worlds with explicitly Public or Group Public rooms. This concerns
room access, not whether a world asset is published publicly. Exclude private,
friends-only, group-only and unknown access. Full qualifying rooms remain
displayed and may offer Join. Do not add a spare-capacity or admission probe to
CVR joining. The game decides whether an attempted join succeeds.

CVR activity is the sum of qualifying rooms' reported occupancy, never the
unverified category aggregate. Deduplicate room IDs before summing. If access
or counts remain incomplete, retain that fact; do not present a partial sum as
the world's total. A world can be shown once one qualifying room is verified,
even if its total remains unknown. This explicitly replaces the original
design's CVR full-room and positive-admission exclusions. VRChat's stricter
room-action policy and friend-based Hot Instances do not change.

## Evidence translated into implementation

| Source             | Verified or source-backed shape                                                                                                                                            | Implementation consequence                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| VRC active worlds  | `/worlds/active`; `occupants`, `popularity`, identity/title/image; no rooms in the sample                                                                                  | Cards use aggregate occupants; world/room detail is lazy. Do not label occupants as public occupancy.            |
| VRC world          | `/worlds/{worldId}`; room tuples have ID, number and language object                                                                                                       | Accept the third member without using occupant identities. Strictly qualify public and Group Public identifiers. |
| VRC room           | `/worlds/{worldId}/{instanceId}`; live Group Public detail returned access, activity, fullness, capacity and restriction fields                                            | Route feasibility is complete. Use room detail to authorize VRC Join.                                            |
| CVR category       | `https://api.chilloutvr.net/2/worlds/list/wrldactive?page=0&sort=Default&direction=Ascending`; entries, totalPages, playerCount                                            | Candidate source only. Neither category count nor default ordering proves public occupancy ranking.              |
| CVR world and room | Same discovery host, version 1, `/worlds/{id}` then `/instances/{id}`; world room count hints, room `currentPlayerCount`, `maxPlayer`, `privacy`, `instanceSettingPrivacy` | Perform bounded room qualification before promoting a CVR candidate. No friend-room augmentation.                |
| CVR Group Public   | Pinned CVRX explicitly handles string `GroupPublic`; not captured live                                                                                                     | Add a strict discovery parser fixture. Do not reinterpret numeric group values as public.                        |

The VRC room sample contained `n_users=25` and `userCount=22` in the same
response. Their equivalence is disproved; the reason is unknown. Use valid
`n_users` as the display field for room detail, otherwise `userCount`, otherwise
unknown, and retain the selected source in the normalized value. This is a
display precedence, not a claim that either count is more current. Do not
average them, sum them or use either to override explicit full/capability flags.
World-list occupants and world-tuple counts retain their own provenance.

CVR uses room-detail `currentPlayerCount`, not `members.length`. Prefer explicit
`instanceSettingPrivacy`; if the second supplied privacy field conflicts or is
unknown, do not promote the room as public. Accept known exact public strings
case-insensitively; do not strip arbitrary punctuation into a recognized value.
Missing optional metadata does not reject otherwise valid entries. Missing
identity, contradictory identity or unsupported access does reject that entry.
Never log raw Zod values, response bodies, room IDs or member lists.

## Bounded loading proposal

Historical proposal, withdrawn from approval pending app-wide traffic fixes.
Recalculate this section after those fixes are verified, then obtain approval
for the revised Explore allowance. Everything here was proposed as a ceiling,
not a target or a repeating schedule.

- Use the existing adapter dispatcher, at most one HTTP request per second
  per platform plus jitter, shared with normal app traffic. No separate queue
  or parallel client that increases the platform ceiling.
- At most **16 Explore wire attempts per platform in any rolling 60 seconds**.
  Count actual attempts immediately before fetch, including failed attempts.
  Background entry/focus/refresh candidate work may use at most 14 of those
  slots, leaving two for a user-opened sheet or VRC Join revalidation. A single
  sheet batch is at most eight attempts and still shares the 16-attempt limit.
- No automatic discovery retries at the adapter, service or TanStack layer.
  A 429 applies the existing platform-wide Retry-After/exponential cooldown
  and ends this discovery batch. Do not weaken backoff for other callers.
  Authentication behavior and existing friend-request retry defaults stay intact.
- Refresh only on visible Explore/Dashboard entry, explicit refresh or a
  transition back into app focus while such a view is active. Main enforces a
  minimum 60 seconds between candidate-refresh starts per platform. Cooldown
  expiry itself never initiates work. Filter/stepper changes consume cached
  results; a newly needed platform can request its eligible initial load.
- One candidate job per platform and one active drill-in job per platform.
  Coalesce identical work. Queue one network operation at a time from each job;
  stop scheduling on navigation away, logout, epoch change, budget exhaustion,
  network/schema/auth failure or a 45-second batch deadline. A fetch already
  sent may finish under the existing 15-second timeout but cannot publish into
  an obsolete account. No tail jobs restart themselves at the next minute.
- Each refresh considers at most 12 distinct candidate worlds per platform.
  VRC asks for one active page with `n=12`; malformed/duplicate entries do not
  trigger unlimited replacements. CVR reads at most two category pages and
  considers only the first 12 distinct valid entries. No unverified sort option.
- CVR retrieves at most six uncached world-detail records per refresh. Within
  the remaining request allowance, visit one room per candidate in round-robin
  order before a second room from any candidate. This avoids one busy world
  consuming the whole batch. Stop early once the needed evidence is cached.
  One category + six worlds + six room details costs 13 requests in the simple
  six-world case. More rooms produce partial counts, not unbounded traffic.
- Room enumeration retains at most 100 validated IDs per world in memory and
  indicates truncation. A sheet requests details in bounded batches; reopening
  or explicit refresh can continue remaining candidates when the shared budget
  permits. Never claim these bounded results are the complete global directory.
- Images reuse the existing lazy image bridge/cache and its validation. No
  eager offscreen image download. Discovery does not fetch group names or
  owner profiles merely to fill optional metadata.

Higher population increases cached candidates and partial-result frequency,
not the request ceiling. If these bounds cannot support useful discovery,
measure with synthetic large fixtures first and return to the owner before
increasing account traffic or adding controls.

## Data and cache contracts

These are planned interfaces, not exports that already exist. Keep shared code
pure and main-only candidate/access evidence separate from renderer DTOs.

| Owner                      | Planned contract                                                                                                                                                           | Consumer                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/shared/explore.ts`    | `ExploreWorld`, `ExploreRoom`, `ExploreCount`, `ExplorePlatformSnapshot`, `ExploreWorldSnapshot`; count includes nullable value, source and complete/partial/unknown state | Adapters, service, IPC and renderer                        |
| Adapter methods            | `getExploreCandidates({ cursor? })`, `getExploreWorld(worldId)`, `getExploreRoom({ worldId, instanceId })` return normalized, main-only evidence                           | `ExploreService`; each method performs at most one request |
| `services/explore.ts`      | `getSnapshot(platform)`, `refresh(platform, reason)`, `getWorld(platform, worldRef)`, `resolveSelection(platform, selectionRef)`                                           | Guarded IPC; owns session capture and all budgets          |
| Preload bridge             | `getExplore({ platform, reason })`, `getExploreWorld({ platform, worldRef })`, `joinExploreRoom({ platform, selectionRef, mode })`, `onExploreChanged(callback)`           | One renderer query owner plus join coordinator             |
| `shared/exploreRanking.ts` | `rankExploreWorlds(platform, worlds)` and `selectExploreWorlds({ lists, filter, total })`                                                                                  | Same selector for Explore and Dashboard                    |

Use closed unions for reasons, statuses and denials. Validate lengths, unknown
fields, platforms and references at IPC. The renderer supplies neither arbitrary
endpoints nor launch URLs. `worldRef` and `selectionRef` are opaque main-issued
references bound to platform, account key, epoch and snapshot generation. They
are not credentials and do not persist across app restarts.

Main cache keys include platform, resolved AccountSession accountKey, epoch and
resource identity. Candidate and room evidence is fresh for 60 seconds. Keep
the last good display snapshot for the current session across transient errors,
mark it stale after freshness expiry, and never treat stale access as authority.
Limit each platform cache to 12 worlds and 100 room summaries per world; expire
unused detail entries after five minutes. Eviction invalidates selection refs.
On identity boundary, clear that platform's snapshots, refs, pending work and
renderer queries immediately. Never persist discovery responses or action refs
in the existing localStorage friends cache.

Every asynchronous result must match its captured account/epoch and job
generation before publication. Wire dispatch must recheck the lease after
waiting for the queue, before sending any captured credentials. Existing
BaseAdapter has no such discovery-specific dispatch hook, so unit 1 adds one
with defaults that leave existing callers unchanged. This avoids a canceled
old-account request escaping after a login switch.

`explore-changed` is a payload-free local event. Renderer invalidation reads a
snapshot without forcing a network refresh. This lets cached or incremental
results appear without query polling. Explore queries override global retry,
reconnect and focus defaults; one explicit event coordinator owns allowed
refresh triggers. Preserve per-platform loading/error/freshness separately from
whether cached data exists. A partial CVR count has null display total, not zero.

## Ranking and room-action rules

VRC uses descending valid aggregate occupants, then valid popularity, then
world ID. CVR uses descending verified public occupancy among complete totals;
unknown/partial totals follow in stable source order, then world ID. This only
ranks the bounded fetched set. Do not substitute category population for an
unknown public total. Missing optional counts are never negative or fabricated.

For All, take equal shares at total 2/4/6 and alternate pair leaders. Choose the
initial leader by lexicographic comparison of the leading world IDs without
platform labels, with complete ordered ID lists as the next tiebreaker. If the
candidate identities are exactly indistinguishable, use a neutral session seed
assigned to the input lists, not a fixed VRC-first fallback. Determinism includes
that seed; swap list identities and seeds together in symmetry fixtures. Backfill
unused slots from the other platform in native rank order. Dashboard always
calls the same selector with total 2, independent of the persisted Explore total.

Strictly accept VRC public and Group Public identifiers; reject malformed,
duplicate or unknown modifiers and private/friends/group-only variants. Do not
reuse the permissive public fallback in the existing friend-location parser.
For VRC room detail, verify world/room identity and require explicit permitted
access, `active=true`, `full=false`, `hasCapacityForYou=true`,
`roleRestricted=false`, `ageGate=false`, `closedAt=null` and `hardClose=null`
for an enabled Join. Missing eligibility evidence disables the action without
inventing a positive result. Queuing does not enable a full room. Preserve visible
public rows with disabled actions when they are full or otherwise ineligible.

CVR needs current explicit Public/Group Public access, not capacity/admission
evidence. Do not enable a Join from stale or contradictory access. Fresh cached
room evidence suffices; do not add a network preflight just for CVR admission.
If evidence expired, refresh through the sheet before issuing a new selection.

Selection references expire after five minutes or on identity/target change;
their cached access evidence is fresh for only 60 seconds. Main checks
the joining setting before any action work. VRC reuses fresh room evidence or
performs at most one budgeted revalidation, then rechecks identity, policy and
target after the await. A changed target returns review-required/stale rather
than launching a replacement. Construct links only from main evidence, validate
with the existing URL allowlist, then use `shell.openExternal`. The CVR API
`/instances/{id}/join` remains prohibited in this implementation.

Share the existing per-platform join in-flight lock and three-second cooldown
mechanism between friend and Explore actions. Preserve friend-keyed cooldown
semantics and add canonical destination protection across entry points; do not
change self-invite policy. Reuse the confirmation dialog and persisted
confirmJoin/joinMode preferences, but use a discriminated friend/explore target.
Do not create a synthetic Friend or weaken LocationAuthority. All join buttons
must observe one busy coordinator. A launch result means an attempt was handed
to the game, not guaranteed entry.

## Sequenced implementation units

The driver owns shared files and integration. Units are sequential until their
producer contracts and tests pass. Parallelism is optional, not a dependency.

### September 9 parallel-work split and dependency gate

The owner requested separate new API-safety and Explore tasks, with the original
conversation coordinating their handoff rather than owning implementation. The
dependency is **API safety → Explore live integration**, never the reverse.
The API task does not wait for Explore, avoiding a circular dependency.
This checkpoint prepares both lanes; it does not start implementation or an
overnight run. Existing scope approvals remain valid.

**Phase A, safe to develop alongside API fixes once execution starts:**

- New pure `src/shared/explore.ts` DTOs, `exploreRanking.ts`, synthetic parser
  fixtures and tests from unit 1. Parsers must not call adapters or fetch.
- Presentational world cards, contained sheet, sorting/filter/count behavior
  and sample Dashboard composition from units 4–5, supplied synthetic props
  and an injected fake data/action source in test or preview only.
- Component tests for loading/stale/error/unknown counts, Public/Group Public
  qualification, full CVR rooms, neutral ranking, keyboard/focus and unchanged
  Hot Instances placement. Join intent is a spy, never IPC or a real launch.
- Plan settings migrations and contracts, but delay wiring them into live
  routes, main initialization and production query behavior until phase B.

Fixtures must never substitute for production data or ship as a live discovery
fallback. Do not initialize a real adapter, attach real account storage or use
the authenticated image bridge for phase-A previews. No new sidebar route or
Dashboard hook may inadvertently trigger live discovery. Use synthetic images.

**API task owns:** `BaseAdapter`, platform API clients, shared pacing/cooldown,
session leases/cancellation, socket backoff, roster dedupe and existing
friend-query rate-limit handling. Explore must not independently edit these
files to build competing fixes. Keep the lanes in separate worktrees/branches.

**Phase B is blocked until API safety is verified and done.** The dependency
handoff must identify a stable, reachable commit/PR and provide:

1. Exact scheduler injection and request-option interfaces, rate-limit error
   behavior, session lease semantics and any changed caller contracts.
2. Passing focused physical-attempt, cross-path cooldown, stale-session,
   roster/deduplication and socket regression evidence on that commit.
3. Applicable local gates, final-head CI and required critical-risk reviews,
   with material findings resolved. No completion-by-self-report or mock-only
   assertion substitutes for source/review evidence.
4. Explicit state: committed/pushed, reviewed, merged or not merged. Completion
   of a task is not permission to merge. The Explore driver inspects the
   artifact, integrates the exact dependency through authorized git steps,
   and reruns relevant integration gates before adding consumers.
5. A recalculated Explore allowance and owner approval for that new traffic.
   Do not restore the withdrawn sixteen-request proposal automatically.

Only then implement real adapters/discovery service/IPC, production query and
settings integration, authenticated images and guarded joining from units 1–5.
Reuse the completed safety interfaces. A changed dependency head requires a
delta check; a timeout or unavailable required review keeps phase B blocked.
Do not bypass the gate with a separate queue, temporary direct fetch, relaxed
checks or live account probes. If phase A is finished first, checkpoint it and
stop at this gate. No recurring monitor or unattended schedule is implied.

### 1. Parsers, DTOs and safe request options

Own `src/shared/explore.ts`, `src/shared/exploreRanking.ts` and new platform-local
discovery parsers with colocated tests in phase A. In phase B, extend the adapter
interface and consume the verified API client's options in `VrcAdapter.ts` and
`CvrAdapter.ts`. Transport files remain owned by the API-safety task until its
handoff is complete.
Keep discovery access classification separate from existing friend parsing.

Reuse the API-safety task's no-retry policy and pre-dispatch lease admission;
add only the discovery-specific budget check through that reviewed interface.
Do not reimplement pacing or cancellation. CVR's current client hardcodes the `/1` auth host;
add a closed, main-only discovery route builder for the verified `/2` list and
`/1` world/room host, using existing private credentials and dispatcher. Never
accept a renderer URL, concatenate `/2` after `/1`, or change the auth host.

Gate with synthetic valid/missing/unknown/contradictory fields, GroupPublic
strings versus restrictive numeric group values, prototype keys, malformed
paths, duplicate tuples and mismatching identities. Prove the VRC 25/22 fixture
retains provenance. Strip member arrays. Run existing BaseAdapter, API client,
auth, credential and URL-builder regressions. Verify exact wire start times,
429 cooldown, unchanged existing retries and zero canceled-lease dispatches.

### 2. Main discovery service and IPC

Own new `src/main/services/explore.ts` and `src/main/ipc/explore.ts`, with
colocated tests; integrate `src/main/app.ts`, `src/main/ipc/index.ts`,
`rate-limit.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` and its bridge types.
Read main/services and IPC contracts before choosing any helper split.

Implement the cache, candidate promotion, explicit refresh reasons, request
budget, bounded round-robin CVR qualification, lazy sheets and local change
events. Wire AccountSession and identity-boundary cleanup once in main. Do not
instantiate another platform adapter. Add every new channel to trust/rate-limit
registration tests and the API catalog.

Gate using fake clocks and transports: repeated clicks/mounts/focus/reconnect,
zero requests before ready auth, two concurrent consumers sharing one batch,
budget exhaustion including errors, 429/401 stops, cancellation after queue
wait, stale result versus new account, one-platform failure, malformed pages,
1000 worlds/rooms with bounded processing, truncated and partial counts, and
absence of occupant data in renderer DTOs. Prove no timer restarts a batch.

### 3. Guarded discovery joining

Own new main discovery-target authority as part of the service or a focused
helper, the shared action limiter extracted from `ipc/instance.ts`,
`ipc/explore.ts`, `src/renderer/src/hooks/useJoinInstance.ts` and
`components/JoinConfirmDialog.tsx`. Keep friend-facing hook calls compatible.

Gate forged/expired/wrong-world refs, untrusted sender, disabled joining before
fetch, wrong-account action, account change during VRC refresh, hidden or
changed access, malformed launch URL, CVR full room allowed, VRC full room
denied, unknown VRC admission denied, confirmation cancel and duplicate friend/
Explore clicks. Preserve linked destination chooser, friend CAS review flow,
launch-mode behavior, self-invite and existing join tests. Stub the OS launcher;
tests must not open a real game or send invites.

### 4. Shared query, selection and persistence

Own `src/renderer/src/queries/explore.ts`, a focused `hooks/useExplore.ts`,
`src/shared/settings.ts`, `stores/settings.ts`, `stores/friends.ts` and
`hooks/useSettingsPersistence.ts` as needed, with colocated tests.

Add `exploreWorldsShown` and persist the existing global platform filter through
the settings path. Today that filter exists only in the transient friends store.
Hydrate the same selector without introducing a second Explore-only filter.
Bump settings version 8 to 9 and preserve forward-version downgrade protection,
unknown-key behavior, first paint and unrelated settings. Leave query response
persistence allowlists unchanged; discovery data stays memory-only.

Gate 2/4/6 defaults, invalid values, restart persistence, filter hydration and
no mount-time overwrite. Test ranking symmetry, neutral ties, empty/uneven lists
in both directions and all exact caps. Verify Dashboard total 2 and Explore
total 2/4/6 share query keys and make no duplicate requests. Account boundary
must discard old sheets, selections and late query responses.

### 5. Explore and Dashboard integration

Own new `components/ExploreView.tsx`, `ExploreWorldCard.tsx`,
`ExploreWorldSheet.tsx`; integrate `AppShell.tsx`, `Sidebar.tsx`,
`DashboardView.tsx`, `stores/ui.ts`, relevant styles and both
`locales/en/translation.json` and `locales/ja/translation.json`.
Reuse `NumberStepper`, platform filtering, image bridge, tokens and the
contained interaction pattern in `HotInstanceSheet.tsx`.

Replace the `instances` route consistently, including navigation/type tests.
Do not rewrite the Hot Instances card to serve public discovery. Dashboard's
current early return for missing friends must not suppress independent Explore
results. Preserve its existing social error/empty states within their sections.

Gate one mixed grid, default4, control bounds, independent loading/stale/error,
unknown count versus zero, partial room results, disabled room actions, full
CVR visibility, sheet focus/dismissal/sidebar access and filter preservation.
Test dashboard section order and continued operation when friends fail but
discovery succeeds and vice versa. Verify unchanged threshold, exact grouping,
six Hot Instance cards, linked profiles and linked destination joining.

### 6. Documentation, runtime verification and delivery

Update `docs/DESIGN.md`, `docs/design.html`, `docs/glass.html` with the approved
Explore design and the CVR override, explicitly distinguishing planned from
implemented behavior until verified. Update `docs/INTERNAL-API.md`,
`docs/api-policy.md`, `docs/api-volatility.md`, `CHANGELOG.md` and affected DOX
contracts/indexes. README changes only where feature status becomes outdated.
Do not introduce a new documentation framework.

Run focused tests after each unit. At integration, run `npm test`, then
`npm run lint && npm run format:check && npm run build`. Build includes both
TypeScript checks and the entry-chunk assertion. Read exit statuses and report
failures; do not substitute a compilation pass for runtime evidence.

Use `verify-electron` against the actual app for dark/light/grayscale/narrow,
uneven platform data, keyboard interactions, settings restart and unchanged
Hot Instances/linked UI. Start with synthetic isolated test data and no saved
sign-ins. Screen capture needs explicit one-time approval for each target.
Do not rerun the real-account diagnostics to prove route existence. Any new
live-account smoke or actual Join needs scoped authority.

Run `review-loop` before a PR. The queue, account-boundary and discovery-join
changes have credible account-risk consequences and require the critical-risk
review lane unless concrete implementation evidence narrows that classification.
Same-lineage review is not independent external confirmation. Preserve required
CI and external-review gates; a missing required review means a bounded handoff.
Leave the PR open without merge authority. Use `cut-release` before handing the
owner an installable build, including any local prerelease. Do not overwrite the
installed app or claim a test package is released.

## Acceptance coverage and remaining authority

Preparation checks passed: Markdown formatting, local handoff links, six-unit
structure and whitespace validation. Current main and merged linking PRs were
read directly from GitHub. No application build or feature tests were run for
this documentation-only pass. Existing design guides, runtime API catalog,
API policy, README, changelog and root/child contracts remain unchanged until
implementation changes the behavior they describe. No documentation directory
boundary or owning contract was added. The planning skill shaped the sequencing
and acceptance checks, not a new product design.

| Requirement                                       | Unit and decisive evidence                                            |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| Both platforms have truthful discovery paths      | Completed feasibility record; unit 1 parser/route tests               |
| CVR public/group-public, including full rooms     | Units 1–3 and 5; mixed-access/full-room fixtures                      |
| Accurate count meaning and partial states         | Units 1, 2 and 5; divergent VRC counts and incomplete CVR aggregation |
| Bounded scalable traffic, no crawler              | Units 1–2; rolling-budget, wire-time, retry and large-input tests     |
| Account isolation and safe actions                | Units 2–3; queued epoch switch, forged refs, CAS, launch allowlist    |
| Neutral 2/4/6 grid and persisted filter           | Units 4–5; symmetry, limits and restart tests                         |
| Shared Dashboard preview, unchanged Hot Instances | Units 4–5; shared-fetch count, order and regression tests             |
| Accessible real application                       | Units 5–6; interaction tests and consented Electron observations      |
| Deliverable without hidden review gaps            | Unit 6; documented final-head tests, review and CI                    |

The driver's plan self-check covered original requirements, the later CVR
override, current source paths, producer/consumer sequencing, failure paths and
preservation of existing controls. No new discovery endpoint or product redesign
is required. The unknown reason for VRC count divergence and unsampled numeric
CVR group values are bounded by explicit parser behavior, not hidden blockers.

Complete the separately approved traffic-hardening prerequisites, then revise
the withdrawn request-ceiling proposal. Explore implementation
approval must cover the disclosed changes to discovery traffic and guarded
discovery joining; it does not imply live account testing, automatic joining,
merge authority, a release or an unattended work schedule. An overnight run also
needs its duration/usage bounds and stopping rules under `autonomous-work-block`.

Next safe action is the linked traffic-hardening plan, not Explore unit 1.
After its verification and revised Explore approval, start Explore on a
non-protected feature branch from the then-current baseline, update the tracked
issue appropriately, and keep checkpoints per completed unit. Do not reopen
approved layout or CVR fullness decisions. This preparation made no
application-source edits.
