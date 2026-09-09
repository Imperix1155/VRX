# Explore autonomous work block

Started September 9, 2026 after Josh explicitly authorized this task to run
its own autonomous block. This continuation supersedes the receipt's
preparation-only stopping point. The approved product and API-safety split
remain unchanged.

## Authority and limits

- Implement Explore phase A only: pure DTOs/ranking/parsers, synthetic fixtures,
  presentational grid/card/sheet and sample Dashboard composition, with tests.
- The separate API-safety task owns transport, sessions, cooldowns, sockets and
  existing roster fixes. Do not implement or modify those in this block.
- No production route/hook/main wiring, real account store, authenticated image
  bridge, settings/query/IPC integration, game launch or live platform requests.
- No merge, release, installable package, screen capture, app restart, usage
  reset or recurring automation is authorized.
- Feature-branch commits, push, PR and tracker updates remain authorized under
  the owner contract. No commit to main.
- Stop at completion of phase A, a material unresolved decision, the closed
  phase-B dependency, or the conservative usage threshold of 80 percent used.
  Initial usage was 23 percent of the relevant weekly window. Check usage at
  unit boundaries; do not infer hours of work from that percentage.
- Bound this work block to two hours from the kickoff at 5:24 p.m. Central,
  ending sooner at any stop above. No scheduled continuation is implied.

## Baseline

Checkout `/Users/imperix/.codex/worktrees/9e9f/vrx`, branch
`imperix/vrx-270-explore-phase-a`, base
`9dbac8b569efb27e03ef06882d96b89d8a45c969`.
Eight untracked handoff documents belong to this task and are preserved.
Remote main still matches; no open PRs were returned at kickoff. Existing
worktrees and processes were inventoried during receipt and left intact.
The dependency task is separately active. No dependency completion is assumed.

## Bounded units

1. Driver: pure shared DTO and platform-neutral ranking, with deterministic
   count/tie/cap/backfill fixtures and focused regression tests.
2. Parser worker in an isolated worktree: standalone discovery parsers and
   synthetic access/identity/count fixtures only. No adapters or fetches.
3. UI worker in an isolated worktree: presentational Explore components and
   test-only sample Dashboard composition, injected data/images/action spies.
4. Driver: integrate, inspect artifacts, run focused tests and applicable full
   gates, synchronize owning docs, run review-loop and checkpoint the result.

The independent code is provisionally T1. Later transport/IPC integration is
outside this block. Reassess reachable risks during review. Browser or Electron
visual claims require verify-electron evidence and owner capture consent;
without that consent, disclose the visual verification gap and park that gate.

## Progress ledger

- Kickoff: scope and usage checked; source implementation not yet changed.
- Shared unit: pure display DTOs and deterministic native ranking/neutral
  selection implemented. Sixteen focused tests pass, including 243 combinations
  of platform counts and display totals. Mutating neutral list comparison makes
  five tests fail; bypassing count provenance makes two fail. Both restored;
  the sixteen tests pass again. Initial node/web typecheck and 48 existing hot
  identity/Dashboard aggregation tests passed. Files are local and uncommitted.
- Worker integration: parser and UI artifacts inspected in isolated worktrees.
  Corrections requested for VRC world-total provenance, response access evidence,
  CVR aggregate coverage, sheet opener switching and stale actions. These are
  implementation fixes within the approved behavior, not new product scope.
- Phase B remains closed pending inspected API-safety artifacts, exact contracts,
  physical-attempt/cooldown/session/dedupe/socket tests, local/CI/critical review
  evidence, integration checks and approval of recalculated Explore traffic.
  The old sixteen-request proposal remains withdrawn.
