# VRX-273 design-guide rebuild

## Status and authority

Kickoff verified on September 15, 2026. Josh then explicitly authorized the
complete rewrite in this task, superseding the kickoff-only stopping point.
Implementation is now in progress. The human HTML guide will show real
components; the agent-native Markdown will contain concise operational rules,
source references, states, constraints, and verification guidance.
It does not grant permission to merge, install an app, publish a release, or
perform account actions.

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

The localhost server serves `http://127.0.0.1:4173/design.html` on port 4173.
No rendered verification has occurred. One-time approval for the first capture
of that exact page in the Codex in-app browser is still pending. The preview
open request was queued, which is not evidence of a visible or inspected page.
No capture, real-account action, app installation, or merge occurred.

Josh specifically requires meticulous verification using the Codex in-app
browser and computer use, across themes, widths, and interactive states. Do not
substitute source tests, a served preview, another browser, or a successful build.
The next required step is that consented browser inspection, followed by any
corrections, final review coverage, and PR delivery. The docs branch remains
based on PR315 head `154385f49a9154831ae9eab1179a7c58d8d3b3c6`.
