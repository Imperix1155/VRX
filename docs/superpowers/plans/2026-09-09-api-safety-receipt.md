# API-safety handoff receipt

Prepared September 9, 2026. Historical receipt before implementation started.
Current execution state is in the [progress ledger](2026-09-09-api-safety-progress.md).
This receipt does not open Explore's live-integration gate.

## Documents and provenance

At receipt, copied with `apply_patch` and verified byte for byte against
`/Users/imperix/.codex/worktrees/8ca7/vrx/docs/superpowers/plans`:

- [Traffic-hardening plan](2026-09-09-api-traffic-hardening-plan.md), 22,761 bytes.
  SHA-256 `8a723c2777dca9b92de4b9108b6abcc906d28ff904bad74d1d8106cfd892fb6e`.
- [API etiquette audit](2026-09-08-api-etiquette-audit.md), 17,610 bytes.
  SHA-256 `6f423e63197e241a1b71c3212fa53e4c5dc1588b1e1e9e34956d5f3d5606af0e`.

Read the [original Explore plan](/Users/imperix/.codex/worktrees/8ca7/vrx/docs/superpowers/plans/2026-09-08-explore-implementation-plan.md),
including its September 9 split and dependency gate. That file remains in its
owning checkout, unchanged by this task. The copied hardening plan's relative
Explore link therefore refers to a document not copied here; use the absolute
source link above until the Explore documents are reachable through shared Git.

The hashes record the original receipt snapshots. Later repository formatting
may change whitespace in the local copies without changing the approved scope.

The incoming brief says Explore stays in the original task. During receipt,
the source plans changed to describe a second new Explore task. This routing
difference does not change API ownership or the one-way dependency. This task
does not choose Explore's destination or wait for it.

## Verified baseline

- Destination `/Users/imperix/.codex/worktrees/b095/vrx` was clean and detached
  at `c5d42dca10b19500849bc534043bfaf812067583`. It is now detached at verified
  remote main `9dbac8b569efb27e03ef06882d96b89d8a45c969`.
- The intervening commit changes four workflow/review-policy files only.
  Application source and A1 test files match across those revisions.
- Source planning head `f910da981567d6d324af4fa67c0fa3a9e7c279ec` adds documents
  only. Its uncommitted changes are planning documents; application source
  still matches `9dbac8b`. No original-task files were edited here.
- GitHub returned no open PRs and no in-progress, queued or waiting workflow
  runs. Main's CI and CodeQL runs completed successfully. Those results are
  baseline evidence, not verification of the proposed implementation.
- Existing worktrees were inventoried and preserved. Process names showed
  Node/tool processes, with no clearly identified VRX build/test job. Names
  alone do not establish that every other task is idle.
- The current root contract was read. No nearer `AGENTS.md` exists under
  `docs`. No application, contract, runtime API catalog, policy, design,
  README or changelog change was needed for this receipt's DOX pass.

## Execution boundary and next unit

The approved scope and exclusions in the copied plan remain authoritative.
Keep saved encrypted sessions without passwords, separate platform controllers,
the shared conservative pacing policy, cooldowns, cancellation, roster dedupe,
and socket backoff. Preserve existing user controls and workflows. Use synthetic
transport/clock fixtures. No live accounts, account actions, credential
inspection, installed-app restart, release, merge or unattended run is granted.

The separate API issue identifier remains unresolved. Linear was inspected
read-only; no issue was selected, created or transitioned. Resolve the actual
identifier before creating the required issue branch. Do not use VRX-270.
Dependencies are absent in this checkout; provision them before test execution.

Next implementation unit is A1. First establish the focused baseline:

```sh
npm test -- src/main/services/adapters/BaseAdapter.test.ts src/main/services/avatarCache.test.ts
```

Then add deterministic mixed REST/image and cross-path 429 regressions, followed
by extracting and injecting the shared admission controller. Static inspection
confirmed the separate queues, missing image Retry-After handling and absence
of shared controller injection. No reproduction, test suite or build ran in
this receipt turn. The read-only Codex helper supplied same-lineage evidence;
the driver checked the source and revision comparison directly.

API safety proceeds independently. Explore live wiring stays blocked until a
reachable immutable commit/PR provides exact scheduler/request/lease/error
interfaces, decisive tests and practical mutation checks, local gates,
required T2 external-review dispositions, final-head CI, and explicit merged
or unmerged state. Explore must inspect and integrate that dependency and
obtain approval for its revised traffic allowance. Missing required evidence
keeps the gate closed. No merge authority exists.

Persistence at receipt is local files only, with no commit, push or PR.
