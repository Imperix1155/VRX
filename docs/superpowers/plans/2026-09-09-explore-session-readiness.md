# Explore session receipt and phase-A readiness

Latest status: the API dependency is integrated and combined checks pass. Josh
authorized merging the isolated foundation, with current evidence in the
[merge-readiness receipt](2026-09-09-explore-phase-a-review.md#foundation-merge-readiness).
This supersedes the earlier integration/merge holds below. Production Explore
remains inactive and its implementation work remains open.

Prepared September 9, 2026. Phase A is now implemented and verified with
synthetic data; VRX-270 is In Review with draft PR 305 open. The
[autonomous block ledger](2026-09-09-explore-autonomous-block.md) records that
work. The [integration continuation](2026-09-09-explore-integration-continuation.md)
records the merged API dependency and Josh's later delegation of refresh,
caching and discovery-volume choices. No new numeric-allowance approval is
pending. Dependency integration and production implementation remain undone;
this clarification does not start another autonomous block. No live API,
app-restart, capture, game-launch, merge, release or installable-build grant exists.

The receipt sections below preserve the earlier preparation checkpoint. Their
uncommitted files, missing dependencies and preparation-only status describe
that checkpoint, not the later authorized block. The six hashes below identify
the original imported bodies. The implementation plan now has an explicit
continuation notice; removing that notice restores its original bytes.

## Baseline and saved files

- Destination: `/Users/imperix/.codex/worktrees/9e9f/vrx`.
- Prepared branch: `imperix/vrx-270-explore-phase-a`.
- HEAD: `9dbac8b569efb27e03ef06882d96b89d8a45c969`, matching remote
  [main at receipt](https://github.com/Imperix1155/VRX/commit/9dbac8b569efb27e03ef06882d96b89d8a45c969).
- Initial detached HEAD was `c5d42dca10b19500849bc534043bfaf812067583`.
  The one missing commit changed four review/CI policy files. The application
  source, package files and Electron config did not differ. This task created
  the branch at the expected main commit before copying documents.
- Source checkout: `/Users/imperix/.codex/worktrees/8ca7/vrx`, planning HEAD
  `f910da981567d6d324af4fa67c0fa3a9e7c279ec`. Its working files contain
  subsequent local planning changes, so that commit alone is not this handoff.
- The six requested files were absent in the clean destination. They were
  copied with apply_patch at identical relative paths, preserving their bodies.
  Exact byte comparison passed for all six. The source checkout was read only.
- These handoff files are saved locally, uncommitted and unpushed. No PR or
  tracker update was made.

| Copied document                                                                                     | Bytes | SHA-256                                                            |
| --------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| [2026-09-08-explore-implementation-plan.md](2026-09-08-explore-implementation-plan.md)              | 34345 | `b21bdbb64ce8ca41903a921fcab22486472decf4bafd75d3dcdaf06498c95f3d` |
| [2026-09-08-explore-feasibility-preparation.md](2026-09-08-explore-feasibility-preparation.md)      | 44558 | `dcf79fc452bb8df69ed009413da9bf322a107a31fd29329bc558c37bfc4b135a` |
| [2026-09-09-api-traffic-hardening-plan.md](2026-09-09-api-traffic-hardening-plan.md)                | 22761 | `8a723c2777dca9b92de4b9108b6abcc906d28ff904bad74d1d8106cfd892fb6e` |
| [2026-09-08-api-etiquette-audit.md](2026-09-08-api-etiquette-audit.md)                              | 17610 | `6f423e63197e241a1b71c3212fa53e4c5dc1588b1e1e9e34956d5f3d5606af0e` |
| [2026-09-04-cross-platform-explore-design.md](../specs/2026-09-04-cross-platform-explore-design.md) | 13950 | `5b3c3e4fce5e081a37ed25de13c1cb883c3428cebb01b0f8138061570e27174b` |
| [2026-09-05-explore-planning-handoff.md](../specs/2026-09-05-explore-planning-handoff.md)           |  8967 | `8f0ad015a9b857d7db31a6de7417a682bf8e233c6c9a213dc34eb4c2b52d317c` |

The source API registry was read. Its Explore evidence section is preserved in
[the separate API evidence handoff](2026-09-09-explore-api-evidence-handoff.md),
with source/destination registry hashes and an exact excerpt. The current
[API registry](../../api-volatility.md) was not overwritten. Historical links
from the copied documents to its Explore heading refer to the source registry;
use the separate evidence handoff for that historical heading. The later
[phase-A parsing section](../../api-volatility.md#explore-phase-a-parsing-september-9-2026-not-wired)
records implemented assumptions without replacing this original evidence.

## State checked at receipt

GitHub returned no open PRs, no in-progress Actions runs and no queued runs.
The latest main [CI run](https://github.com/Imperix1155/VRX/actions/runs/34168090984)
and [CodeQL run](https://github.com/Imperix1155/VRX/actions/runs/34168091015)
both completed successfully. These are baseline results, not verification of
an Explore or API-safety implementation.

Existing worktrees were inventoried and left intact. A process-name-only check
found Node/tool processes and no named VRX executable. Names alone do not prove
all development work is idle or establish ownership of each Node process.
No server or app was started, stopped, captured or restarted.

The owner-designated dependency is the separate task titled
**API safety fixes and verification**. The app's task listing at receipt did
not yet expose that task, and no completed dependency commit/PR or evidence
package was supplied. Phase B therefore remains closed.

The root contract was read on the prepared baseline. The current plan-work,
design-iterate, driver-playbook, parallel-agents, review-loop, verify-electron,
verification-before-completion and writing guidance were consulted.
There is no nearer AGENTS.md under either handoff destination directory.
Before source edits, read the complete applicable shared, renderer, main and
platform contracts, the internal API catalog, and all three design guides.
This checkout has no installed node_modules; dependency setup and focused
baseline tests belong to execution preflight. No application gate ran here.

## Sequencing and precedence

The implementation plan's
[September 9 split](2026-09-08-explore-implementation-plan.md#september-9-parallel-work-split-and-dependency-gate)
is the sequencing authority. API safety precedes Explore live integration.
API safety never waits for Explore.

The copied documents deliberately retain their historical bodies. Apply these
already-approved continuations when older lines conflict:

- The September 9 split permits sample-only phase A alongside API fixes once
  execution starts. The older final sentence saying not to start unit 1 does
  not prohibit that independent phase-A work.
- Transport fixes and dispatch/lease interfaces belong to the API-safety task.
  Older unit-1 text proposing a new BaseAdapter discovery hook is superseded
  by the producer's verified scheduler and lease contracts.
- The later CVR Public/Group Public rule supersedes the original full-room and
  positive-admission exclusions. Group-only, friends, private and unknown rooms
  remain excluded. Full qualifying CVR rooms remain visible and can offer a
  guarded user-initiated Join without a capacity/admission probe.
- CVR occupancy sums qualifying deduplicated rooms only; incomplete totals
  remain unknown. VRChat aggregate counts and stricter Join conditions remain.
- Dashboard uses up to two truthful cards. Insufficient data never creates
  placeholders. Linking and route-feasibility prerequisites are complete;
  old diagnostic grants do not authorize another probe.

The mixed world-first Explore grid, All/VRC/CVR selector, 2/4/6 control with
default 4, deterministic neutral alternating ranking/backfill and contained
nonmodal sheet remain settled. Dashboard order stays stats, shared-cache Explore
preview, then Hot Instances. Preserve its 1–10 threshold, persisted choice,
exact-instance grouping, six-card cap, linked profiles and existing joins.

## Phase A prepared scope

Once Josh starts the work, phase A can proceed independently with:

- Pure DTOs, ranking and standalone parsers with synthetic fixtures and tests.
  New parsers cannot import or initialize a real adapter or perform fetches.
- Presentational grid, cards and contained sheet, plus sample Dashboard
  composition. Inject fake data and action sources; use synthetic images.
- Tests for filters, 2/4/6 caps/default, neutral ties and symmetric backfill;
  Public/Group Public qualification, unknown/partial counts and full CVR rooms;
  loading/error/staleness, dismissal, keyboard/focus and Hot Instances placement.
  Join intent is a spy callback.
- Planning of later settings/query contracts without production integration.

Do not wire the sidebar route, production Dashboard hook, main startup,
settings persistence, IPC, queries, authenticated images or OS launch.
Do not attach real account storage. Synthetic fixtures must remain test/preview
inputs and must not ship as a production data fallback. Shared-cache behavior
can be exercised with fake data; that does not verify the future live cache.

The API task owns BaseAdapter, API clients, pacing/cooldown, cancellation and
session leases, socket backoff, roster retry and deduplication. Explore cannot
build a competing transport fix. If phase A finishes first, checkpoint and stop.

## Historical phase-B dependency gate

The current [continuation](2026-09-09-explore-integration-continuation.md)
supersedes this checkpoint's missing upstream evidence and repeated numeric
approval requirement. Integrating the dependency and verifying the combined
source are still required. The list below records what was pending at receipt.

Before live integration, inspect actual artifacts for all of the following:

1. A stable reachable API-safety commit/PR and exact scheduler injection,
   request-option, lease/cancellation and sanitized error contracts.
2. Focused physical-attempt, cross-path cooldown, stale-session, roster/dedupe
   and socket verification at that commit, plus the applicable local gates,
   final-head CI and required critical-risk review dispositions.
3. Resolution or evidence-backed refutation of material findings and explicit
   persistence/review/merge state. A completion message is not evidence.
4. Integration of that exact dependency by authorized git steps and relevant
   checks on the combined state. A changed dependency head needs a delta check.
5. Recalculation of Explore traffic within the verified shared controller and
   Josh's approval of that revised allowance. The old 16-request proposal
   remains withdrawn.

Only then wire the real discovery service/adapters, IPC, queries/settings,
authenticated images and guarded joining. No direct fetch, separate queue,
live-account probe or relaxed check can bypass this dependency. Neither
dependency completion nor a green PR grants merge, release or live testing.

## Verification and next action

Receipt checks establish six byte-identical documents, the separate preserved
API excerpt, an unchanged destination API registry and no application-source
edits. SHA-256 values above identify the accepted source snapshot.

DOX pass: no directory boundary, production contract, API behavior, UI or
feature status changed. Root/child contracts, API policy/catalog/registry,
all three design artifacts, README and CHANGELOG remain intentionally unchanged.
Implementation must update its owning documents when behavior changes.

This is handoff validation, not a code review, rendered preview or completed
phase A. No independent external review ran. Later review follows review-loop;
UI evidence follows verify-electron and requires one-time owner capture consent.

Next safe action after Josh starts phase A: refresh git/process/dependency
state, read the applicable source contracts, establish focused test baselines,
then implement the pure DTO/ranking/parser unit. No new product-design approval
is needed. Stop at the phase-B gate when the independent work is complete.
