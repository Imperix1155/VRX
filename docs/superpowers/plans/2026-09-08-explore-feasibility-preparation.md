# Explore feasibility preparation

Status: planning checkpoint, September 8, 2026. Josh authorized preparing the
feasibility and safe-joining plan, then approved the bounded read-only check
subject to API rules. He then explicitly approved a temporary diagnostic build,
restarting VRX and normal saved-session revalidation. The diagnostic stopped
before discovery after one successful VRChat validation. The original app is
running again. Josh then explicitly approved a corrected rerun with one
additional VRChat validation, retaining the six-discovery-request cap and no
retries. That rerun completed successfully and the original app is confirmed
running again. Initial activity counts were observed on both platforms; CVR
public-room detail was observed. Josh subsequently settled the CVR room-based
display/count rule and authorized further testing if needed, including the
disclosed restart and saved-session validation. A VRChat-only room-detail
follow-up completed under that grant and observed Group Public room detail.
The original app was restored. The subsequent
[implementation plan](2026-09-08-explore-implementation-plan.md) now defines
bounded loading, interfaces, implementation units and checks. Its proposed
production request ceiling awaits owner approval. Explore implementation,
unattended work and merging remain unauthorized.

## Approved outcome and provenance

Explore replaces Instances with one mixed Popular now world grid. Preserve
All/VRC/CVR, persisted 2/4/6 worlds with default 4, platform-native ranking,
deterministic neutral interleaving and symmetric backfill. A contained world
sheet lists visible permitted rooms. Dashboard uses up to two cards from the
same ranked cache above unchanged Hot Instances. Missing data must not produce
invented rooms, fields, join eligibility, or empty balancing cards.

The approved design and preliminary handoff remain authoritative except where
the later CVR owner clarification below supersedes their CVR fullness and
eligibility exclusions:

- [Approved design](../specs/2026-09-04-cross-platform-explore-design.md)
- [Preliminary handoff](../specs/2026-09-05-explore-planning-handoff.md)

Both originated in the separate source checkout at `/Users/imperix/dev/vrx`.
Copies with continuation notices are now available beside this plan.
Its current head is `710275819d3924aae7da59b2d5a3f9416249d4b0`, on
`imperix/vrx-270-explore-design`, 16 commits ahead of its locally known upstream.
The earlier handoff head is `146444a9585a775b1cbee44aba2f74c415e8bf63`.
The intervening diff changes only review/workflow files and the root contract;
the approved Explore documents and application source did not change.
Untracked `.codex/` and `.superpowers/` directories were left untouched.

At the initial feasibility checkpoint this task's checkout was detached at
`60ce0a05f21e7b2d6f6d58e45653b6103f59f546`. This document is saved here, not in
the source checkout. No branches were switched or fetched during that initial
pass. Remote PR status and linking completion were not established then. The installed app was
subsequently identified for the authorized diagnostic, as recorded below.
The implementation plan records the later reconciliation to main `9dbac8b`,
with linking PRs 299, 302 and 303 confirmed merged. This checkout now uses
`imperix/vrx-270-explore-plan` on that baseline. Explore remains outside the
separately scoped linking run; completion of linking is not an execution grant.

## What the evidence establishes

Public sources were read without platform credentials or requests to either
game API. The community specification and companion source are evidence of
documented behavior, not proof against Josh's current sessions.

### VRChat

The community specification was pinned to
`5542b9951b2872a0735e30d6ca0e47509814b346`:

