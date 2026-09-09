# Explore API evidence handoff

Saved September 9, 2026 for the separate Explore preparation task.
This is preserved planning evidence, not a new live observation or a runtime
API contract. No diagnostic authority from the original task carries forward.

Source: `/Users/imperix/.codex/worktrees/8ca7/vrx/docs/api-volatility.md`.
Source checkout head: `f910da981567d6d324af4fa67c0fa3a9e7c279ec`;
the source file includes local planning edits.
Full source file SHA-256: `dede7231262a70f62b9c25e1f452ae231511855e4b14e7650f451ed82031788a`.

The section below is copied verbatim from that file, from its Explore discovery
heading up to the next top-level registry heading. Links beginning `./` in
the preserved excerpt resolve relative to the original `docs/api-volatility.md`,
not this file. The reachable local
[feasibility record](2026-09-08-explore-feasibility-preparation.md) and
[implementation plan](2026-09-08-explore-implementation-plan.md) contain the
complete context.

At receipt, the current [API registry](../../api-volatility.md) was unchanged.
The later authorized phase-A block adds a separately labelled parsing section;
it does not replace the registry with this preserved source snapshot.
Its SHA-256 at receipt is `f451e2f09032515d02a85db7a77ec7277f601c913da857b4aa780453a6b6cfbb`.
Use the implementation plan's September 9 parallel-work split for sequencing:
phase A uses fixtures only; phase B requires verified API safety and approval of
a recalculated request allowance. Earlier request proposals in this excerpt
remain withdrawn.

<!-- BEGIN PRESERVED EXPLORE API EVIDENCE -->

## Explore discovery feasibility, September 8, 2026

A bounded, owner-approved diagnostic observed the following responses using
VRX's saved sessions. This is planning evidence, not shipped Explore behavior.
The completed sample used five discovery requests and two saved-session
validations, all HTTP 200, with no retries or joining. The original app was
restored. See the [probe record](./superpowers/plans/2026-09-08-explore-feasibility-preparation.md)
for authority, temporary artifacts, earlier diagnostic failures and limits.
The [implementation plan](./superpowers/plans/2026-09-08-explore-implementation-plan.md)
records count precedence, access parsing, the proposed production request budget
and the approved CVR Public/Group Public rule. These remain planned, not shipped.

| Source                                                                      | Observed fields                                                                                                                     | Remaining uncertainty                                                                                                                                 |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| VRChat `GET /worlds/active?n=2`                                             | Two entries with string identity/name/image fields and numeric `occupants`, `popularity`, `capacity`; neither entry had `instances` | Aggregate world population is not visible-public-room population; a two-entry sample does not establish global ordering                               |
| VRChat `GET /worlds/{worldId}`                                              | `instances` array with 16 entries; first two tuples had three members of types string, number, object                               | No entry matched the probe's deliberately narrow plain-public identifier rule, so no instance-detail request ran; join eligibility remains unverified |
| CVR `GET /2/worlds/list/wrldactive?page=0&sort=Default&direction=Ascending` | `data.entries` with one world, `playerCount: 5`, string identity/name/image fields, and `totalPages: 1`                             | List-level activity exists, but this one-world sample cannot prove public-only count semantics or default sort order                                  |
| CVR `GET /1/worlds/{worldId}`                                               | One `instances` entry with `playerCount: 5`, `maxPlayerCount: 100`, string identity/name/region fields                              | This sample does not establish visibility or access for every returned room                                                                           |
| CVR `GET /1/instances/{instanceId}`                                         | `currentPlayerCount: 5`, `maxPlayer: 100`, string region, and both `privacy` and `instanceSettingPrivacy` equal to `Public`         | Explicit public privacy and spare reported capacity do not guarantee admission; no join was attempted                                                 |

CVR discovery above was observed on `https://api.chilloutvr.net`, while the
installed adapter's normal saved-session validation succeeded at
`https://api.abinteractive.net/1/users/auth`. Do not assume those hosts or API
versions are interchangeable. The two count/capacity field pairs on CVR world
room summaries and room details also differ; normalize them explicitly.

Both initial lists can supply activity counts without requesting every world's
rooms. Missing fields must remain unknown, and unknown access must not enable
joining. CVR's approved public-occupancy meaning still needs stronger evidence
before substituting the category's aggregate `playerCount`. API policy and
production pacing are unchanged.

The CVR source follow-up found no server-side definition for category
`playerCount` or the `Default` sort. CVRX forwards both without interpreting
them. A [native-menu extension](https://github.com/LensError/LensErrors-CVR-Mods/blob/c5b2f7de9ba0fa60296a0c7352506412211db1be/ContentMenuTweaks/FriendInstanceInjector.cs)
keeps injected friend-world entries separate from the game's `UsersInPublic`
field, but does not establish the REST mapping. Local activity ranking can order
a bounded fetched set without claiming global popularity. Josh subsequently
chose Public/Group Public room classification and room-based counts, not the
proposed reported-activity substitution. Fullness and account-specific admission
are not CVR display filters or required preflight probes; the game handles a
user-initiated join attempt. Keep unknown access excluded, main-process action
safeguards intact, and loading bounded. This is an approved design clarification,
not implemented behavior or new live API evidence. See the
[follow-up disposition](./superpowers/plans/2026-09-08-explore-feasibility-preparation.md#cvr-follow-up-september-8-2026).

### VRChat room-detail follow-up, September 8, 2026

The separately authorized VRChat-only follow-up observed
`GET /worlds/{worldId}/{instanceId}` for a Group Public room returned by a
world-detail response. Its four diagnostic requests, one saved-session
validation plus three discovery reads, all returned HTTP 200. No retries,
CVR requests or joins occurred; the original app was restored and its executable
path verified. This closes the earlier skipped room-detail route check.

The response explicitly reported `type: group`, `groupAccessType: public`,
`capacity: 50`, `recommendedCapacity: 50`, `active: true`, `full: false`,
`hasCapacityForYou: true`, `roleRestricted: false`, `ageGate: false`,
`closedAt: null`, `hardClose: null`, `queueEnabled: true`, `queueSize: 0`
and `canRequestInvite: false`. These are observations of one room, not defaults
or proof of admission for other accounts or restriction combinations.

The same response had `n_users: 25` and `userCount: 22`. They are not safe aliases;
do not sum them or explain the difference as player departures without evidence.
The [community reference](https://vrchat.community/reference/get-world-instance)
exposes both without explaining the discrepancy. Preserve field provenance and
define display precedence in implementation planning. The active-world list
still lacked rooms; world detail supplied 11 tuples, with ten identifier-based
Public candidates and one Group Public candidate. Only the Group Public room's
detail was fetched. See the [full follow-up record](./superpowers/plans/2026-09-08-explore-feasibility-preparation.md#vrchat-follow-up-result).

<!-- END PRESERVED EXPLORE API EVIDENCE -->
