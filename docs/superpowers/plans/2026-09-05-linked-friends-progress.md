# Linked friends execution ledger

Plan: `2026-09-05-linked-friends.md`, approved documents copied from local source
commit `146444a9585a775b1cbee44aba2f74c415e8bf63` without Explore files or private art.

## Authority and baseline

Josh authorized the full linking Tasks 1–7 overnight block on September 5, 2026,
including implementation, judgment on remaining choices, and merge authority.
The grant covers the plan's account/session isolation, IPC, atomic persistence,
migration, and explicit shared-note deletion safeguards. Required checks and
substantive automated reviews still gate merge. No release or Explore work.
No real-account tests, reset-credit redemption, or screen capture was authorized.

Implementation checkout: `/Users/imperix/.codex/worktrees/3fb0/vrx`, branch
`imperix/vrx-143-linked-friends-ui`, base `60ce0a05f21e7b2d6f6d58e45653b6103f59f546`.
Fresh origin/main matches base. GitHub returned no open PRs. VRX-143 is already
In Progress. Source checkout advanced to b3dd7a5 through contract-only changes;
the three approved linking documents are byte-identical to 146444a. Preserve
source `.codex/`, `.superpowers/`, Safari, and the older linking worktree.
Initial standard Codex weekly usage: 0% used; no standard five-hour window.

## Execution choices

- Adopt the proposed five-second maximum placement hold, immediate unsafe-action
  disabling, stable-identity focus restoration and search fallback. Josh delegated
  this remaining interaction choice. The risk is a distracting focus move at the
  deadline, covered by runtime and transition tests.
- Keep persistence, shared types, FriendsList, FriendDrawer and integration with
  the driver as the plan directs. Independent read-only checks and disjoint work
  may use Codex subagents. All such review is same-lineage.
- Preserve the existing account note editor interface and behavior when adapting
  the plan's illustrative hook signature. The actual hook uses setValue and
  isWritable, not the plan's onChange shorthand.
- Task 3 can finish its pure projection before exposing new rows; production row
  integration must remain coherent with Task 4 navigation and Task 6 rendering.

## Plan dependency check

| Tasks   | Shared contract                                  | Resolution                                                      |
| ------- | ------------------------------------------------ | --------------------------------------------------------------- |
| 1, 2    | Validated profiles, revision and mutation result | Main qualifies identities; store commits once.                  |
| 1, 4, 5 | Person revision includes shared-note edits       | Destructive confirmation fails after any reviewed note changes. |
| 2, 3    | Scoped snapshot and authenticated account IDs    | Missing identity never hydrates another user's member.          |
| 3, 4, 5 | Stable person/account selection                  | Selection survives presence, not identity boundaries.           |
| 3, 6, 7 | Projected rows and current raw safety data       | Delay placement only, never Join validation.                    |
| 4, 5, 6 | Drawer and dialog ownership                      | Integrate serially and preserve existing modal coexistence.     |
| 1       | v1 migration and failed commit                   | Backup original bytes; no write-in-place fallback.              |
| 2       | Lease and IPC budgets                            | Local limits add no platform requests.                          |
| 3       | Mixed rows and people totals                     | Two entries still count as one person.                          |
| 4       | Shared hook illustrative signature               | Match actual editor contract, preserve drafts.                  |
| 5       | Replacement acknowledgement                      | Enumerate exact old/new pairs and all deleted shared notes.     |
| 6       | Chooser snapshot                                 | Never replace reviewed destination with a fresh target.         |
| 7       | Interaction deferral                             | Adopt delegated timing policy above.                            |

## Progress

- Preparation: dependencies installed; baseline green, 142 files / 2,232 tests.
- Task 1: implemented and focused verification green, 80 tests across three suites.
  Verified exact-byte v1 migration, restart, corrupt/future preservation, failed and
  ambiguous rename, all-or-nothing replacement and original hostile-input cases.
  Removing the revision check made the stale-unlink test fail; restored and reran green.
- Task 2: implemented, 33 focused IPC/preload/query tests green and typecheck green. A post-commit read
  failure regression is covered; IPC now returns the transaction's committed snapshot.
- Task 3: pure projection integrated, 27 cases green; five navigation-resolution
  cases green. Combined, mixed and filtered roster integration is present. Full
  visuals and interaction retention remain Tasks 6–7. The legacy selected friend
  ID was removed; the profile target is now the only navigation owner.
- Task 4: shared-note hook integrated after inspecting the worker files and
  rerunning focused tests. Person selection, account shortcuts and Back are wired.
  Drawer tests prove the same textarea/draft/caret survives presence changes and
  navigation flushes the old owner even without a browser blur. The latter test
  failed with zero writes before the layout-cleanup fix; 59 drawer tests then
  passed, followed by full typecheck. Identities entry remains with Task 5.
- Task 5: identity management and native dialog wrapper integrated. Captured
  confirmation content was inspected and corrected before import: no false
  deletion warning for new links, account-qualified old labels and leftover
  accounts, no raw-ID name fallback, and a Back path for stale unlink. Focused
  tests cover duplicate names, offline candidates, preference/custom-name
  separation, healthy-side unlink and session-lease invalidation.
  Checkpoint gate: typecheck, lint, format check, production bundle and all
  2,351 tests in 155 files passed. Native dialog behavior still requires the
  disposable Electron probe; jsdom tests emulate showModal/close only.
