# Explore planning handoff

Historical checkpoint. Continued by the
[September 8 implementation plan](../plans/2026-09-08-explore-implementation-plan.md).
Its source baseline, feasibility results, CVR clarification and remaining
authority requirements supersede this checkpoint's deferred-work list.

Status: planning started September 5, 2026. This is a planning checkpoint, not an
execution-ready implementation plan. No live authenticated probe or application
implementation has been performed for this checkpoint.

The owner narrowed this pass to organizing the decisions already approved.
Detailed API research, live feasibility testing and the full implementation plan
are deferred. This document is the preliminary work sequence for that later pass.

## Name and approved scope

The feature is **Explore**. It replaces the placeholder Instances destination.
"Discover" describes its purpose but is not a second page or the approved label.
The owning design is
[Cross-platform Explore](2026-09-04-cross-platform-explore-design.md).

The separate implementation plan must include:

- One mixed Popular now grid, world-first cards, equal platform treatment,
  deterministic platform-neutral interleaving and symmetric backfill.
- Existing All / VRC / CVR selector. Worlds shown has only 2, 4 and 6, defaults
  to 4 and persists.
- A contained non-modal world sheet for visible, permitted rooms and guarded
  Join actions. No global-completeness claim or occupant enumeration.
- Dashboard order: existing stats, two Explore cards, unchanged Hot Instances.
  Preserve its threshold selector, six-card cap, grouping and actions.
- Shared discovery cache and ranking for Explore and Dashboard. No duplicate
  fetchers, presence polling or per-world startup fan-out.

## Execution boundary

The upcoming overnight block is linking only. The owner intends to use GPT-6
Astra for that first bounded run. Explore planning may proceed now, but Explore
implementation must not be added to the overnight block without new approval.
If linking finishes early, checkpoint and stop rather than automatically taking
on Explore. There is no active unattended execution grant yet.

## Source checks already completed

- `src/renderer/src/components/AppShell.tsx` routes `instances` to ComingSoonStub.
- `src/renderer/src/components/Sidebar.tsx` owns the existing navigation item.
- `src/renderer/src/components/DashboardView.tsx` owns the real Hot Instances
  section; `HotInstanceSheet.tsx` and `NumberStepper.tsx` provide reusable UI.
- `src/main/services/adapters/IPlatformAdapter.ts` exposes friend retrieval,
  instance details and join URL construction, but no world discovery method.
- Existing join IPC is friend-targeted with a main-owned expected-target check.
  Explore cannot invent a friend ID for a public room. Its plan needs a separate
  main-owned discovery target authority that reuses the guarded launch boundary.

These findings identify implementation boundaries. They do not establish which
public discovery endpoints or fields work against the current signed-in sessions.

## Preliminary work sequence

These are proposed implementation units, not instructions to begin coding.
The approved design remains the source of product behavior.

| Order | Work unit                                               | Result to prove before moving on                                                                                                                                                             |
| ----- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Establish discovery feasibility for both platforms      | Truthful world candidates and visible room drill-in, with source evidence and an owner-approved live probe. No invented fields or friend-location substitute.                                |
| 2     | Define shared discovery data and main-process retrieval | Token-free world and room values, isolated by account session. Bounded queued requests, lazy room details, deduplication, cached results and independent platform failures.                  |
| 3     | Implement ranking and display selection                 | Platform-native ranking, a neutral deterministic helix, symmetric backfill and the same 2/4/6 total for either platform. Test both uneven directions.                                        |
| 4     | Build the Explore page and world sheet                  | Rename Instances to Explore. Reuse the existing filter, card language and contained sheet. Persist Worlds shown with default 4. Show only metadata the source supports.                      |
| 5     | Connect safe room joining                               | Main-process validation for discovery destinations, without a fabricated friend ID. Preserve existing confirmation and launch protections. Reject stale, hidden, full or ineligible targets. |
| 6     | Add the Dashboard preview                               | Stats first, up to two Popular now cards, then unchanged Hot Instances. Reuse Explore's ranking and cache with no separate discovery requests.                                               |
| 7     | Verify and prepare delivery                             | Exercise loading, empty, stale, disconnected and changing-room states; test platform symmetry and request safety; verify real Electron rendering and complete repository review gates.       |

The visible result remains one mixed grid. In All, a total of four normally
means two worlds per platform. If one platform has fewer candidates, the other
can fill the remaining slots. The Dashboard takes the first two results from
the same ordering, with fewer cards when there is insufficient data.

Hot Instances is outside the redesign. Its threshold selector, six-card limit,
friend grouping, ordering, Join behavior and detail sheet stay intact.

## Deferred detailed planning

1. Re-read the saved API research and relevant CVRX/VRCX public source references.
   Record source revisions and distinguish current verified behavior from earlier
   assumptions. No reading credentials or real account data is needed for this step.
2. Map the existing request queue, account-session boundary, location authority,
   settings migrations, cache and launch code. Specify the smallest discovery
   service and renderer-safe contract that can support both platforms.
3. Draft a bounded, keys-only live feasibility probe with explicit request budget,
   pacing, output redaction and failure stops. Obtain approval before running it
   against a real session. The saved design requires this evidence before shipping.
4. Confirm that each platform can return truthful world candidates and visible
   room drill-in. If VRChat cannot, return to the owner rather than silently using
   friend locations or shipping a one-platform page.
5. Write the implementation plan in independently verifiable units: discovery
   contracts/parsers, main cache and request orchestration, safe room actions,
   deterministic ranking, Explore UI, Dashboard preview, tests and documentation.
   Include exact files, signatures and test fixtures after evidence establishes
   the response shapes. Do not fabricate parser fields to make a plan look finished.

## Tests the plan must carry

- Symmetry under swapping platform inputs; equal limits; 2/4/6 and default 4;
  deterministic ties; both uneven directions; empty and failed sources.
- Same ranked cache reused by Dashboard; exactly two available preview cards at
  most; fewer cards when insufficient truthful data exists; no extra requests.
- Lazy room details, concurrent deduplication, session isolation, stale data,
  60-second minimum discovery cooldown, queue pacing and unknown fields.
- No enabled Join for hidden, full, unavailable or ineligible rooms; no stale
  target launch after a room changes or a session switches.
- Real Electron dark/light/grayscale/narrow layouts, accessible controls and
  unchanged Hot Instances threshold/grouping/actions.

The current approved UI does not need another generic redesign. Planning should
prove the data and action paths can deliver that UI safely.

## Handoff and documentation boundary

Resume with discovery feasibility, then turn the work units above into a full
implementation plan with verified interfaces, exact files and executable tests.
If either platform cannot support the approved discovery flow, ask the owner
before changing the product scope.

This checkpoint changes no runtime contracts or approved visual behavior.
The root contract, design guides, API catalog, API policy, volatility record,
README and changelog are intentionally unchanged. Their implementation updates
remain required by the owning design. No application code or mock is changed by
this preliminary planning pass.
