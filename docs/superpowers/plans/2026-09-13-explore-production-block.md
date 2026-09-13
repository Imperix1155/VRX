# Explore production work block

## Authority and baseline

Josh requested a working Explore feature he can test in the live app on
2026-09-13 through the Explore API Refresh Rules task. This authorizes the
production integration described in the approved design, implementation plan
and [current refresh contract](2026-09-09-explore-integration-continuation.md).
Historical preparation-only stops are superseded. The API safety work is
already merged and is not assigned again to this task.

The old foundation PR 305 was merged on 2026-09-10. Its completed merge grant
does not authorize merging the new production implementation. Routine feature
branch commits, pushes, PRs and tracker updates are authorized. Real-account
API or Join testing, screen capture, installed-app replacement, public release
and new merge authority are not inferred. Prepare a private native Mac test
build unless Josh changes the platform. Each capture needs one-time consent.

Recovered isolated checkout: `/Users/imperix/.codex/worktrees/9e9f/vrx`.
Branch: `imperix/vrx-270-explore-production`. Base: `4a39eb3`, current fetched
main including PR 308. Root checkout and unrelated worktrees are preserved.
`npm ci` completed successfully with an independent locked dependency tree.

## Units and ownership

1. Adapter discovery reads and defensive schema boundaries. Worker owns the
   narrow main-only capability and concrete adapter methods in an isolated
   checkout. Driver verifies request paths, no-retry policy and session leases.
2. Main discovery cache, scheduling, budgets, refs, image delegation and Join.
   Test with fake transport, clocks and launcher. Shared admission is reused.
3. Guarded IPC, settings migration, renderer consumers and shared confirmation.
   Preserve existing Friends and Hot Instances behavior. No cache persistence.
4. Integrated gates, critical review, disposable Electron verification, DOX,
   PR/CI and private Mac packaging. Review and capture limits remain explicit.

## Checkpoint

2026-09-13, 08:16 UTC: main/adapters/IPC/settings integration is implemented in
this feature checkout, still uncommitted. Production renderer integration is
being corrected in an isolated worker checkout before serial import. No
production PR, packaged build or runtime acceptance exists yet.

- Main holds one original adapter lease and shared 429 revision per job. Jobs
  abort at 45 seconds, respect the 13/7/20 JSON limits and keep process budgets
  across accounts. CVR candidates publish only after public qualification.
  Selected-world cancellation, five-minute reference renewal, stable selection
  refs, bounded images and settings/identity checks around Join are implemented.
- Driver found and reproduced two reference races. A staged candidate commit
  could rewind a renewed world ref; it now merges evidence without rewinding
  live reference/job state. Renewing an expired open-sheet reference now aborts
  its obsolete job before issuing the replacement. Both regression tests failed
  on the prior implementation and pass with the corrections.
- `/private/tmp/explore-main-integrated-gate.log` ends
  `EXPLORE_MAIN_GATE_GREEN`: max-warnings-zero ESLint and 134 tests across nine
  integrated main/adapter/IPC/settings files. Subsequent focused checks cover
  24 service integration/guard/transport tests and 31 transport/instance tests.
  `/private/tmp/explore-main-checkpoint-gate.log` adds node typecheck and
  138 tests across ten integrated files with `EXPLORE_MAIN_CHECKPOINT_GREEN`;
  the complete main/shared/preload ESLint check also passes.
  This is focused unit evidence, not the pending complete project gate.
- Real VrcAdapter, AvatarCache and shared admission run against synthetic
  `fetch` in `exploreService.transport.test.ts`. It verifies one-second API
  spacing, six three-hop images producing 18 image fetches, and two old queued
  operations plus six new ones producing 24 image fetches inside a later
  rolling 60-second window. The JSON cap is separate. An earlier worker probe
  used a synchronously advancing fake clock and falsely reported short spacing;
  real fake timers removed that artifact. No live request was made.
- `/private/tmp/explore-main-mutations.log` ends `EXPLORE_MUTATIONS_GREEN`.
  Driver bypassed the 20-JSON guard and observed 33 dispatches fail the test;
  bypassing the shared revision guard produced an unwanted CVR world tail and
  failed its test. Source hash was restored and the ten guard tests reran green.
- The shared JoinCoordinator also has handler-level coverage showing friend
  Join respects an Explore-held lock and completed destination cooldown.
- Version metadata was rolled using `npm version 0.20.0 --no-git-tag-version`.
  Only package.json and the two root lockfile version fields changed. Changelog,
  API/DOX and design references are being synchronized before the final gate.
- `/private/tmp/vrx-explore-runtime/` contains a prepared disposable Electron
  probe. It has not run. It must use actual final renderer/preload plus real
  main Explore/settings handlers with synthetic adapters, disposable profile,
  blocked external traffic and a launcher spy. It never captures pixels.

Renderer corrections still in progress include fencing every pending sheet read
across close/switch/account boundaries, local sheet stale expiry, Dashboard
filter cancellation and empty-source feedback, alongside open-sheet invalidations,
shared Join confirmation/mode/keyboard behavior, error feedback, account
boundaries, socket reconnect, and preventing local stale-display timers from
becoming automatic request triggers. Worker test reports remain provisional
until driver inspection and a rerun against the combined checkout.

## Automatic approval review receipts

The focus/online patch was initially rejected because it could trigger fresh
authenticated Explore requests on every wake without an evident rate limit or
cooldown, risking amplification against shared pacing. The review prohibited
an equivalent workaround. The accepted safer implementation adds a timer-free
renderer eligibility guard: relevant visible view, authenticated or retained
healthy account, missing/stale cache and at least five minutes since the last
automatic attempt. It records attempts before IPC and coalesces wake storms;
main retains the canonical physical limits. Driver is checking that snapshot
expiry and cache invalidation cannot themselves trigger fresh requests.

A later module-global retained-account proposal was rejected because it could
outlive coordinator lifecycles and enable work with stale identity state during
transient auth errors. The worker is replacing it with instance-scoped account
retention, boundary clearing and quarantine until a later authenticated result.
That correction has not yet been driver-verified. Neither rejection created a
new numeric policy decision or authorized a bypass.

## Next safe action

Finish and serially import the renderer corrections; run the complete lint,
format, build, test and Fallow gates. Then run disposable Electron behavior and
layout measurements, perform pinned critical review, open the PR, inspect
required CI/external reviews, and package the private native Mac build. Keep
runtime, visual and real-account evidence distinct. Merge, capture and installed
app replacement remain outside the current production grant.

Policy evidence was checked on 2026-09-13 against the
[VRChat creator guidelines](https://hello.vrchat.com/creator-guidelines#api-usage--bots)
and [ChilloutVR terms](https://docs.chilloutvr.net/official/legal/tos/).
Their anti-abuse guidance supplies no numeric request quota. Use the already
approved bounded Explore limits, shared pacing, caching and stop-on-429 rules.
