# VRX-273 design-guide rebuild

## Status and authority

Kickoff verified on September 15, 2026. Josh then explicitly authorized the
complete rewrite in this task, superseding the kickoff-only stopping point.
Implementation is now in progress. The human HTML guide will show real
components; the agent-native Markdown will contain concise operational rules,
source references, states, constraints, and verification guidance.
It does not grant permission to merge, install an app, publish a release, or
perform account actions.

On September 16 Josh authorized continuing this work overnight using bounded
units and best judgment. Feature-branch commits, pushes, review, PR delivery,
and tracker updates remain authorized. Do not merge, package another Mac app,
or install anything. The existing guide interaction pass and its one narrow
Dashboard capture remain authorized; no broader capture exception is active.
Integrate verified required app fixes when available. The optional Hot Instances
redesign is separate and must not block the guide or appear as current behavior.

Approved direction: rebuild most of the guide from current React components,
tokens, copy, and implemented behavior. Keep the liquid-glass material, aurora,
retro accents, dark default, and full light support. Equivalent concepts must
remain understandable on either platform. Show useful rendered examples with
synthetic data. Settle HTML and its examples first, then synchronize Markdown.
Do not turn known app defects or old documentation into new design rules.

The primary decision record is the coordinator-owned
[/Users/imperix/.codex/visualizations/2026/09/15/01a0a40b-84d5-7312-b070-def970948176/vrx-testing-notes.md](/Users/imperix/.codex/visualizations/2026/09/15/01a0a40b-84d5-7312-b070-def970948176/vrx-testing-notes.md).
It is readable from this checkout and remains untouched. Later entries supersede
earlier delivery status in that chronological ledger. The originating task is
`01a0a40b-84d5-7312-b070-def970948176`, VRX 1.0 Progress, on host `local`.

## Verified baseline and dependency

- GitHub `main`, local `origin/main`, and this task's initial detached HEAD were
  `e3a8a9acc458a95bd7e5933d1ce884dcdc3cc8d3`.
