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

2026-09-13, 08:59 UTC: implementation anchors are `9867b1d` and `c9a2d51`.
The main correction is committed as `5db8540`. All four general-review findings
are corrected and integrated. Full verification and the focused review cover
this cumulative delta before the final private package is prepared.
No production PR exists. A private packaging proof from `c9a2d51` exists, but
the final test package must be rebuilt from the corrected verified head.
External critical review, CI and a new merge grant remain required.

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
  This is focused unit evidence; the later complete project gate is below.
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
- `/private/tmp/vrx-explore-runtime/` contains the disposable Electron probe.
  Its successful exercise and exact limits are recorded below. It uses actual
  renderer/preload and production main Explore/settings handlers with synthetic
  adapters, a disposable profile, blocked external traffic and a launcher spy.

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

## General review and bounded corrections

The general anchor is `c9a2d51024d789db4a248a61ef6fb960f30f4072` against
`4a39eb3532c0778b29c7036eea12697c61d62a21`. Review files are in
`/private/tmp/vrx-explore-review/`: `production.patch`, `manifest.json`,
`prompt.txt`, `run.log` and `verdict.txt`. Exact patch SHA-256 is
`1ef41e278b213bf04cbb5773910b450f2205e14daba35b9020941b94532cd0c5`,
463,869 bytes, 8,238 lines, 76 files. The enforced read-only/never CLI runtime
attested Astra High. `REVIEW_COMPLETE` reported four P2 findings:

- Expired five-minute card refs silently close on explicit opening.
- Concurrent CVR candidate and sheet jobs duplicate world and room reads.
- Keyboard activation can stack Dashboard Explore and Hot Instances sheets.
- An absent disconnected-platform snapshot is presented as an empty result.

No additional material finding was reported. This is one same-lineage review,
not independent external coverage. The reviewer verified exact artifact/source
provenance after the temporary extraction incident described below.

The main correction shares identical pending world/room operations only inside
one account state. Every consumer keeps its own cancellation checks. Transport
stops when the last consumer leaves, retains its first consumer's original
lease/deadline/attempt budget, and never retries. Regression cases cover both
start orders, world and room counts, independent cancellation, all-consumer
cancellation, lease expiry, the original 45-second deadline, shared 429 revision
and replacement accounts. Existing 13/7/20 physical limits remain covered.
`/private/tmp/explore-shared-reads-red.log` records seven failing new cases before
the fix. `/private/tmp/explore-shared-reads-green.log` records 34 passing service
integration/guard/transport tests. Driver mutations removed pending reuse and
made one consumer cancel every other consumer; both were rejected by regression
tests. Exact source restoration and the 34-test rerun end
`EXPLORE_SHARED_READS_MUTATIONS_GREEN` in
`/private/tmp/explore-shared-reads-mutations.log`. The documented node typecheck,
max-warnings-zero focused ESLint and diff check passed with
`EXPLORE_SHARED_READS_GATE_GREEN`. An initial raw `tsc` command omitted the
project script's `--composite false` and failed on existing cross-tree test
imports; using the documented script passed. Its generated build-info file
was verified and removed.

The three renderer corrections are integrated. Explicit opening recovers an
expired ref once from the main cache, matching stable platform/world identity.
Close/account/filter/request-order fences apply to the entire recovery, including
bridge rejection and loading-to-ready change events. Image results belong to
the selected reference, independently of subsequent room reads. The deferred
renewed-image case failed before that last fence correction in
`/private/tmp/explore-recovered-image-red.log`; its fixed route suite is in
`/private/tmp/explore-recovered-image-green.log`.

Dashboard opening either sheet clears the other, including native keyboard
activation. Disconnected source presentation observes existing auth cache
without creating an auth query, and preserves healthy-platform cards. Driver
caught and removed a proposed `useAuthStatus` observer because remounts after
its stale time could dispatch `/auth`. Real-cache tests cover mount and remount
without a bridge request. Three existing partial module mocks now retain the
real query-key export used by this cache subscription.

Driver mutation checks rejected removal of ref recovery, restoration of the
auth-fetching observer, removal of sheet exclusion and removal of unavailable
presentation. `/private/tmp/explore-four-fixes-renderer-mutations.log` includes
all four deliberate failures, 94 restored tests and
`EXPLORE_RENDERER_CORRECTIONS_MUTATIONS_GREEN`. Python/subprocess buffering
interleaved the restored-run output with one mutation report; each labeled
result and the final full gate provide the distinct outcomes.

`/private/tmp/explore-corrections-full-gate.log` records the integrated uncached
ESLint/format/build/typecheck/entry gate and all 181 files / 2,734 tests passing,
with `EXPLORE_CORRECTIONS_FULL_GATE_GREEN`. Fallow correction receipts remain
under `/private/tmp/vrx-explore-fallow/`: zero new dead-code findings, all eight
baseline entries matched, and 139 baseline-filtered clone groups. The 26 new
fingerprints since the general anchor touch test files only.