- [World routes](https://github.com/vrchatapi/specification/blob/5542b9951b2872a0735e30d6ca0e47509814b346/openapi/components/paths/worlds.yaml)
  document authenticated `GET /worlds/active`, world detail at
  `GET /worlds/{worldId}`, and instance detail at
  `GET /worlds/{worldId}/{instanceId}`.
- [LimitedWorld](https://github.com/vrchatapi/specification/blob/5542b9951b2872a0735e30d6ca0e47509814b346/openapi/components/schemas/LimitedWorld.yaml)
  lists identity, title, image and aggregate activity fields, including
  `occupants` and `popularity`. It does **not** list an `instances` field.
- [World](https://github.com/vrchatapi/specification/blob/5542b9951b2872a0735e30d6ca0e47509814b346/openapi/components/schemas/World.yaml)
  describes an instance array whose entries are triples of instance identifier,
  occupant count and language-share data. It says instance lists are empty and
  activity fields can be zero when unauthenticated. Probe tuple lengths and
  member types; do not hard-code an older two-element assumption.
- [Instance](https://github.com/vrchatapi/specification/blob/5542b9951b2872a0735e30d6ca0e47509814b346/openapi/components/schemas/Instance.yaml)
  describes activity, fullness, capacity, access and restriction fields. It does
  not establish a universal positive joinability predicate. Optional fields and
  API defaults must not be treated as proof that this account can enter.

Planning consequence: an initial world list followed by lazy world detail is
source-supported. Partial room data on the active-world list remains an
optimization to investigate, not a prerequisite or a promised response shape.
Aggregate population must not be reported as visible-room occupancy.

### ChilloutVR

CVRX was pinned to `f7b3d197c0960238d29facb41a9d706fc44eaa4e`:

- [HTTP API implementation](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/server/api_cvr_http.js)
  supplies world detail, instance detail, category-based world lists and random
  worlds. Its category helper uses API version 2; world and room detail use
  version 1.
- [ActiveInstancesRefresh and WorldCategories](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/server/data.js#L1461)
  resolve the discovery path. `WorldCategories.ActiveInstances` is `wrldactive`.
  CVRX requests that category with page 0, `sort=Default`, and
  `direction=Ascending`, reads `entries` and `totalPages`, then requests each
  world and iterates its `instances` to retrieve room details. Josh's observation
  that CVRX displays open public rooms led to this source trace.
- [World detail presentation](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/client/astrolib/details_constructor.js#L360)
  counts visible instances from the active-instance collection by world ID.
- [WebSocket implementation](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/server/api_cvr_ws.js)
  maps friends, invites and account notifications. It does not establish a
  public-discovery stream.
- The HTTP module's `GET /instances/{id}/join` performs a join action. A GET
  method alone does not make a route suitable for a read-only probe. Exclude
  that route and all account actions.

Planning consequence: the discovery-to-room path is source-supported. The
earlier wrapper-only search was incomplete, not evidence against availability.
The current response fields, public-access semantics and meaning of the default
ordering still need verification. CVRX follows all pages and fetches details for
every world and room, then supplements its collection with friend locations.
Explore must use a bounded candidate load, lazy drill-in and its own discovery
collection. It must not copy that fan-out, friend supplementation or member
enumeration.

CVRX's commented world example includes room `playerCount`, `maxPlayerCount`
and `region`. Treat that example as historical field candidates, not a live
schema. Whether the initial category entries expose enough activity information
to rank and display truthful counts without per-world startup requests is the
remaining key CVR feasibility question.

### CVRX behavior traced after the owner's follow-up

The same pinned source establishes the following producer/consumer chain:

1. `server/data.js` `ActiveInstancesRefresh` reads every page of the active-world
   category, requests every returned world, then requests every room listed in
   each world. Base discovery traffic is category pages + worlds + rooms, before
   image enrichment and the separate friend-room additions.
2. `ActiveInstancesUpdate` supplements that discovered set with the current
   user's and friends' room IDs. It merges friend information into room members,
   removes rooms with no resulting members, and replaces `currentPlayerCount`
   with the resulting member-list length. That displayed count is therefore
   locally adjusted; it is not proof of an untouched API population field.
3. [The frontend room list](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/client/frontend.js#L2143)
   prioritizes the current user's room, then friend count, then total player
   count. The world sheet filters this same combined collection by world ID.
   The result is not a pure public-popularity ranking, even though public-room
   discovery is one of its inputs.
4. Manual refresh and window focus call the same refresh function, with a
   60-second cooldown enforced by CVRX's main process. Full discovery also runs during initial data
   loading. The inspected recurring update block has full instance refresh
   commented out; friend updates can still update the combined collection.
5. [World card rendering](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/client/astrolib/user_content.js#L1175)
   consumes `world.playerCount` when present. The category wrapper at
   `server/data.js` line 2246 loads images and returns `reqResult.entries` without
   calculating a player count. This is source evidence for a list-level count
   candidate, but does not prove `wrldactive` returns it or that it counts only
   public-room occupants. Those are explicit questions for the bounded probe.

For Explore, keep candidate retrieval separate from room-detail enrichment.
If `wrldactive` exposes a suitable population signal, rank its bounded returned
world set directly, then request that world's rooms when opened. Use aggregate
counts supplied by the service rather than reconstructing counts from members.
Verify pagination and ordering semantics before claiming the selected subset is
the platform's most popular set. If the available count includes private rooms,
it cannot silently acquire the approved CVR public-occupancy meaning.

This trace explains the source implementation, not current account behavior.
The source trace itself made no authenticated requests, enumerated no members
and launched no game. The separately approved live diagnostic is recorded below.

The preliminary handoff references saved API research without giving its
location. A search of the repository Markdown documents did not locate a
separate discovery research artifact. This pass independently established the
routes above from pinned public source. Recovering the earlier research may add
context but is no longer a prerequisite for identifying the CVR discovery route.

## Existing application boundaries

These paths were inspected in the source checkout:

| Existing component                                                 | Verified behavior                                                                                                                                 | Proposed Explore use                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/main/services/adapters/IPlatformAdapter.ts`                   | Friend retrieval, instance detail and pure join URL construction; no discovery method                                                             | Add discovery methods only after evidence fixes their semantics                                     |
| `src/main/services/adapters/BaseAdapter.ts`                        | Queued requests, one request/second plus jitter, timeouts, rejected redirects, up to three retries after 429                                      | Reuse pacing in production; a probe needs a stricter wire-attempt budget and immediate failure stop |
| `src/main/services/adapters/VrcApiClient.ts` and `CvrApiClient.ts` | Authenticated transport in main; CVR unwraps the response data envelope                                                                           | Keep credentials and raw responses in main; normalize only verified data                            |
| `src/main/services/accountSession.ts`                              | Ready account identity plus an epoch                                                                                                              | Bind discovery cache, pending work and action selection to the account and epoch                    |
| `src/main/ipc/instance.ts`                                         | Requires a friend ID, resolves the current friend through LocationAuthority, compares expected target, enforces joining setting and URL allowlist | Preserve friend joining; propose a separate discovery authority behind the same launch safeguards   |

The current transport automatically retries rate limits and replaces the
caller-provided abort signal. Simply calling it three times would not prove a
three-wire-request cap or an overall cancellation deadline. Resolve this in a
disposable probe design and verify it with a fake transport before live use.
Do not weaken production request behavior for an experiment.

## Proposed bounded probe

This is the approved request budget and proposed integration design. Before
execution, pin the completed runner, prove its limits offline and identify the
selected existing sessions. Josh approved the bounded read-only check after
being told account execution needed approval. No credentials
go into shell arguments, environment dumps, chat, fixtures or files.

### VRChat manifest

At most three sequential wire attempts in one approved run:

1. Read `/worlds/active?n=2` once. Record structural evidence for world identity,
   name, image and activity fields, plus whether partial room information exists.
2. If a structurally usable candidate exists, read `/worlds/{worldId}` for only
   the first usable returned candidate. Confirm the room container, tuple
   structure and counts. The identifier remains in process memory.
3. If that world supplies an explicitly public room with a valid identifier,
   read `/worlds/{worldId}/{instanceId}` for only that returned room. Record
   structural evidence and local eligibility checks without joining it. If a
   safe target cannot be selected, finish with an inconclusive room-detail result.

The result is a small feasibility sample, not a guarantee of complete coverage,
ranking correctness, or eligibility across every room type.

### ChilloutVR manifest

At most three sequential wire attempts, using the existing account headers:

1. Read `/2/worlds/list/wrldactive?page=0&sort=Default&direction=Ascending` once
   against `https://api.chilloutvr.net`. Inspect the data envelope, `entries`,
   pagination metadata and structural availability of activity/room counts.
   Do not follow pages or assume a supported page-size parameter.
2. If a usable candidate exists, read `/1/worlds/{worldId}` for only the first
   usable returned entry. Inspect its `instances` array and room identity,
   occupancy, capacity, region and visibility evidence. Do not fetch images.
3. If a structurally valid room is returned, read `/1/instances/{instanceId}`
   for only that room. Check privacy/access and availability fields locally.
   Receiving a room in a world response does not itself prove public access;
   verify the detail response and do not enable or attempt joining.

No extra calls are permitted to compensate for absent activity counts. If the
category response cannot support the approved ranking and visible counts within
the bounded initial load, record the conflict for planning instead of fetching
every world. Unknown default sort semantics remain unresolved unless the
response or maintained source explains them; one small sample cannot prove a
global popularity ordering.

### Shared limits and output

- Use only VRX's saved primary sessions. The later restart grant permits at
  most one normal saved-session validation per platform, including normal secure
  credential persistence if validation rotates a token. No password login,
  session import, logout or account switching. Stop if validation fails.
- Space probe requests at least 60 seconds apart. This is a conservative
  experiment budget, not a proposed change to production pacing. Coordinate
  with existing traffic through the main request boundary.
- Each platform's maximum duration is four minutes; a combined run is at most
  eight minutes and six discovery wire attempts, including queue waits and response
  reads. The two possible saved-session validations bring the whole diagnostic
  ceiling to eight wire attempts, also separated by at least 60 seconds. Allow
  15 seconds per wire response and a 2 MiB decoded-body ceiling.
  Abort on the first exceeded limit. No automatic retries or pagination.
- Stop on any non-success response, redirect, network error, rate limit,
  malformed response or account-epoch change. Report a fixed failure category,
  not a raw error body. Empty data is inconclusive, not proof of impossibility.
- Output only allowlisted field labels, presence/type summaries, tuple lengths,
  aggregate counts and fixed validation outcomes. Never recursively dump raw
  keys: a dynamic object key can itself contain an identifier or private value.
- Do not traverse occupant records, author profiles, user icons, tokens or
  embedded identity objects. If the server includes them, discard them without
  logging or retaining them. Keys-only reporting does not mean the server
  transmits only keys; response values necessarily pass through process memory.
- Do not request images, enumerate occupants, launch either game, send invites,
  open another WebSocket, change settings or write game-account data.
- Erase transient response references and return one terminal result:
  source-supported-and-observed, inconclusive, or failed with a fixed reason.

Offline runner checks must prove the exact attempted-request count, no retries
after 429, immediate epoch-change cancellation, queue deadline enforcement,
response byte limits, no redirects, and output redaction using synthetic data.
The disposable implementation and offline checks are recorded below. The
manifest alone is not evidence of successful live verification.

### Offline controller checkpoint

A disposable, network-disconnected controller and its synthetic tests are saved
at `/private/tmp/vrx-explore-probe.QklwRr/controller.mjs` and
`/private/tmp/vrx-explore-probe.QklwRr/controller.test.mjs`. These are temporary
files, not committed or packaged application code. They have no credential
reader or live transport and cannot make an API request by themselves.

The controller and transport suites now pass 18/18 tests together. They exercise
six sequential discovery calls spaced at least 60
seconds apart, one-attempt stopping on 429, unavailable-session denial,
account-boundary cancellation, epoch changes and deadlines during queue waits,
oversized/malformed/redirected response rejection, and redaction of dynamic
keys, identifiers, embedded members and raw transport errors.

The transport checks add exact route/method allowlisting, a permanent stop after
failure, per-stage attempt budgets, concurrent-call rejection, and rejection of
password authentication. A composed synthetic run covers both saved-session
validations plus six discovery requests. These are offline checks, not evidence
of successful live requests.

Read-only process checks found a running packaged VRX and no listening TCP
diagnostic connection on that main process. No development Electron process was
found. The repository has no existing discovery-probe hook; its credential
persistence probe is a separate synthetic test and is unsuitable for this.
No screen or debugger capture was used.

### Approved diagnostic integration

Josh explicitly approved the temporary diagnostic restart and possible normal
saved-session revalidation after their effects were explained. This extends the
earlier manifest only as described above; no further account actions are allowed.

The installed app is `0.20.0-local.20260907.9f9b44f`, from source commit
`9f9b44f0b12f3d9b1c0cf9a2512ef8abee4f5dee`. A disposable copy under the same
temporary directory preserves its packaged dependencies. Its early main-process
hook runs the diagnostic instead of normal UI, friends, sockets, imports and
updater startup. The original `/Applications/VRX.app` bundle is unchanged.

The copied package passed an isolated offline startup, ASAR integrity update and
ad-hoc signature verification. Its main process uses the original credential
store and saved-session adapters. Credentials stay in memory or the normal
encrypted store; deletion is disabled and no credential values, raw response
bodies or account identifiers enter the report. A strict transport intercepts
all diagnostic requests, denies retries and redirects, and applies the shared
60-second wire spacing. A 12-minute in-process deadline and 13-minute external
supervisor bound the run. The supervisor reopens the original app on exit.

The first launch stopped before any wire request. The normal adapter's
15-second timer expired during the diagnostic's deliberate 60-second wait.
The transport now starts a fresh wire timeout after the queue wait for the two
saved-session validations. Discovery keeps its phase cancellation. A regression
test and composed eight-request simulation passed before a second launch.
The first attempt's sanitized artifacts are retained as `attempt1-progress.jsonl`
and `attempt1-result.json`. The original app was restored before the second run.

### Live attempt outcome and remaining blocker

The second run made exactly one diagnostic wire attempt, VRChat saved-session
validation, which returned HTTP 200 and authenticated status. CVR returned the
runner's fixed `unavailable` outcome before any CVR wire attempt. No discovery
request ran on either platform. The process exited without timing out and the
supervisor reopened the original app. A process/executable-path check confirmed
the running app was `/Applications/VRX.app/Contents/MacOS/VRX`.

Investigation found a concrete diagnostic defect. The installed CVR adapter's
saved-session route is `https://api.abinteractive.net/1/users/auth`, while the
probe's allowlist only permitted the CVRX discovery host. A regression derived
from the actual installed bundle reproduced that rejection offline, then passed
after adding only the installed adapter's saved-session route. This does not
establish that Josh's CVR credentials are missing or invalid. The first runtime
report did not distinguish a missing local session from a local route rejection.

The corrected transport passes all 18 offline tests. Josh explicitly approved
one additional VRChat validation for the corrected rerun, which completed.
The six-discovery-request cap, at most one CVR validation in this rerun,
60-second spacing and no-retry constraints remain unchanged. This grant does
not authorize an unbounded sequence of attempts.

Sanitized second-run evidence remains in `attempt2-progress.jsonl` and
`attempt2-result.json` in the temporary directory. The result's `attempts: 0` counts
discovery only; the progress record establishes one additional auth wire attempt.
Do not report the whole run as zero requests. Temporary diagnostic files remain
available for inspection; the installed application bundle was not overwritten.

### Completed corrected run

The corrected run returned `sample-complete`. Its seven diagnostic wire attempts
were two normal saved-session validations and five discovery requests. Every
attempt returned HTTP 200. No retry, join, image fetch or occupant-enumeration
request occurred. The controller deliberately omitted VRChat room detail because
no returned identifier matched its narrow plain-public selection rule.
The external supervisor recorded exit code 0 without timeout, and an exact
executable-path check confirmed the original installed app was running again.

Observed data, with identities and raw responses excluded:

- VRChat's two active-world entries supplied `occupants`, `popularity` and
  `capacity`, plus string identity/name/image fields. Neither had `instances`.
  Initial occupancy counts were 719 and 532. These are sample values, not
  constants or comparable CVR ranking scores.
- The selected VRChat world's later detail reported 666 occupants and 16 room
  entries. The first two room tuples had three members of types string, number,
  object. Counts were captured at different times and need not match.
- CVR's active category returned one page with one world and `playerCount: 5`.
  Its world detail contained one room with `playerCount: 5` and
  `maxPlayerCount: 100`.
- CVR's room detail reported `currentPlayerCount: 5`, `maxPlayer: 100`, a
  string region, and both privacy fields equal to `Public`. World room summaries
  and room details therefore use different count/capacity field names.

The latest sanitized evidence is `progress.jsonl`, `result.json` and
`supervisor.json` under the temporary directory. An assertion check verified
seven requested events, seven HTTP-200 received events, five discovery attempts,
and zero VRChat room-detail attempts. Across all three diagnostic launches,
eight diagnostic wire requests were sent, including the earlier successful
VRChat validation; normal app startup traffic is outside these probe counts.

Planning consequence: both initial lists expose activity without room fan-out.
CVR's observed count matched one explicitly public room in this sample, but that
does not prove public-only semantics across other categories or room sets.
Neither global default ordering nor a positive account-specific join predicate
was established. VRChat room detail remains unsampled, not unavailable.
The [API volatility registry](../../api-volatility.md#explore-discovery-feasibility-september-8-2026)
now records these observations separately from shipped behavior.

## Authorized VRChat room-detail follow-up

After the remaining permission boundary was explained, Josh said to test if
needed. The first sample skipped room detail because its selector admitted only
plain numeric public IDs with an optional region. The source parser documents
Group Public identifiers as a group tag plus explicit public group access.
That makes a follow-up useful without repeating CVR testing.

The follow-up permits at most four diagnostic wire attempts: one normal VRChat
saved-session validation, one active-world list, one returned world's detail,
and one explicitly Public or Group Public room returned by that world. No
password login, CVR credential read/validation/request, retry, join, image fetch
or occupant enumeration is included. Unknown, conflicting, duplicated or
restricted access tags are rejected. Selection is permission to inspect the
returned room only, not permission to join.

The copied app reuses the original main-process session store and guarded
transport. Requests are spaced at least 60 seconds apart, including validation;
wire responses have a 15-second timeout and 2 MiB body limit. The process has a
six-minute deadline and its restoring supervisor has a seven-minute deadline.
The original installed app is not overwritten. Before launch, all 21 offline
checks passed, including VRC-only isolation, Group Public selection, restricted
target rejection, redaction and a composed four-request schedule.

The prior completed controller, transport and live entry were preserved with
`completed-` filename prefixes in the existing temporary directory before
editing. New output uses `vrc-followup-progress.jsonl`,
`vrc-followup-result.json` and `vrc-followup-supervisor.json`; earlier run
artifacts remain intact. Additional allowlisted observations cover occupancy,
capacity, queue, access and restriction fields from the pinned community
Instance schema. Raw identifiers, token-like fields and member data are excluded.

### VRChat follow-up result

The follow-up completed with four diagnostic wire attempts, all HTTP 200:
saved-session validation, active-world list, selected-world detail and one
returned room's detail. There were three discovery attempts, no CVR requests,
no retries and no join actions. The supervisor recorded exit 0 without timeout.
An exact process/executable-path check confirmed the original installed VRX app
was running again after restoration.

The selected world returned 11 room tuples. The strict local identifier parser
classified ten as Public and one as Group Public. These ten Public classifications
are identifier-based evidence only; their room-detail responses were not fetched.
The sampled room detail explicitly returned `type: group` and
`groupAccessType: public`, confirming the Group Public response path.

Observed room detail included:

- `capacity: 50`, `recommendedCapacity: 50`, `n_users: 25`, `userCount: 22`;
- `active: true`, `full: false`, `hasCapacityForYou: true`;
- `roleRestricted: false`, `ageGate: false`, `closedAt: null`, `hardClose: null`;
- `queueEnabled: true`, `queueSize: 0`, `canRequestInvite: false`;
- string region, instance ID and world ID fields, without retaining their values.

This confirms a world-list to world-detail to Group Public room-detail path,
not universal join eligibility or live coverage of every access/restriction
combination. The initial active-world entries still lacked `instances`, so the
world-detail request remains the observed room-discovery step.

`n_users` and `userCount` differed within the same response. Do not treat them as
interchangeable aliases, sum them, or claim the difference measures departures.
Preserve their provenance and define a primary display source in parser planning;
their refresh/aggregation semantics were not established by this sample. The
[community world-instance reference](https://vrchat.community/reference/get-world-instance)
lists both fields but does not explain the difference. No further account
request was made to investigate it.

The result and progress assertions passed: four requested events, four HTTP-200
received events, only VRChat traffic, three discovery attempts, and an explicitly
Group Public detail response. This closes the missing room-detail route check.
No further live probe is needed merely to prove that route exists.

## CVR follow-up, September 8, 2026

Josh asked to tackle the remaining CVR questions. This follow-up used public
source and the completed sample only. No further account request, app restart,
room join or implementation occurred. The planning workflow keeps the approved
public-count meaning intact until an explicit decision changes it.

### Evidence boundary

- CVRX's pinned `UpdateWorldsByCategory` uses `Default` and `Ascending`, follows
  `totalPages`, and forwards entries without computing `playerCount`.
  `ActiveInstancesRefresh` uses the same options before world/room enrichment.
  This establishes client behavior, not server-side count or ordering semantics.
  [Source](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/server/data.js#L1428).
- A separate native-menu extension explicitly adds current/friend rooms to
  Active Worlds. Its generated world records assign `UsersInPublic = 0`, not
  friend count. That is corroborating evidence that public population and
  friend-room visibility are separate concepts, but it does not map REST
  `playerCount` to the game's public-count field or prove server behavior.
  [Extension purpose](https://github.com/LensError/LensErrors-CVR-Mods/blob/c5b2f7de9ba0fa60296a0c7352506412211db1be/ContentMenuTweaks/README.md),
  [implementation](https://github.com/LensError/LensErrors-CVR-Mods/blob/c5b2f7de9ba0fa60296a0c7352506412211db1be/ContentMenuTweaks/FriendInstanceInjector.cs).
- CVRX's instance-details Join buttons construct and open a deep link. The
  inspected button path does not test account-specific eligibility or capacity.
  It must not be used as proof that a visible instance is safe to enable in VRX.
  [Button implementation](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/client/astrolib/details_constructor.js#L2235).
- The [official deep-link documentation](https://docs.chilloutvr.net/chilloutvr/game/deep-link/)
  establishes the launch mechanism and desktop/VR modes, not a dry-run admission
  guarantee. No link was activated. The API join route remains excluded from
  diagnostics even though its HTTP method is GET.

The wider public-code search found no server count calculation or verified
player-count sort parameter. The referenced archived `jaquadro/chilloutvr_rs`
repository returned 404; it supplied no additional evidence. These are search
limits, not proof that documentation cannot exist elsewhere.

### CVR planning disposition before owner clarification

Historical analysis. The owner clarification below supersedes the proposed
spare-capacity action gate and the unresolved card-count choice.

1. **List-first loading is observed.** Parse the list's nonnegative integer
   activity separately from room occupancy. Missing, malformed or negative
   values are unknown, never fabricated zeroes. Carry count provenance so a
   reported category count cannot silently become verified public occupancy.
2. **Ranking need not depend on an undocumented default sort.** Proposed local
   ordering is valid reported activity descending, then a stable world-ID
   tiebreaker, with unknown counts after known counts. Apply it only to the
   bounded fetched candidate set before cross-platform merging. Do not describe
   the result as the global top worlds when pages were not fetched. Selecting a
   production page budget or changing refresh traffic still needs the normal
   account-risk gate; this follow-up adds no polling or fan-out.
3. **Public-only counts remain unresolved.** The live category count of five
   matched one explicitly public room with five players, but no mixed-publicity
   world was observed. Repeating the same kind of sample would not establish a
   universal rule. Summing only verified public rooms can provide a known-public
   subtotal, but must be marked incomplete when rooms are unverified. It cannot
   silently replace the full approved count.
4. **Room detail has usable observed fields.** Normalize world-summary
   `playerCount`/`maxPlayerCount` separately from room-detail
   `currentPlayerCount`/`maxPlayer`. For future action planning, require a
   current-session, main-owned selection, exact instance/world binding, fresh
   explicit public privacy and valid spare capacity. Deny known restrictions;
   unknown or conflicting access/capacity does not enable an action. These are
   proposed preconditions for a user-initiated attempt, not proven admission.
   GroupPublic and other unobserved room classes are not silently treated as
   ordinary Public rooms. Final eligibility and restriction coverage remain open.

The existing CVR resolver already handles identity, world binding, occupancy
and privacy, but does not normalize capacity. The existing friend-join helper
checks friend location, not public discovery eligibility. Extend the owning
adapter/resolver contract deliberately in a later authorized implementation;
do not fabricate a friend or reuse that helper as discovery permission.

### Earlier count proposal, superseded

Recommendation: preserve fast cards by displaying the category's value as
reported activity, not a verified public-only total, while keeping room rows
strictly tied to verified public-room evidence. This changes the approved CVR
card-count meaning and is a proposal only. Benefit: no additional initial room
fan-out. Risk: the activity count may include players outside displayed public
rooms. Ranking would describe that reported activity within the fetched set.

Alternatively, retain the public-only contract and leave the count unknown
until sufficient public-room evidence exists. This preserves the meaning but
withholds a useful initial number and leaves count-based ranking incomplete.
Do not resolve the tradeoff by silently increasing account traffic or relabeling
the count. Josh subsequently chose the room-based rule below instead.

### Approved CVR clarification from the owner

Josh chose room access as the basis of CVR discovery: include Public and Group
Public rooms, and display their worlds. A world's publish visibility is not an
instance's access type; use the room's explicit access classification. Exclude
friends-only, private and unknown-access rooms from this discovery collection.
Deduplicate worlds across qualifying rooms and base public occupancy on those
rooms' reported counts, not an unverified category aggregate. Missing or partial
counts remain unknown or incomplete, not invented totals.

Fullness and account-specific admission checks are not CVR discovery filters
or required preflight probes. Keep qualifying full rooms/worlds displayed.
A user-initiated Join is an attempt handled by the game, not a guarantee of
entry. Do not require spare-capacity evidence to show or enable that attempt.
Retain trusted IPC, current-session main-owned targets, explicit Public or
Group Public classification, URL allowlisting, the joining setting, user
confirmation, cooldown and launch mode. No automatic joining, permission bypass
or use of the API join action as a diagnostic is authorized.

Group Public is explicitly in product scope. Its CVR wire mapping still needs
defensive parser coverage; unknown access must not be guessed public. Its
inclusion no longer needs another product approval. The owner's observation
that CVR generally has few public worlds is context, not a fixed two-world cap.
Preserve the approved 2/4/6 controls, neutral merge and symmetric backfill.

Scale through bounded, paced category/world/room loading, deduplicated requests
and account-scoped caches. Do not copy CVRX's unbounded all-world/all-room fan-out
or create a continuous crawler. Obtain enough room evidence before promoting a
candidate to the confirmed discovery set. Missing metadata does not justify
private-room leakage. Set the concrete production request budget in the
implementation plan under the existing API etiquette contract. This
clarification does not authorize another live probe.

This addendum supersedes the earlier reported-activity recommendation and CVR
spare-capacity/positive-admission requirement. It does not change VRChat policy,
friend-based Hot Instances, or authorize feature implementation. The original
design file remains a historical approved snapshot in the source checkout;
carry this addendum into its next authorized design synchronization.

## Proposed safe discovery joining

The main process should issue an opaque selection reference only for a room
that came from a permitted discovery response in the current ready session.
The renderer selects that reference; it cannot supply an arbitrary launch URL
or manufacture a friend identity. This is a proposal, not an implemented API.

At action time, main would resolve the selection, check its account/epoch and
expiry, enforce the current Join setting, and obtain sufficiently fresh room
evidence through the shared queue. After every asynchronous step, recheck the
session and target before constructing an allowlisted URL. Preserve the existing
confirmation, launch mode, cooldown and duplicate-action protection. Coordinate
those action limits across friend and discovery joining.

For VRChat, define a positive platform-specific
eligibility predicate from evidence, including supported restrictions, full or
closed rooms and account capabilities. Unknown eligibility must fail closed.
The platform remains authoritative and can refuse entry after the last check;
the UI must not promise admission. CVR follows the owner's simpler rule above:
explicit Public/Group Public is sufficient access classification for offering
a guarded user-initiated attempt, without an extra fullness/admission probe.

Mandatory synthetic checks include forged/expired selection, wrong world,
account switch during refresh, stale response overwriting a new session, room
becoming hidden/unavailable, disabled joining and malformed launch URLs.
Test VRChat fullness policy separately; CVR fullness must not remove otherwise
qualifying rooms or introduce a capacity-based action gate.
Keep the existing friend-joining regression tests.

## Work sequence after feasibility

1. Runner preparation and scoped runtime approval are complete. Preserve the
   bounded manifest and credential-handling limits.
2. The bounded diagnostic is complete. Plan CVR Public/Group Public room
   classification and count aggregation under the owner's clarified rule;
   resolve bounded loading/ranking and parser field precedence using the observed
   VRChat room-detail evidence. The route-existence check is complete.
   Any additional live probe needs a new scoped allowance. Return to Josh if
   either platform cannot support the approved flow.
3. Define shared token-free discovery values, adapter producers, account-scoped
   cache, lazy room detail, deduplication and independent failures.
4. Implement and verify platform ranking, symmetry, neutral ties, exact 2/4/6
   limits and both directions of backfill.
5. Build Explore and its world sheet using the approved controls and persisted
   settings. Establish safe room actions through the proposed main boundary.
6. Wire Dashboard to the same ranked cache, with no extra discovery fetcher.
   Preserve Hot Instances threshold, grouping, six-card cap and actions.
7. Verify failure states, account changes, stale data, the 60-second discovery
   cooldown, accessibility and real Electron dark/light/grayscale/narrow views.
   Screen capture requires the owner's one-time approval for the specified target.
8. Update design artifacts, API catalog, verified API volatility and changelog;
   update policy only if behavior warrants it. Run the project gates and current
   personal review workflow. No merge without a scoped grant.

The subsequent implementation plan now supplies the parser rules, bounded
loading, owned files, interfaces and acceptance checks. This earlier sequence
is retained as history. No application implementation or verification is implied.

## Documentation and verification record

This planning document is added and `docs/api-volatility.md` records the observed
discovery fields and remaining uncertainty. Approved source artifacts remain in
their original locations. Application code, root/child contracts, design guides,
INTERNAL-API, API policy, README and changelog are intentionally
unchanged because no repository application code changed. The newer CVR design
clarification is retained as an approved addendum here; the original source
design snapshot and its visual artifacts await the later design-sync pass.
The disposable diagnostic changes runtime only during the approved
probe; it is not a release or Explore implementation. The current
owner review policy governs later delivery even where this older checkout's
project contract still describes the former universal bot requirements.

Validate this document with the installed formatter and a whitespace/diff check.
The initial 18 disposable offline tests passed, including a failing-then-passing
installed-adapter route regression. The corrected live sample and restoration
checks passed, with the limits above. The VRChat follow-up passed all 21 offline
tests and its four-request live evidence/restoration checks. No full application verification or
Explore implementation is claimed. At the end of the diagnostic phase, changes
were saved locally, not committed or pushed. The later implementation-plan
handoff records the continuation; this section describes diagnostic verification.
