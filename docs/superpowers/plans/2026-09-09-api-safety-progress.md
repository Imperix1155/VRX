# API-safety implementation progress

September 9, 2026. Josh authorized starting the approved changes after receipt.
Scope remains [the six-unit hardening plan](2026-09-09-api-traffic-hardening-plan.md).
Production work is underway. Unit 1 is verified locally; unit 2 is next and
units 3–6 are pending. No PR, push, or merge has occurred.

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

Checkpoint unit 1, then implement unit 2 session leases.
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
