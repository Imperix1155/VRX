# API-safety implementation progress

September 9, 2026. Josh authorized starting the approved changes after receipt.
Scope remains [the six-unit hardening plan](2026-09-09-api-traffic-hardening-plan.md).
Production work is underway. Units 1–4 are verified locally. Units 5–6 are pending. No PR, push, or merge has occurred.

## Autonomous authority

Josh requested an autonomous work block after implementation started. Continue
the six approved units through a reviewed open PR or a material blocker, with
one verified checkpoint per unit. The grant adds unattended execution, not
merge, release, live account tests, app restarts, credential inspection, new
product scope or reset-credit redemption. No scheduled continuation is set.
Current usage at block sizing was 22% used in the relevant weekly window;
check again before substantial new waves, checkpoint near 80%, and do not
promise time or feature coverage from that percentage.

## Tracker and branch

Creating a new Linear issue failed at the workspace's free issue limit.
Josh then requested reusing a previous API issue. Reopened VRX-218, the
Security + API etiquette bundle, with a new September follow-up section and
the approved six-unit scope. Its July delivery and merged PR remain preserved
as completed historical work. Related VRX-200 and Explore VRX-270 stay separate.

Branch: `imperix/vrx-218-api-traffic-hardening`. The tracker blocker and prior
exception question are resolved; no branch-rule exception is needed.

## Completed execution preflight

- Checkout and remote main remain at
  `9dbac8b569efb27e03ef06882d96b89d8a45c969`; no tracked-file changes.
- No open GitHub PRs or in-progress workflow runs were returned.
- Explore phase A now has its own worktree. API ownership and the one-way
  integration gate remain unchanged.
- Locked dependencies installed successfully with `npm ci`. The installer
  completed the repository's existing native dependency and Git-hook setup.
- Focused baseline passed: 2 files, 60 tests, exit 0. Command:

```sh
npm test -- src/main/services/adapters/BaseAdapter.test.ts src/main/services/avatarCache.test.ts
```

These existing tests establish the baseline only. They do not prove the
cross-path pacing/cooldown fixes. No production app was launched and no real
platform request or credential-store inspection was performed.

## Next action

Implement unit 5 reconnect backoff and rejected-upgrade cooldown next.
The A1 tests reproduced three baseline failures. With the controller integrated,
all three passed. Mutation verification intentionally replaced image shared
admission with a private controller; all three failed, then source was restored.
The controller's own 14 tests passed, including platform independence, priority,
long timer waits, cooldown extension, fallback, cancellation and overflow.
The final adapter/image run passed 27 files and 623 tests (exit 0). Lint,
format:check and build passed with `A1_PROJECT_GATE_GREEN`; build included both
TypeScript targets and the entry-chunk assertion. Initial gate attempts caught
two test lint defects and a missing test type import; all were corrected.
No substantive external review has run yet; this T2 change is not merge-ready.

One existing fast-429 timing fixture changed its exact expected retry times:
retries now preserve the previous attempt's full paced interval plus jitter,
rather than using a separate retry timeline that could skip the jitter portion.
The one-second minimum remains unchanged. Adapter tests now inject a paired
virtual clock/sleep instead of a sleep callback that resolves without advancing
time; production admission always rechecks the real clock after wake.

DOX for unit 1 updates the main contract, API catalog and changelog. Design
artifacts, README and API policy remain pending the integrated unit 6 pass;
no visible control or design changed. Preserve the final dependency handoff
requirements. No merge or live-account authority exists.

## Unit 1 checkpoint

Local commit `f0037d6` saves shared admission, its tests and the received approved
plan/audit. The commit hook scanned staged content and reported no leaks. It is
not pushed or reviewed for merge.

## Unit 2 verified locally

- Added main-only request/image leases. Session and interactive-login abort
  lifetimes remain independent; background invalidation preserves a newer login.
- Header creation follows admission and lease validation. Queued work, retries,
  pipeline token exchange, body publication and authenticated image hops keep
  their original ownership. Logout/switch cancels obsolete work without circuit
  penalties; a replacement account uses a fresh caller operation.
- Images cancel body/admission waits, do not borrow new credentials, and cannot
  write stale cache entries or clear a replacement in-flight promise.
