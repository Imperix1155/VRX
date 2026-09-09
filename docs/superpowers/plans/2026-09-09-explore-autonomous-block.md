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
  identity/Dashboard aggregation tests passed. Saved as local commit
  `19e9e8c11af608dfdd17c5af8c839e4e623457f9`; not yet pushed at this checkpoint.
- Worker integration: parser and UI artifacts inspected in isolated worktrees.
  Corrections requested for VRC world-total provenance, response access evidence,
  CVR aggregate coverage, sheet opener switching and stale actions. These are
  implementation fixes within the approved behavior, not new product scope.
- Integrated 15 worker-owned files after byte-for-byte verification. Driver
  strengthened orphan/conflicting access checks, own-property eligibility,
  optional tuple-count tolerance and same-world/provenance-safe CVR aggregation.
  Sixty Explore/parser/ranking/locale tests now pass. Separately, 116 existing
  Dashboard/Hot Instance/join tests pass. Full gate and fresh review follow.
- Phase-B settings plan remains unimplemented: add the approved 2/4/6 preference
  and persist the existing global filter through the settings path. Reconcile
  the current schema version after the API dependency lands; preserve downgrade
  refusal, first-paint hydration and friends-only persistence allowlists. No
  Explore data persistence or new independent platform filter is planned.
- DOX updated the owning shared/platform/renderer contracts, callable catalog,
  three design references, README status and a scoped API-assumption section.
  Root/main indexes remain valid. CHANGELOG and API policy are intentionally
  unchanged: no production behavior, endpoint, transport or etiquette changed.
- Full local gate passed: uncached ESLint, repository Prettier check, all 2,497
  tests in 163 files, node/web typechecks, electron-vite production build and
  entry/font assertion, plus diff whitespace. Sentinel:
  `EXPLORE_FULL_GATE_GREEN`. No application was launched.
- Mutation testing found that the stale-action fixture also had a wrong-world
  row, masking the stale guard. The fixture now isolates staleness. Five
  independent bypasses (orphan access, cross-world counts, count provenance,
  stale UI action and focus-close transition) each fail one relevant test;
  exact source bytes were restored and all 40 parser/component tests pass.
  Sentinel: `EXPLORE_MUTATIONS_GREEN`. The complete gate passed again with this
  stronger test: 2,497 tests, lint, formatting, both typechecks and build;
  sentinel `EXPLORE_FINAL_GATE_GREEN`.
- Fallow 2.89.0: dead-code scan reports eight existing findings outside Explore,
  zero new unused exports/unresolved imports/cycles/boundary violations. The
  duplication scan reports six new groups: two small platform-parser structural
  similarities retained to keep distinct protocol validation local, and four
  test arrangement/assertion repetitions retained for independent scenarios.
  These are inspected dispositions, not a claim of zero repository findings.
- Import inspection found no existing production module importing Explore
  (`EXPLORE_PRODUCTION_ISOLATION_GREEN`). No real data fallback was added.
- Phase B remains closed pending inspected API-safety artifacts, exact contracts,
  physical-attempt/cooldown/session/dedupe/socket tests, local/CI/critical review
  evidence, integration checks and approval of recalculated Explore traffic.
  The old sixteen-request proposal remains withdrawn.

## Correction checkpoint

The fresh general review confirmed T1 isolation and found five bounded gaps:
unknown VRC access coverage, incomplete empty-sheet copy, Dashboard source state,
the sheet's non-color platform label, and Home/End count bounds. All five are
corrected. The [review ledger](2026-09-09-explore-phase-a-review.md) records the
general anchor and correction scope. The corrected source passes all 2,503 tests,
uncached lint, formatting, both typechecks, build and diff whitespace
(`EXPLORE_CORRECTION_GATE_GREEN`). Each correction has a failing mutation probe;
source was restored, with 29 UI/locale tests passing afterward. Static analysis
findings remain unchanged from the general anchor.

Fresh focused review and draft-PR CI are next. All component/parser workers have
finished; their isolated worktrees and diagnostic artifacts are retained. Weekly
usage was 37% consumed at this checkpoint; no reset credits were redeemed.