- [PR #315](https://github.com/Imperix1155/VRX/pull/315) remains OPEN, targeting
  `main`, with head `154385f49a9154831ae9eab1179a7c58d8d3b3c6`. It contains two
  commits after that baseline. Its owning checkout
  `/private/tmp/vrx-visual-fixes-20260915` is clean and pushed.
- This clean task checkout now has local branch
  `imperix/vrx-273-design-guide` at that exact head. Worktree:
  `/Users/imperix/.codex/worktrees/63e2/vrx`.
- The handoff records the installed Mac version as
  `0.20.1-local.20260915.154385f` and Josh's subsequent feedback as
  "Everything looks fine". This kickoff confirmed the running app path, not
  its installed hash or every UI flow. No new app capture occurred.
- Existing [VRX-273](https://linear.app/imperix/issue/VRX-273/rebuild-the-design-guide-from-actual-app-components-and-tokens)
  is now In Progress for planning and source inventory. No duplicate issue was
  created. VRX-272 and the unrelated Trust backlog were not changed.

Treat PR #315 as a dependency. If a docs PR is needed while it remains open,
target its feature branch so the docs diff contains only VRX-273 work. After
it merges, move only the documentation commits onto the verified new main and
retarget the docs PR. Recheck the diff and component baseline after either
branch changes. Do not cherry-pick or copy the app fixes into this task, and do
not merge PR #315. The original Explore worktree and its local Trust correction
remain untouched.

## Source inventory

Paths below are relative to this repository. The root `AGENTS.md` governs the
design documents; `docs/guide/AGENTS.md` now owns guide implementation. Renderer work also requires
`src/renderer/AGENTS.md`; shared changes require `src/shared/AGENTS.md`.

| Example                             | Production source and reuse boundary                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explore and Popular now cards       | `src/renderer/src/components/ExploreWorldCard.tsx`, `ExploreDashboardPreview.tsx`, `ExploreView.tsx`, `ExploreWorldSheet.tsx`, and `ExploreSourceState.tsx` already accept data and callbacks as props. Reuse them directly.                           |
| Complete Dashboard                  | `DashboardView.tsx` owns private `StatCard` and `HotInstanceCard` components and mounts the Explore preview route. Render the real parent with fixture-backed dependencies to retain stats, Popular now, Hot Instances, and the threshold control.     |
| Friends and linked identities       | `FriendsList.tsx` owns private `FriendRow`; `FriendDrawer.tsx` exports a component with friend and optional linked-profile inputs. Preserve row virtualization, controls, notes, status, Where, and quiet Trust. Connected hooks need fixture backing. |
| Instance labels and policy          | Import `InstancePill.tsx`, `PolicySpacePill.tsx`, and `utils/instancePill.ts`. Use `instancePillFor(instance, labelScheme)` instead of copying label or color maps.                                                                                    |
| Segmented controls                  | `SegmentedControl.tsx` is directly reusable. The actual platform filter is private inside `TopBar.tsx`; render TopBar with fixture dependencies. English locale values are `VRC / ALL / CVR`, with the real measured bubble.                           |
| Updater and settings                | `Sidebar.tsx` owns private `SidebarUpdateButton`; `SettingsView.tsx` owns the appearance controls. Inject updater states and local settings; never connect action callbacks to a real bridge.                                                          |
| Material, fonts, themes, background | Import `assets/main.css`, bundled fonts, and `i18n`. Reuse `applyTheme` and `applyGlow` from their existing hooks. Dark and Standard mean the attributes are absent; light uses `data-theme="light"`.                                                  |

The baseline had no Storybook or standalone guide-preview command. Vitest
and jsdom tests provide fixture patterns, including
`src/renderer/src/test-utils/friendFixture.ts`, `FriendDrawer.linked.test.tsx`,
`DashboardView.test.tsx`, `ExploreView.test.tsx`, and `SettingsView.test.tsx`.
They are examples to adapt, not browser rendering evidence.

The prior app-fix runtime fixture is readable at
`/Users/imperix/.codex/worktrees/9e9f/vrx/dist/explore-private/visual-audit-20260915/runtime-fixture`.
It imports real CSS, Explore routes, and FriendDrawer with synthetic data and
fake bridge methods. Reuse its approach, not its absolute paths, type casts,
flat test image, or private evidence files. This task now has its own dependencies from `npm ci --ignore-scripts`.

## Implemented guide arrangement

Use the existing Vite, React, and Tailwind toolchain for a separate docs build.
No new preview framework was added. These planned files are now implemented:

- `docs/design.html`: readable contributor guide and example captions, replacing
  hand-maintained app markup. Keep existing useful section links.
- `docs/glass.html`: shared isolated scene entry used by the guide and usable
  directly. Default to the current Dashboard composition. The same runner also
  renders individual material/component scenes, so there is one implementation
  of each fixture example.
- `docs/guide/`: React scene registry, typed fixtures, guide-only
  chrome, fixture dependencies, and Vite configuration. Each scene records its
  component imports and source revision. Add a concise owning contract when
  this directory becomes real, then update the parent index.
- `docs/DESIGN.md`: synchronize concise implementation rules after the rendered
  guide settles. Preserve externally cited sections 5, 6, and 10 and their
  links. Correct stale digest rules and the claim that copied HTML is the exact
  rendering authority.
- `package.json`, a dedicated guide TypeScript configuration, and focused
  scripts/tests as needed for preview, build, fixture isolation, and validation.
  `electron-builder.yml` needs explicit exclusions for any new guide tooling
  or output that would otherwise package. Its current rules do not prove
  `docs/**` is excluded.
- Update root/nearest contracts, `README.md`, and `docs/INTERNAL-API.md` only
  where the new workflow or reusable interfaces require it. Production
  component extraction is a fallback, not the starting assumption.

Keep guide controls outside app examples. Use isolated scene documents for
dark/light comparison so root theme attributes, body glows, fixed sheets,
portals, and focus behavior retain their production context. Give examples
enough width to read at normal size; stack comparisons on narrow screens.

Every example identifies one of three states: static sample, interactive
fixture, or unimplemented proposal. Component source and fixture provenance
belong in a compact caption or expandable detail. They are not app UI copy.
No proposal is presented as a working app feature.

For connected scenes, use a fresh nonpersistent QueryClient and resettable
Zustand state. Account for modules that import the query singleton directly,
not just context consumers. Stub data dependencies through docs-only wiring
while preserving the actual presentation components. Do not mount the normal
`main.tsx`/`App` startup and persistence lifecycle. A full Dashboard's internal
Explore route must also receive only fixture dependencies.

Install an explicitly synthetic bridge only in the isolated fixture document;
refuse to reuse an existing live bridge. Use local images and bundled fonts.
No account reads, external image loads, authentication, telemetry, downloads,
installation, game launches, or external URL opening. Fixture actions may
change local sample state or display a confirmation, but must never forward
to Electron. Verify this boundary before exposing interactive examples.

## Initial section and example structure

| Guide section                 | Visible examples and content                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direction and current app     | Short identity statement; dark-default/light support; assembled Dashboard with stats, Popular now, Hot Instances; equal platform importance.                                                                                                 |
| Tokens, material, and canvas  | Source-backed swatches; base/frosted/heavy-frosted real components over readable text and meaningful local art; separate platform tint from background glow; Muted/Standard/Vivid in both themes.                                            |
| Meaning in the interface      | Actual platform rails/text, presence/status ring and badge, written drawer status, access and policy pills, Join affordances, quiet Trust below Notes. State and status remain separate data axes.                                           |
| Instance terminology          | All eight VRC and nine CVR model types across three naming schemes, VRC terms by default; word-only group labels; Private, Offline Instance, Unknown; qualify uncertain CVR wire mappings.                                                   |
| Typography and layout         | Actual page/section/card headings, body/helper text, controls, stats, IDs, wrapping and truncation. Keep legitimate size differences. Show shell/navigation and spacing in context.                                                          |
| Controls and component states | Real sliding bubble with keyboard/focus states; cards, sheets, drawer, Join confirmation, appearance controls; updater absent/collapsed/expanded/available/downloading/restart fixture states.                                               |
| Friends and linked people     | Real rows, single/split Where cards, two-location pill and chooser, notes/identity controls, offline/hidden/mixed-platform states. Preserve current field order and control access.                                                          |
| Feedback and accessibility    | Initial loading per platform, retained results, meaningful errors/unavailable/empty states, existing login/note failure presentation, dismissal/focus, grayscale and reduced motion. Keep account protocol details in owning technical docs. |
| Contributor checks            | Compact source/fixture maintenance guidance and corrected Do/Don't rules; source links instead of duplicated CSS recipes.                                                                                                                    |

This covers all existing guide sections, including light mode and login
feedback. Light is demonstrated throughout instead of isolated in one stale
sample. Preserve useful legacy HTML anchors and Markdown section references
even where the reading order changes.

## Work units and observable gates

1. **Prove component reuse and isolation.** Driver owns the docs build and
   fixture boundary. Start with one real ExploreWorldCard, then one complete
   Dashboard scene. Confirm local fonts/styles, theme/glow application, a
   single fixture query source, inert action dispatch, and no external traffic.
   This resolves whether the larger parents can be reused without extraction.
   A successful build alone does not prove a faithful render.
2. **Settle the first rendered slice.** Build the intro, assembled Dashboard,
   and material examples. Use varied local art and busy backgrounds, actual
   frosted sheets, both platforms/themes, narrow/wide widths, and accessible
   Close after long-list scrolling. Present this slice for Josh's feedback
   before applying its editorial layout to the rest of the guide.
3. **Replace remaining examples.** Work through the section matrix with real
   components and shared fixture data. Exercise filter selection, label schemes,
   long content, missing art, linked states, meaningful errors, keyboard/focus,
   reduced motion, grayscale, and inert updater transitions. Record any source
   defect separately; do not silently fix app behavior during this rewrite.
4. **Synchronize contracts.** Reconcile all three design artifacts after HTML
   settles, including Trust, row/status semantics, light tiers, 20px/16px
   segmented track/bubble heights, and source authority. Run the DOX pass, preserve cited
   anchors, and classify documentation changes separately from app behavior.
5. **Verify and deliver.** Run guide-specific type/build/isolation checks and
   relevant interaction tests. Changes to application/build/configuration get
   `npm run lint && npm run format:check && npm run build`, plus focused tests.
   Observe actual browser rendering with the required one-time capture consent;
   use `verify-electron` if any production renderer behavior changes. Inspect
   packaging exclusions, source links, stale claims, and the final diff. Run
   `review-loop` before a PR, including applicable Fallow checks and final-head
   CI. Leave the PR open without explicit merge authority.

The driver owns shared wiring, integration, tracker state, and final claims.
Once fixture interfaces are proven, independent section inventories or disjoint
example modules can be delegated in separate worktrees. All four delegated inventory/implementation lanes are complete. The driver
inspected and integrated their output; no worker remains active.

## Decisions, uncertainties, and next action

No material product decision blocks the kickoff. Do not re-ask about People,
removed Visible rooms counts, quiet retained-result refresh, platform parity,
real components, or de-emphasized Trust. Ask to join is not an implemented flow;
the join-mode setting Always ask is unrelated.

Explore Join/access emphasis, Full beside below-capacity counts, and Private
versus Hidden wording remain unsettled app findings. Preserve existing behavior
and label the limits; no changes are included here. Review VRX-74's mismatch
with the quiet-Trust decision when relevant, without implementing or cancelling
that issue automatically.

The remaining technical probes are fixture wiring for private components,
theme/overlay behavior inside scene frames, emitted Tailwind coverage, and
package exclusion. They are implementation checks, not owner decisions yet.
Before any capture, name the exact target and purpose and wait for fresh consent.

Current action: implement work unit 1 and the guide's first rendered examples,
then complete the approved rewrite. Routine preview/build choices and PR
preparation are authorized. Capture still requires one-time consent, and no
merge or installation is authorized. The kickoff changed only this local plan;
subsequent implementation and verification will be recorded below.

## Implementation and verification checkpoint

The human guide and isolated scene runner import real components, translations,
fonts, and CSS. The agent-native `DESIGN.md` now records concise source-backed
rules with preserved section numbers. Its final wording remains subject to the
required rendered inspection. Stale presence/Trust references in owning contracts
were reconciled. README, API catalog, changelog, and guide ownership are updated.
API policy/volatility are intentionally unchanged because upstream assumptions
and real account behavior did not change. No production application code changed.

Connected scenes seed the production query singleton inside isolated documents
and mount AppShell without the normal App/main persistence lifecycle. All calls
terminate at the sealed synthetic bridge. The guide has its own TypeScript
project, explicit renderer Tailwind source paths, and package exclusions.
The first CSS build lacked renderer-only utilities; adding the explicit source
paths restored the compiled 25px/38px utilities and production glass declarations.
This source evidence is not visual verification.

- Full coverage: 183 files, 2,773 tests passed. Statements 90.98%, branches
  87.43%, functions 90.04%, lines 93.64%. The first sandbox run had two localhost
  bind denials; the same gate with network permission passed. No test was skipped.
- Project gate: lint, format check, build, and entry-chunk assertion passed with
  `PROJECT_GATE_GREEN`. Coverage was followed by lint as required.
- Guide typecheck/build passed with `GUIDE_BUILD_GREEN`; seven focused tests pass.
  Both the sealed-bridge guard and both platforms' first-load fixtures were
  mutation-checked, restored, and retested green.
- Fallow registered the real renderer and guide entry points. No new guide dead
  code or clone group remains. Seven reported unused/duplicate-export findings
  are unchanged from the clean PR315 baseline; no unrelated cleanup was made.
- Relative design links and `git diff --check` passed. Source review corrected
  the avatar state fold, Trust availability, and technical-ID font description.

The localhost server serves `http://127.0.0.1:4173/design.html`.
Josh approved one screenshot through the originating voice task. The Codex
in-app browser opened successfully, and that screenshot showed the dark guide
introduction plus the top of the real Dashboard, including platform filter,
statistics, and world-card artwork. No alternative browser was needed. The one
image approval is consumed. Full visual verification remains incomplete.
On September 16, Josh approved the requested light Dashboard screenshot at
`glass.html?scene=dashboard&theme=light&render=1`, at the supported 900×670 floor.
The in-app browser capture showed the full sidebar, all six navigation controls,
the updater icon, Dashboard heading, VRC/ALL/CVR filter, 13/12/3 statistics, and
both popular-world cards. Main content extends into its expected scroll area.
That second one-image approval is consumed, and the viewport override was reset.
No installed app, other window, or real account was captured or operated.

## Review and correction checkpoint

Local checkpoint `d63af8bd8e3303f12292f1c295c6569f5ca775f8` contains the initial
implementation. Fresh Astra/high general review ran with observed `read-only`
sandbox and `approval: never`. It verified diff hash
`fc8f3d2e2b1646f6cfb40f26eb063aa3ee6a5fb04d666d5f9df09d65d8193005`
against base `154385f49a9154831ae9eab1179a7c58d8d3b3c6`. It found four P2 issues:
short desktop frames clipping the updater, permanently expired room fixtures,
unreachable CVR initial-load/retained-refresh samples, and missing note failures.

The focused correction keeps the production components and isolation boundary:

- Desktop examples preserve 900×670 inside a scrolling guide frame and in the
  standalone runner. Overlays wait for a reader gesture, avoiding initial focus
  theft. Guide headings follow fixed type sizes without negative tracking.
- Successful room reads timestamp the current read. Explore and material Refresh
  renew their snapshots after expiry. Source/room/drawer state options share one
  registry with both entry controls, including CVR first load and quiet refresh.
- Synthetic note-load/save failures reject the first operation per key, retain
  the saved value, and recover through explicit retry. No data persists.

Fifteen guide tests passed after these corrections. The driver reproduced the
worker's note-retry mutation and separately removed the room timestamp and
Refresh corrections: each mutation failed the intended tests; restoration passed.
Guide typecheck/lint passed. Fallow still reports the same seven baseline findings
and no guide clone groups. The SHA-bound gate at correction head
`318eeea726b53a1818e5643fb6cb1b9c2e326efd` passed lint, format, application build,
guide typecheck/build, and all 15 guide tests with `FINAL_LOCAL_GATE_GREEN` in
`/private/tmp/vrx-273-final-head-gate.log`.

Fresh read-only Sol/high focused review completed and confirmed all four fixes.
Its exact delta hash was
`be9cc2cd5aa99055f53bab0e94431b7b77f3d25f7a3332248720c0f6c4b38d02`.
It found one additional P2: the guide-only friend drawer caller did not restore
focus after close. Six regression cases reproduced focus remaining on the
hidden Close button, across both platforms and Close/Escape/outside-pointer
paths. The wrapper now restores its opener without scrolling, matching the
production caller contract. Those six tests and the prior 15 tests pass.
The local contract explicitly preserves caller-owned focus restoration.

The focus correction is committed at
`ea4cff30ad5b707cbe5dd2e535e42abd2b0e432d`. Its fresh read-only Sol/high focused
review found no actionable issue and verified artifact hash
`d7a2b2d8ef73f84f3bd6be07be548775b3b2778ac8e9a511faa82b66ca0e67a0`.
The driver observed the SHA-bound full local gate finish with
`FOCUS_HEAD_GATE_GREEN` in `/private/tmp/vrx-273-focus-head-gate.log`, including
all 21 guide tests. This completed after the reviewer's read-only test attempt
was blocked from creating Vitest temporary files. Fallow retains exactly the
seven baseline findings and no guide clone groups.

Local source review is complete through that functional head. Complete browser
inspection and PR delivery remain outstanding. No branch push or merge occurred. The current
coverage ledger is `review/coverage-ledger.md` under the artifact directory below.

Review artifacts and logs are under
`/Users/imperix/.codex/visualizations/2026/09/16/01a0a80a-e6ef-7d52-ae0b-6b0b9b362758/review`.
The general review is a same-lineage Codex check, not independent model confirmation.
The driver inspected all delegated artifacts and reran their decisive checks;
no implementation worker remains active.

Josh specifically requires meticulous Codex in-app-browser verification across
themes, widths, and interactive states. Complete the consented captures and
interaction checks before claiming the guide finished. Source tests, a served
preview, and builds do not replace that evidence. The docs branch remains based
on PR315 head `154385f49a9154831ae9eab1179a7c58d8d3b3c6`; merging is not authorized.

## September 16 visual checkpoint

The consented light Dashboard capture exposed redundant synthetic-art labels
behind the production platform badges. The fixture SVG now contains only the
background artwork; production cards retain their own world titles and platform
labels. All six SVGs parse, keep their dimensions/colors, and contain no text
nodes. Uncached lint, guide typecheck/build, and all 21 guide tests pass.
The subsequent approved dark-drawer capture showed clear platform badges over
the corrected artwork. Fresh read-only Sol/high focused review of the correction
found no actionable issue, verifying artifact hash
`ca8a8ca7f6a6872268a0b147cc8bd2e543cd3e99e2fbc2f79428c4ebbe2e90b2`.
The review classified it as guide-only T1 visual behavior and retained earlier
coverage. No production app source changed.
DESIGN.md and other product/API contracts are intentionally unchanged because
only decorative fixture content changed.

Josh approved the synthetic dark friend drawer at
`glass.html?scene=drawer&theme=dark&render=1`, 1100×800 in Codex's in-app browser.
Open focused Close. Both Escape and Close returned focus to the opener, outside
the inert drawer. The single approved open screenshot showed the frosted panel,
readable notes, quiet Trust below Notes, and visible Close/Join controls.
That capture consent is consumed and the viewport override was reset.

Josh approved the synthetic light Join dialog at
`glass.html?scene=join&theme=light&render=1`, 900×670 in the same browser,
including keyboard focus, Cancel/Escape, the synthetic Confirm failure, and one
open-dialog screenshot. The browser check confirmed initial Cancel focus,
forward/reverse Tab wrapping within the modal, and restoration to the opener
after Cancel and Escape. Synthetic Confirm closed to the main region, with no
inline alert in this fixture. Source confirms terminal failures close the modal
and attribute feedback to the originating friend control. The screenshot showed
the heavy light panel and all controls within the supported window. That image
permission is consumed and the viewport override was reset.

Josh approved the remaining pass of `design.html` at 760×900 and 1280×900: both
themes, scrolling, state selectors, note retries, and updater expansion, with one
screenshot of the Dashboard section at 760×900. This approval is unconsumed at
the source-integration checkpoint below. It permits no additional screenshots.

The coordinating VRX task also relayed a newly approved app consistency fix:
Dashboard's Popular now and Hot Instances labels should use the subdued gray
treatment of comparable secondary headings, with consistent weight. The owning
Explore task owns the production source. The driver inspected its correction at
`d71f92b458b2f95e64429fa6a1f813176dcd5b59` and verified GitHub PR315 remains open
at that exact head. Both Popular now renderers now use explicit normal weight
and `--text-faint`; sizes, tracking, IDs, and semantics are preserved. Hot
Instances already has the intended treatment and is unchanged. The docs branch
was rebased onto that revision, with a recovery branch preserving the old local
head. Three expected documentation conflicts retained the rewritten Markdown and
module-entry HTML. The new heading rule is reconciled into DESIGN.md and the
human guide's owning React prose; both HTML entries still use the real components.
The rewritten guide implementation is otherwise byte-identical to the prior
checkpoint. The upstream changelog and renderer-contract additions are preserved.
The docs-only diff has no production application source edits.

Rebased review provenance: `d63af8b` → `57de189`, `318eeea` → `9dafe8d`,
`ea4cff3` → `86ccfed`, `d71e111` → `bb1e50d`, `c3f89a1` → `ce9c6f4`, and
`7becd79` → `3692502`. Preserve the original immutable review artifacts; verify
the integrated guide against the new dependency before delivery.

Statistics → Hot Instances → Popular now and image-led Hot cards are a separate
future proposal in Backlog VRX-274. They are not current app behavior. Missing
world artwork is under separate read-only diagnosis and has no source fix here.

## Overnight browser and fixture checkpoint

The approved `design.html` pass at 1280×900 confirmed both source first-load
messages beside retained cards, quiet refreshing, source error/unavailable
copy, and the intentionally absent empty Dashboard preview. Room loading,
error, and stale variants are reachable; Refresh restores an eligible Join
while full and unavailable rooms remain disabled. Note-load Retry restores the
saved text. Note-save failure retains the edited draft; Retry clears the error
and reopening preserves the new in-memory note. Updater available, downloading
at 46%, downloaded, and idle are reachable; available and downloaded controls
receive keyboard focus, and idle removes the control. The available button's
bottom was 630.5px in a 670px frame. No updater action was invoked.

ArrowRight moved the real segmented control to Per platform with its sole
`tabindex=0`. The instance-label sample changed CVR terms to platform-native
wording. Actual Appearance controls selected Light and Vivid. The linked Nyx
drawer showed both platform identities, both Where cards, shared Notes, Trust,
and Identities. These are DOM/accessibility and interaction observations, not
additional screenshots. No captured image proves every state or reduced motion.

At 760×900, the light guide's document scroll width was exactly 760px. Both
Dashboard examples retained 900px width inside 676px horizontally scrolling
wrappers. At 1280×900, they stacked at 932×670 without page overflow. Both
Popular now and Hot Instances computed to weight 400 and the same faint color
in each theme; their intended 20px/18px sizes remained distinct.

The pass exposed a guide-only lifecycle defect: after five minutes TanStack
Query garbage-collected the seeded Explore queries, which the Dashboard reads
without a Query observer. Popular cards disappeared. A mounted Dashboard test
reproduced both cards vanishing after 300001ms. The guide now sets `gcTime` to
Infinity for its isolated query client, retaining sample data for the document
lifetime without refresh polling. The test passed with the correction and the
full guide suite passed all 22 tests (`CACHE_FIX_GREEN`). Production code is
unchanged. Earlier successful room-expiry probes remain valid.

Josh's revised material requirement is now recorded in the root contract,
DESIGN.md, guide prose, and guide ownership: background colors must not alter
information-bearing surface colors anywhere, including platform-specific cards.
Neutral sheen may vary, and decorative chrome such as the sidebar may retain
ambient color. This does not itself ban intentional platform styling. The
current implementation gap is explicitly pending the owning app task's verified
correction. No preview-only CSS conceals it. The one approved narrow Dashboard
screenshot remains unused, reserved for the integrated required app fix.

Current dependency remains PR315 at `d71f92b`; the app task is preparing separate
required material and bounded image-recovery corrections. Its installed Mac
receipt is coordinator-reported, not independently inspected by this task.
No further app packaging or installation is authorized. Weekly Codex usage was
31% used / 69% remaining at this checkpoint; usage is shared across tasks.

The cache correction is committed at `668129c`. Fresh Sol/high focused review
completed inside its 180-second deadline with no actionable finding and verified
artifact hash `bb8f2c0e411dbb9c2f3b2a5cc2631af11e98cf8e02ef512b9a450e7e582738e8`.
Observed runtime metadata confirms read-only sandbox and approval never. It
retains the earlier general conclusions for this bounded delta. The driver
inspected the full result, matching hash, and empirical logs. This remains a
same-lineage review, with no independent model confirmation claimed.
The complete local gate passed `OVERNIGHT_GATE_GREEN`: uncached lint, formatting,
application build/typechecks, guide build/typecheck, all 22 guide tests, and diff
check. Fallow's seven findings exactly match the prior baseline, and there are
no guide clone groups. No new callable API was added, so INTERNAL-API is
intentionally unchanged for this correction; the existing VRX-273 changelog
entry already covers the unreleased guide rebuild.

A fresh in-app browser load had two Popular cards at 12:12:20 UTC and still had
two after 12:17:24 UTC, with no error logs. The page was not reloaded between
those observations. The narrow wrapper scrolled from 0 to 224px and back while
the page stayed at horizontal scroll 0. Authenticator and email-code scenarios
rendered their respective copy. Submitting invented credentials returned the
real secure-store failure message through the synthetic bridge. The viewport
was reset, and the guide tab remains available. The final approved screenshot
is still unused. The personal design-iterate skill now records the demonstrated
preview-watcher/rebase and lazy-frame observation traps; its validator passed.

## Required material integration

The documentation branch was published at `7caf179` in draft PR316, initially
stacked on PR315. Linear VRX-273 is In Review. CI/CodeQL have no workflow_dispatch
trigger and only run for pull requests targeting main; no run was created for
that initial stack. CodeRabbit skipped the draft, which is not substantive review.
The coordinator subsequently authorized retargeting the existing draft to main
once both required fixes form one coherent source baseline, retaining explicit
dependency and docs-only review references. Do not flip the base back merely to
reuse checks from another state. Keep the candidate draft and unmerged.

Required material fix VRX-276 is published in PR317 at
`c77b867222ae50c85468aa1fee7a2e1881dc9313`, based on the heading fix d71f92b.
The driver inspected its actual source diff. It adds the opaque neutral
`--glass-information` base under informational gradients, preserves the platform
image gradients, and applies the backing to the existing information containers.
Source-owner PR evidence reports full tests, native computed-material probes
across both themes/glow settings, mutation failure when made transparent, and
fresh Astra/high review. Those are source-owner reports, not a new screenshot or
installed-app acceptance by this task.

The guide preview watcher was stopped before rebasing. Recovery branch
`imperix/vrx-273-before-material-sync-20260916` retains the published head.
Nine docs commits were rebased onto c77b867. The three expected old-design-page
conflicts retained the rewritten Markdown and module HTML entries; all guide
files were byte-identical after replay. Upstream changelog and renderer contract
additions are preserved. The docs-only diff contains no production source edits.
The driver then reconciled the new information-backing class/token and tint
composition rule into the concise contract and human guide. Current-source prose
replaces the earlier pending-fix note without claiming installed-app acceptance.

Rebased mapping: 57de189→0d0030e, 9dafe8d→9677e64, 86ccfed→28f7af1,
bb1e50d→0c280d8, ce9c6f4→2f83053, 3692502→912b4f1, 64492f6→3805cdc,
668129c→479e9db, 7caf179→73361bb. Existing immutable review evidence remains
valid for the unchanged guide code. Image recovery remains with its owning task;
its worktree is now based on c77b867, providing the intended integration sequence.
The reserved final screenshot will follow that required source integration.
