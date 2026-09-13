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

2026-09-13, 08:34 UTC: the main unit is committed locally as `9867b1d`.
Renderer integration and bounded corrections are implemented in this feature
checkout and have passed the complete local gate and disposable runtime exercise.
No production PR or packaged build exists yet. General and external critical
reviews are still required; this is a verified implementation checkpoint, not
merge readiness.

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

Renderer inspection found and corrected mounted disabled query observers retaining
old account data after cache removal. Resetting the query clears the mounted
observer without a request. Both routes now use `useExploreWorldSelection` for
ordered reads and cancellation; delayed manual/cache replies cannot restore a
closed or different-account sheet. Older loading replies cannot overwrite newer
ready data. `/private/tmp/explore-renderer-mutations.log` records the ordering
mutation failing on both routes and 29 restored query/lifetime tests passing.
Its first restored run used Escape before the listener had settled; the lifetime
test now uses the direct Close control, with Escape covered separately.

The oversight task identified raw world-ID prefixes and an unfair tie seed
biasing the first platform. `/private/tmp/explore-ranking-red.log` reproduces both.
Cross-platform comparisons now use common UUID material; a fair session coin
flip assigns distinct tie seeds. Twenty ranking/seed tests include either real
platform leading and label-swap symmetry.

`/private/tmp/explore-production-full-gate.log` records uncached max-warnings-zero
ESLint, Prettier, both TypeScript checks, production build and entry assertion,
and 2,713 passing tests. Two existing socket integration tests were blocked by
sandbox loopback permissions. They passed unchanged with local-listener access
in `/private/tmp/explore-production-loopback-gate.log`, ending
`EXPLORE_FULL_GATE_GREEN`. Combined: 181 files and 2,715 passing tests.

Fallow 2.89.0 compared the exact `4a39eb3` baseline in
`/private/tmp/vrx-explore-fallow/`. `final-dead-code.json` reports zero new issues
and matches all eight baseline entries. `final-dupes.json` reports 113 groups
remaining after baseline filtering, not a total of 113 for the whole project.
Production entries are existing or platform-specific adapter shapes, independent
Join/self-invite checks, repeated public type signatures and shared modal focus
handling. Test setup/assertion clones remain. No duplicate group touches the new
main Explore service or common selected-world hook.

`/private/tmp/explore-production-runtime.log` ends
`EXPLORE_RUNTIME_PROBE_EXERCISE_GREEN`. The actual built renderer/preload and
production Explore/settings handlers ran in Electron 43.4.1 arm64 with a fresh
temporary profile, synthetic adapters, blocked external traffic and launcher spy.
It exercised Dashboard stats/Explore/Hot Instances, 2/4/6 and filters, asynchronous
sheets, focus restoration, both Join modals including an enabled qualifying full
CVR room, dark/light card/sheet/scrim measurements at a 900×638 content viewport,
and settings JSON plus renderer reload. Zero blocked-network attempts occurred.
The first probe miscounted retained hidden sheet exit-animation DOM as an open
sheet; correcting its locator produced the passing exercise. No screenshot,
real account, game launch, installed-app change or live API result was involved.

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
transient auth errors. It was replaced with instance-scoped account
retention, boundary clearing and quarantine until a later authenticated result.
Driver inspection and the integrated suite cover that correction. Neither rejection created a
new numeric policy decision or authorized a bypass.

## Next safe action

Save the verified renderer/ranking checkpoint, perform the pinned critical general
review, open the PR, inspect required CI/external reviews, and package the private
native Mac build. Keep runtime, visual and real-account evidence distinct. Merge,
capture and installed app replacement remain outside the current production grant.

Policy evidence was checked on 2026-09-13 against the
[VRChat creator guidelines](https://hello.vrchat.com/creator-guidelines#api-usage--bots)
and [ChilloutVR terms](https://docs.chilloutvr.net/official/legal/tos/).
Their anti-abuse guidance supplies no numeric request quota. Use the already
approved bounded Explore limits, shared pacing, caching and stop-on-429 rules.