- Fetchers/resolvers propagate cancellation and queue overflow without advancing
  pagination or negative-caching control-flow failures.
- Three initial tests reproduced queued logout and superseded-login dispatches.
  Final mutation probe dropped BaseAdapter's lease: five logout/switch/login
  regressions failed, then exact source was restored (`A2_MUTATION_GREEN`).
  The first mutation also showed CVR's lazy missing-credential header guard
  independently prevents logout traffic; the strengthened test additionally
  proves immediate admission cleanup.
- Final focused gate: 27 files, 632 tests, then lint, formatting and build passed
  with `A2_PROJECT_GATE_GREEN`. Build includes Node/web types and entry assertion.
  Existing auth/persistence and stale-response tests remain green. Old tests that
  expected automatic cross-account replay now prove rejection plus a fresh read.
  One enrichment test needed its previously implicit durable-session fixture.
- A new fake-timer test initially leaked its clock into unrelated tests; the
  bounded hung run was stopped and explicit cleanup fixed the test fixture.
- DOX: main and both platform contracts, API catalog and changelog updated.
  Renderer/design docs unchanged: no controls or presentation changed. Final API
  policy/volatility/README synchronization remains unit 6.

Usage checkpoint before unit 2 was 26% used in the relevant weekly window.
No required external review or final CI exists yet. T2 review and merge gates
remain in force; Explore integration is still blocked on the final handoff.

## Unit 3 verified locally

Unit 2 is saved as local commit `782fbb7`. Unit 3 ends rate-limited roster and
background enrichment batches, rejects their queued admissions, and retains
usable partial results. Cooldown errors/overflow become sanitized
`rate_limited` at IPC; no outer retry or expiry replay is scheduled.

The renderer previously received only arrays and could drop omitted cached
friends despite main's partial authority. Complete results keep their array
shape; partial responses now carry only friends and a partial marker, while
main retains rate-limit metadata. The query reads its cache after IPC settles
and merges omissions. No new controls, copy, polling or account traffic.

Four paginator regressions and the mounted partial-cache regression fail when
the protections are removed, then source is restored (`A3_MUTATION_GREEN`).
An initial mutation filter matched no tests; that was rejected as evidence and
corrected. The mounted test also needed an actual data subscription, matching
the production observer. Final focused suite: 40 files, 723 tests passed. After
fixing one test-only floating-promise lint error, its 13-test file passed again,
then lint, format, build and diff checks passed (`A3_PROJECT_GATE_GREEN`).

DOX: main, IPC, platform, renderer and shared contracts, API catalog and changelog
updated. Design artifacts remain unchanged because no visual treatment/control
changed. Final policy/volatility/README pass and actual isolated Electron error
wrapping probe remain unit 6. Usage is 33% used in the weekly window. No push,
PR, external review, merge, live-account test or app restart has occurred.

## Unit 4 verified locally

Unit 3 is local commit `5445a35`. Unit 4 adds main-only `RosterRefresh` to both
adapters: ordinary reads/CVR name warming share one session-owned promise, and
live/roster events during its first read request at most one final read. All
joiners receive that final result. Events during the final read join it; later
fresh events and selected recovery intervals remain eligible. Partial final
reads retain useful first-read entries. Rate limits discard follow-ups and
retain useful data as partial. Failure clears the run; account boundaries abort
and clear it with identity-checked cleanup. No renderer trigger/bridge change.

Executable baseline: 20 ordinary VRChat callers made 60 physical requests;
20 CVR callers plus warming made 21. Both regressions fail again when bypassing
the coalescer (`A4_MUTATION_GREEN`), then pass with it. Both platforms' event-storm
probes confirm one final read, shared final data, no 429 follow-up, and later
recovery. Existing internal name-ordering tests now drive the single-read seam
because public overlapping reads deliberately share the same operation.

The wider suite passed 42 files / 754 tests. After correcting two test URL
stringification lint errors, the affected 143 tests passed again. Lint, format,
build and diff checks printed `A4_PROJECT_GATE_GREEN`. DOX: main/platform
contracts, API catalog and changelog updated. Unit 5 fake flap regressions have
since reproduced the remaining immediate-open backoff reset on both platforms;
those uncommitted tests are not part of this checkpoint. No push or PR yet.