`/private/tmp/explore-corrections-runtime.log` records the actual built app
components and handlers passing `EXPLORE_RUNTIME_PROBE_EXERCISE_GREEN`. The
probe now also verifies Hot-to-Explore-to-Hot with native Enter input and exactly
one visible sheet. It briefly shows only the disposable synthetic-data window
for macOS focus, then destroys it during cleanup. Earlier probe attempts failed
because native focus had not settled and because keyDown/keyUp omitted Enter's
character event required by native buttons. Awaiting focus and sending the full
native sequence resolved those probe defects. No application fix was inferred
from either harness failure. No capture or real-account traffic occurred.

## Focused review follow-up

The first focused review covers `c9a2d51` through `f3bab896a8d201a4e075c9c26d836e2c1aba1ef9`.
Its exact patch SHA-256 is
`c53a2b62c7567fbe3015b83a4d901ed4ca0aefe8bd7c2fb4d1fdd08ea9300fed`,
81,980 bytes, 1,421 lines and 14 files. Artifacts and the enforced read-only,
never-approval Astra High runtime receipt are in
`/private/tmp/vrx-explore-focused-review/`. `REVIEW_COMPLETE` reported two P2
renderer races; main read sharing and cache-only auth presentation had no
material finding. Prior adapter/IPC/ranking/settings/Join conclusions remain
applicable, so the reviewer called for bounded corrections without restarting
the whole-feature review.

- A same-platform change during held expired-ref recovery read the obsolete
  ref and closed the selection. `/private/tmp/explore-recovery-invalidation-red.log`
  reproduces it. Recovery now holds those invalidations and drains them against
  the renewed ref, retaining immediate account/close/reselect fences.
- Explore-to-Hot handoff restored the outgoing Explore opener after the new
  Hot sheet focused Close. `/private/tmp/explore-sheet-focus-red.log` reproduces
  that activeElement mismatch. The handoff now consumes one outgoing focus
  suppression; ordinary closure still restores its opener. Both handoff
  directions and subsequent ordinary closes have focus assertions.

`/private/tmp/explore-race-fixes-green.log` records 69 passing route/Dashboard
tests before the complete gate. The disposable native-keyboard probe now also
checks the incoming Close focus after two animation frames in each direction.
The `f3bab89` ZIP is superseded by these fixes and must not be handed out as
final. It remains an honest packaging proof for its recorded source revision.
The corrected source passed all 181 files / 2,735 tests plus uncached lint,
formatting, typechecks, build and entry assertion in
`/private/tmp/explore-race-fixes-full-gate.log`, ending
`EXPLORE_RACE_FIXES_FULL_GATE_GREEN`. The updated native keyboard/focus exercise
passes `EXPLORE_RUNTIME_PROBE_EXERCISE_GREEN` in
`/private/tmp/explore-race-fixes-runtime.log`. Fallow remains zero new dead-code
issues and 139 baseline-filtered clone groups, with no new production clone.
A focused follow-up and fresh final-source package remain required.

## Private packaging proof and recovered tooling incident

Electron Builder produced the native arm64 directory package using the locked
local Electron 43.4.1 distribution. Ad-hoc signing with hardened runtime passed
`codesign` verification but failed in dyld before Node. The existing working
private installation uses ad-hoc signing without hardened runtime. The private
build command now uses `-c.mac.identity=- -c.mac.hardenedRuntime=false`, leaving
tracked production signing policy unchanged. The rebuilt proof loads packaged
`electron-updater`, `builder-util-runtime` and `fs-extra` under Electron Node
mode and prints `PRIVATE_PACKAGED_MODULES_GREEN`. This does not prove normal
VRX startup or real-account behavior. No installed application was changed.

During package inspection, a worker used ASAR CLI `extract-file` from the source
checkout. That command writes basenames into cwd. It replaced `package.json`
with a dependency manifest and created `index.js` equal to the built preload.
Driver verified the exact manifest and file hash, restored only those owned
deltas from `c9a2d51`, and confirmed a clean source tree. The resulting failed
package attempt was discarded and rebuilt. The general reviewer observed the
restoration and verified that its pinned patch remained exact. Maintained
`cut-release/SKILL.md` Gotchas now specify programmatic Buffer extraction or a
disposable cwd and require module-load proof in addition to signature checks.

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

Pin and review the corrected functional delta from `c9a2d51`, open the PR, and
rebuild the private native Mac test package from that verified head. CI and
critical external reviews govern merge readiness separately; a private local
test package does not require merge or public release. Keep runtime, visual and real-account evidence distinct. Merge,
capture and installed app replacement remain outside the current production grant.

Policy evidence was checked on 2026-09-13 against the
[VRChat creator guidelines](https://hello.vrchat.com/creator-guidelines#api-usage--bots)
and [ChilloutVR terms](https://docs.chilloutvr.net/official/legal/tos/).
Their anti-abuse guidance supplies no numeric request quota. Use the already
approved bounded Explore limits, shared pacing, caching and stop-on-429 rules.
