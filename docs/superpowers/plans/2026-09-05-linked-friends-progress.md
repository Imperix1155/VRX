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
- Task 3: pure projection and tests delegated to a separate scratch worktree.
- Tasks 4–7: unstarted.
- Task 1 local commit: `c3dce48`. PR, pushes, merge: none.

Next: finish Task 2 bridge, limits and query checks; integrate pure projection,
then continue navigation, notes, identity dialogs and approved visual work.