- Tasks 6–7: production rendering, chooser and placement protection integrated.
  Corrected the rejected world artifact, then verified diagonal geometry, hidden
  placeholders, image recovery, merged-avatar picture-only semantics and both
  chooser entry points. One five-second hold retains placement but not unsafe
  payloads. Unlink/replacement and deliberate filters release it immediately.
  Boundary gestures use an invalidated marker, not null, because null permits
  keyboard clicks. Dialog close restores stable identity or Search.
  The lifecycle audit reproduced unlink duplication and lost/stale focus; focused
  tests failed before the corrections and 82 integration tests then passed.
- Latest full gate: 2,392 tests / 158 files, typecheck, uncached ESLint, format
  check and production build passed with `LINKED_FRIENDS_GATE_GREEN`.
  This includes the final unused-export and duplicate-predicate cleanup.
- Native Electron fixture at `/private/tmp/vrx-linked-runtime.XmIfTV` passed
  `LINKED_RUNTIME_GREEN` with blocked network and disposable userData. Measured
  520×60 compact rows in both themes, 14px world corners, 372px fixed drawer,
  equal shrinking world groups, 14px badges and 12px image radius. Verified
  single VRC/CVR, both, offline and hidden variants, grayscale identity labels,
  platform filtering, shared editor/caret continuity, twenty native Tab steps,
  background focus inertness, Escape isolation, chooser-to-Join confirmation,
  and identity-boundary close to Search. This is fixture/native DOM evidence,
  not real authentication/API or screenshot evidence. Probe processes exited.
- Static checks ran. Fallow found one new unnecessary export, removed without
  changing runtime; scoped dead code now flags only pre-existing IpcEventChannel.
  Four production clone groups remain: existing descriptor-first store parsing,
  selection-drag guards, drawer/sheet listeners, and new confirmation buttons.
  The latter intentionally retain separate explicit acknowledgement conditions.
  Duplicate picker filtering and account-row projection were consolidated.
  Final SHA-pinned review and external reviews,
  publication, final-head CI and merge remain pending.
- Task 1 local commit: `c3dce48`; Task 2: `f0096ad`; roster/navigation checkpoint:
  `843b0f4`; identity-management checkpoint: `0aa4cc8`.
  PR, pushes, merge: none. Required reviews remain pending.

Next: finish documentation sync and final review/delivery. A bounded
read-only audit found same-lease read/write publication rollback and an HMR
boundary listener ordering race. Both were reproduced/addressed: snapshots now
carry atomic document revisions and one app listener owns query reset/reload.
The combined store/IPC/query/shared-note/drawer gate passed 114 tests.
The checkpoint also passed typecheck, lint, format check, production bundle and
all 2,328 tests in 152 files. Nine initial SSR roster failures exposed a stale
test fixture that returned the same mixed array from both platform queries;
the fixture now mirrors platform-scoped caches without weakening its assertions.
DOX pass: API/renderer ownership, all three design references, changelog and README
are synchronized. API volatility/policy docs intentionally remain unchanged:
no adapter assumption, network behavior or platform request cadence changed.
No new documentation tree or private sample artwork was added.

Final implementation checkpoint: native Electron fixture rerun passed after the
last functional cleanup. Standard Codex weekly usage is 6% used; no standard
five-hour window was returned. No reset credit was redeemed. All implementation
workers have completed; fresh nonbuilder review lenses are next.

## Local review round 1 and corrections

Review head `6650f105c2af13038e6db316089f2d92a00d483e`, base `60ce0a0`.
Artifact SHA-256 `3eecd74aa7d601a1f342428ada3f95add94e7f60983f40474746434ddb29f0bc`,
660,486 bytes / 12,011 lines / 72 files. Three fresh nonbuilder Codex lenses ran:
security/authority, correctness/lifecycle, tests/contracts. Same-lineage review.
Security reported no material finding; the other lenses found seven actionable
defects. Verdict was FIX-FIRST, not publication-ready.

Confirmed and corrected in one functional round:

- Friends TopBar counted linked accounts twice. It now uses unique people;
  Dashboard stays account-shaped. Regression failed 2 versus 1 before correction.
- Identities captured an empty initial lease and closed on first query success.
  It now waits for the first lease and still closes at later boundaries.
- Saved shared notes were collapsed in destructive review. They start expanded.
- A successful preference change left a stale automatic-name input. Automatic
  values now follow the preferred account without overwriting typed name drafts.
- Failed or in-flight shared-note drafts could escape deletion disclosure.
  Every affected person now has a reactive and synchronous submission guard,
  with return-to-profile recovery. Failed drafts retained after navigation and
  pending/synchronous-edit races are covered. No automatic retry/discard was added.
- Preferred-name fallback did not persist renames. Main now reads fresh scoped
  LocationAuthority names and batches updates in one guarded transaction, leaving
  custom names, notes and membership unchanged. Name-only cache invalidation adds
  no platform traffic. Removing the member-match guard made the test fail; restored.
- A chooser destination could revive after moving away and returning. Observed
  drift now stays invalid until reopen.

Correction gate: 2,407 tests / 159 files, typecheck, uncached ESLint, formatting
and production build passed `LINKED_FRIENDS_GATE_GREEN`. Fallow's scoped findings
remain the same pre-existing unused type and four classified clone groups.
Updated native Electron fixture passed `LINKED_RUNTIME_GREEN`, including expanded
note disclosure, failed-draft unlink blocking and return to the exact draft owner.
No screenshots or real-account actions. DOX/API/design references are synchronized.
Weekly Codex usage: 7% used. No reset credit redeemed. No push or PR yet.
Next: pin corrected head and repeat full T2 review, then publication and external gates.
