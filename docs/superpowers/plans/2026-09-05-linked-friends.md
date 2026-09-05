# Linked friends implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship the approved two-account linked-person roster, drawer, notes and identity-management flow without changing real platform accounts.

**Architecture:** Keep adapters and account notes account-specific. A main-owned, versioned link-profile document owns relationships, preferences and shared notes in one atomic transaction. A pure renderer projection supplies combined or account rows; explicit profile selection stays independent of incoming presence.

**Tech Stack:** Existing Electron, React, strict TypeScript, Zustand, TanStack Query, Vitest and design tokens. No new remote service or presence polling.

**Spec:** [Consolidated design brief](../specs/2026-09-05-linked-friends-design-brief.md), plus the [detailed approved decision ledger](../specs/2026-09-04-linked-profile-notes-navigation.md).

## Global constraints

- Production execution is not authorized by this planning document. Review the brief and proposed safeguards before starting.
- First release: one VRChat main and one ChilloutVR main. No alternate-account UI or migration-free-alts promise.
- Links are manual, private and local. Never infer a relationship from matching names.
- Preserve account-qualified identity: platform, signed-in platform account ID, friend ID.
- Three note owners, one editor visible. Never merge or delete original account notes.
- Shared notes are deleted only by the confirmed unlink/replacement scope. Cancel or failed pre-commit work leaves old state intact.
- In-game outranks online-only, which outranks offline; preferred platform breaks ties.
- The mixed in-game/online-only exception creates two rows but one person in All.
- Platform filters select account data; they do not unlink or borrow the other platform's presence.
- Preserve the existing 500-character note limit, save-on-blur, retained draft and explicit Retry behavior.
- Do not add favorites, tags, Explore, Dashboard discovery, exports, notifications, API polling or release packaging.
- Retain context isolation, sandbox, trusted-sender guards, allowlisted launches and main-owned join targets.
- Preserve exact approved geometry and tokens, both themes, localization and non-color labels.

---

## Baseline and file ownership

Verified planning checkout: `imperix/vrx-270-explore-design`, commit `7bbcc21`.
No open PRs were returned by GitHub on September 5. This checkout has design
edits and untracked local mock assets. An older linking worktree exists at
`/private/tmp/vrx-143-link-graph`; do not overwrite or repurpose it automatically.

Start execution from the current protected default branch in a new worktree
using `superpowers:using-git-worktrees`, on an owner-contract branch such as
`imperix/vrx-143-linked-friends-ui`. Re-read state and bring only the reviewed
brief/plan/ledger commits into that branch. Do not bring unrelated Explore work.
Do not copy captured friend artwork or `.superpowers` into a public PR.

Read `AGENTS.md`, `src/shared/AGENTS.md`, `src/main/AGENTS.md`,
`src/main/ipc/AGENTS.md`, `src/renderer/AGENTS.md`, `docs/INTERNAL-API.md`,
`docs/DESIGN.md`, `docs/design.html`, and `docs/glass.html` before their tasks.
Read any newly discovered nearer contract before editing.

| Responsibility                   | Existing files                                                                      | Proposed focused additions                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Link persistence                 | `src/main/services/linkGraphStore.ts`, its test                                     | `linkProfileStorage.ts`, its test in the same directory                                              |
| Shared contract                  | `src/shared/types.ts`, `src/shared/ipc.ts`                                          | `src/shared/linkedProfiles.ts`                                                                       |
| Session-scoped link access       | `src/main/app.ts`, `src/main/ipc/index.ts`, `rate-limit.ts`, `src/preload/index.ts` | `src/main/ipc/links.ts`, `links.test.ts`                                                             |
| Projection                       | `src/renderer/src/queries/friends.ts`, `FriendsList.tsx`                            | `utils/projectLinkedFriends.ts`, its test; `queries/linkedProfiles.ts`                               |
| Drawer selection and notes       | `FriendDrawer.tsx`, `hooks/useFriendNote.ts`                                        | `hooks/usePersonNote.ts`, `stores/profileSelection.ts`                                               |
| Identity and destination dialogs | `FriendDrawer.tsx`, `hooks/useJoinInstance.ts`                                      | `components/IdentitiesDialog.tsx`, `LinkConfirmDialog.tsx`, `LinkedDestinationChooser.tsx` and tests |
| Interaction retention            | `FriendsList.tsx` virtualizer and focus code                                        | `hooks/useStableLinkedRows.ts` and test                                                              |
| Design/documentation             | `assets/main.css`, both translations, three design docs, API catalog, changelog     | no unrelated restructuring                                                                           |

All renderer paths in this table are below `src/renderer/src/` unless fully
qualified. Keep shared-file integration and persistence changes with the driver.
Read-only investigation and disjoint component tests may be delegated. Do not
parallelize edits to types, FriendsList, FriendDrawer or the persistence document.

## Task 1: Transactional link profiles and migration

**Files:** Modify `src/shared/types.ts`, `src/main/services/linkGraphStore.ts`,
`src/main/services/linkGraphStore.test.ts`. Create `src/shared/linkedProfiles.ts`,
`src/main/services/linkProfileStorage.ts`, `src/main/services/linkProfileStorage.test.ts`.

**Interfaces:** Keep `LinkedPersonMember` unchanged. Define the following pure
contract in `linkedProfiles.ts`; use it consistently in later tasks.

```ts
import type { LinkedPersonMember, Platform } from './types'
export interface LinkedProfile {
  id: string
  members: [LinkedPersonMember, LinkedPersonMember]
  customName: string | null
  defaultName: string
  preferredPlatform: Platform
  pictureMode: 'preferred' | 'merged'
  sharedNote: string
  revision: number
}
export interface LinkProfileFile {
  storeFormatVersion: 2
  revision: number
  people: Record<string, LinkedProfile>
}
export type LinkChange =
  | {
      kind: 'replace'
      members: [LinkedPersonMember, LinkedPersonMember]
      preferredPlatform: Platform
      defaultName: string
      expectedPeople: Array<{ id: string; revision: number }>
    }
  | { kind: 'unlink'; personId: string; expectedRevision: number }
  | {
      kind: 'update'
      personId: string
      expectedRevision: number
      patch: Partial<
        Pick<
          LinkedProfile,
          'customName' | 'defaultName' | 'preferredPlatform' | 'pictureMode' | 'sharedNote'
        >
      >
    }
export type LinkFailure = 'invalid' | 'stale' | 'unavailable' | 'storage' | 'rate-limited'
export type LinkResult<T> = { ok: true; value: T } | { ok: false; reason: LinkFailure }
```

`defaultName` is the last approved/resolved preferred name, used when current
preferred-account data is unavailable. Refresh it only from the correctly scoped
account, never from presence-selected names. `customName: null` means automatic;
the empty string is not a valid custom name. Names retain the existing 256-character
graph bound. Shared notes use the existing 500-character policy.

- [ ] Add failing store tests using the existing injectable storage pattern.
      The transaction method will be `apply(change: LinkChange): LinkedProfile | null`.
      Use deterministic fixture IDs and reuse current account-scope fixtures.

```ts
it('keeps the old pair and note when replacement cannot commit', () => {
  const before = structuredClone(storage.read())
  storage.write = () => {
    throw new Error('fixture write failure')
  }
  expect(() => graph.apply(replacement)).toThrow()
  expect(storage.read()).toEqual(before)
})
it('rejects a confirmation whose shared note changed', () => {
  const reviewed = graph.list()[0]
  graph.apply({
    kind: 'update',
    personId: reviewed.id,
    expectedRevision: reviewed.revision,
    patch: { sharedNote: 'new text' }
  })
  expect(() =>
    graph.apply({ kind: 'unlink', personId: reviewed.id, expectedRevision: reviewed.revision })
  ).toThrow(/stale/)
})
```

In these tests `storage` and `graph` are the existing in-memory storage and
`LinkGraphStore` fixture; `replacement` is a `LinkChange` joining two qualified
members from different existing fixture pairs with both current revisions.
Construct those pairs through the existing `link` fixture helper before each test.
Also assert both unselected members become unlinked, no account-note API runs,
repeated same-pair linking is a no-op, and future-format data is never written.

- [ ] Run `npm test -- src/main/services/linkGraphStore.test.ts` and witness the
      new cases fail before implementation.
- [ ] Implement transition as validate, reload, compare all affected members and
      revisions, construct detached next document, then persist once. Keep the existing
      exact-own-data-descriptor validation, dangerous-key checks, limits and reentrancy
      protection. Never implement replacement as `unlink(); unlink(); link()`.

```ts
// Inside the existing guarded operation, after validation and revision checks:
const next = structuredClone(currentFile)
for (const id of confirmedOldIds) delete next.people[id]
next.people[newProfile.id] = newProfile // sharedNote is always '' for replacement
next.revision += 1
storage.write(next) // one commit point; publish only after durable success
```

`currentFile` is the freshly validated file; `confirmedOldIds` must exactly match
the owners currently found for the two selected members; `newProfile` is created
from the validated command with a fresh ID and revision 1. Same-pair no-op precedes
ID generation. Updates increment the person's revision as well as file revision.

- [ ] Migrate v1 only after complete validation. Preserve member order and IDs;
      `displayName` becomes `customName`; first member supplies initial preference;
      shared note starts blank; picture mode is preferred. Until a correctly scoped
      friend supplies its name, use the stored custom name or an empty default-name
      sentinel, displayed with the existing unknown-name fallback. Never derive names
      from friend IDs. Persist v2 once, retaining original bytes as a migration backup
      in app userData. Failed migration leaves v1 usable and untouched. Do not write a
      downgraded document when opening a newer version.
- [ ] Implement strict storage in `linkProfileStorage.ts` with same-directory
      temporary file, exclusive creation, file sync, atomic rename, cleanup of only
      its own temporary file, and no truncate/write-in-place fallback. Use
      `app.getPath('userData')`; preserve the `link-graph.json` location. Inspect the
      installed writer first: current `conf` falls back to non-atomic writes on EXDEV,
      so using `electron-store` unchanged does not establish this guarantee. On rename
      failure return storage failure with old file intact. After rename, do not report
      a rollback-safe failure for a later cleanup error. Read back an ambiguous commit
      and report its actual revision rather than blindly replaying a destructive command.
- [ ] Add real temporary-directory tests for restart, failed rename, truncated
      input, unknown future version and v1 migration. Inject failure before commit,
      never use the owner's userData. Run both store suites. Remove the CAS check and
      verify the stale-confirmation test fails, then restore it.
- [ ] Checkpoint with `feat(vrx-143): add transactional linked profiles` after
      focused tests and diff inspection. This unit is high-risk persistence work and
      cannot be merged based on mock tests.

## Task 2: Scoped IPC and renderer link snapshots

**Files:** Create `src/main/ipc/links.ts`, `links.test.ts`,
`src/renderer/src/queries/linkedProfiles.ts` and its test. Modify
`src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/app.ts`,
`src/main/ipc/index.ts`, `rate-limit.ts`, and their contract tests.

**Interfaces:** `registerLinksHandlers({accountSession, linkGraph})`; bridge
`getLinkedProfiles()`, `changeLinkedProfile(req)` and `onLinkedProfilesChanged(cb)`.
Use the task-one contract. Main, not renderer, qualifies selected friend refs.

```ts
type FriendRef = { platform: Platform; friendId: string }
type LinkRequest =
  | {
      kind: 'replace'
      members: [FriendRef, FriendRef]
      preferredPlatform: Platform
      defaultName: string
      expectedPeople: Array<{ id: string; revision: number }>
    }
  | Extract<LinkChange, { kind: 'unlink' | 'update' }>
type LinkSnapshot = { profiles: LinkedProfile[]; lease: string }
// IpcInvoke additions:
// 'get-linked-profiles': { req: void; res: LinkResult<LinkSnapshot> }
// 'change-linked-profile': { req: { lease: string; change: LinkRequest };
//   res: LinkResult<LinkSnapshot> }
// IpcEvents addition: 'linked-profiles-changed': void
```

Define `FriendRef`, `LinkRequest` and `LinkSnapshot` in `linkedProfiles.ts`.
A main-issued lease binds the renderer snapshot to current account identities
and epochs. It is a stale-context guard, not a platform token. Do not expose
credentials. Bound lease retention to the current session and replace it on
identity boundaries, rather than accumulating one record per read.

- [ ] Write tests for untrusted sender, forged member scope, malformed IDs,
      session switch between read/confirm, same friend ID under different local
      accounts, link with missing platform login, and unlink with one healthy side.
      Assertions must include unchanged durable bytes after every rejection.

```ts
expect(await invokeChange(oldLease, change)).toEqual({ ok: false, reason: 'stale' })
expect(storage.read()).toEqual(before)
expect(untrustedCall).toThrow('Untrusted IPC sender')
```

`invokeChange` invokes the captured registered handler in `links.test.ts`;
`oldLease` is returned before `accountSession.setIdentity` changes the account.

- [ ] Register trusted-sender-first handlers and central local IPC budgets:
      reads 90/minute, changes 60/minute, matching account-note pacing. These are
      local IPC limits and must cause no additional platform API requests.
- [ ] Expose only profiles anchored to at least one currently authenticated
      matching member. Keep the other member's reference for the quiet unavailable
      entry, but never hydrate its account details from a different signed-in user.
      Creating/replacing requires both selected account scopes ready. Updating or
      unlinking an existing profile requires a current matching anchor and valid lease.
      Both platforms logged out exposes no profiles or shared notes, but deletes none.
- [ ] Instantiate the store once in main, connect IPC, emit invalidation after
      successful changes, and clear/reload renderer link queries on identity boundaries.
      Do not persist shared notes in the friend-cache namespace. Handle `storage`,
      `stale`, `unavailable` and `rate-limited` without raw exceptions or automatic retry
      of destructive changes.
- [ ] Run `npm test -- src/main/ipc/links.test.ts src/main/ipc/index.test.ts src/main/ipc/rate-limit.test.ts src/renderer/src/queries/linkedProfiles.test.ts`.
      Check preload and IPC enumeration tests, update `docs/INTERNAL-API.md`, then
      checkpoint `feat(vrx-143): expose scoped linked profile operations`.

## Task 3: Pure roster projection, counts and alias search

**Files:** Create `src/renderer/src/utils/projectLinkedFriends.ts` and its test.
Modify `FriendsList.tsx` only after pure behavior is green. Leave adapter output,
`queries/friends.ts`'s raw caches and Dashboard consumers account-shaped.

**Interfaces:**

```ts
type ProfileTarget =
  | { kind: 'person'; personId: string; anchor: FriendRef }
  | { kind: 'account'; account: FriendRef; personId: string | null }
type LinkedRow = {
  key: string
  personKey: string
  target: ProfileTarget
  accounts: Friend[]
  name: string
  section: FriendSection
  platformMark: Platform | 'vrx'
}
type ProjectionInput = {
  friends: Friend[]
  profiles: LinkedProfile[]
  accountIds: Partial<Record<Platform, string>>
  filter: 'all' | Platform
  search: string
}
type Projection = { rows: LinkedRow[]; personCount: number; onlinePeople: number }
// projectLinkedFriends(input: ProjectionInput): Projection
```

Export these renderer types from `projectLinkedFriends.ts`; import existing
`Friend`, `FriendSection`, `Platform`, `FriendRef`, `LinkedProfile` types.
Never resolve membership without a matching `accountIds` entry. Missing data
is not a synthetic offline Friend.

- [ ] Write a table test for every 3-by-3 presence pair, each filter, with both
      preference directions. Include mixed sections, both offline, one missing
      platform, same display names on unrelated accounts, aliases and custom names.

```ts
expect(projectLinkedFriends(mixedFixture).rows.map((r) => r.section)).toEqual(['in-game', 'online'])
expect(projectLinkedFriends(mixedFixture).personCount).toBe(1)
expect(projectLinkedFriends({ ...mixedFixture, filter: 'vrchat' }).rows[0].accounts).toEqual([
  vrcOnlineFixture
])
```

Build `mixedFixture` with one valid LinkedProfile, a scoped CVR in-game Friend
and `vrcOnlineFixture` from the existing `test-utils/friendFixture.ts` helper.

- [ ] Implement indexing by qualified member, alias matching, row projection,
      stable keys and unique-person sets. Person key is the graph ID for linked
      accounts; otherwise qualified account identity. Combined row key uses person ID;
      split row key adds its member identity. Sort by existing section order and
      name comparator. Keep both online-only combined in Online. One online-only and
      one offline stays combined with the active platform mark. Never emit "2 locations"
      merely because two accounts are online.
- [ ] Feed projected rows into the existing virtual row stream. Keep raw friends
      separately for account actions and aliases. Maintain existing search debounce,
      row density setting, roving focus and account connection gate.
- [ ] Run projection, `FriendsList.search`, `FriendsList.sections` and
      `FriendsList.virtualization` tests. Assert the total is not the sum of section
      entries. Checkpoint `feat(vrx-143): project linked people in the friends roster`.

## Task 4: Profile navigation and independently owned notes

**Files:** Create `stores/profileSelection.ts`, `hooks/usePersonNote.ts` and their
tests. Modify `FriendDrawer.tsx`, `FriendsList.tsx`; preserve existing
`useFriendNote.ts` behavior and tests.

**Interfaces:** Selection stores `ProfileTarget | null`, never a live Friend
object or current virtual-row index. `usePersonNote(personId: string|null)`
returns the same editor-facing `value`, `onChange`, `onBlur`, `retry`, loading and
error contract used by the existing note editor. Shared writes call task-two IPC
with person revision and lease. Account writes keep the existing hook and lease.

- [ ] Write tests that edit each of three notes, navigate through both routes,
      return, reload, and verify the other two notes are unchanged. Delay save replies
      until after switching view; verify no reply or queued save targets the new owner.

```ts
const editor = screen.getByRole('textbox', { name: /shared notes/i })
fireEvent.change(editor, { target: { value: 'shared draft' } })
publishPresenceEvent(cvrOfflineEvent)
expect(screen.getByRole('textbox', { name: /shared notes/i })).toBe(editor)
expect(editor).toHaveValue('shared draft')
```

Use existing FriendDrawer test bridge mocks for `publishPresenceEvent` and the
fixture event. Add retained selection/caret assertions in the runtime probe.

- [ ] Keep the note component mounted across same-owner live changes. Separate
      derived presence from selected target. Resolve account/shared owner explicitly;
      never key the editor by preferred platform or latest header source. Preserve
      save-on-blur, failed-load protection, retained draft and explicit Retry.
- [ ] Add platform shortcuts, bottom-left Identities and Back to combined.
      Preserve the existing non-modal drawer and outside-click, Escape and opener
      focus restoration contracts. Retain selected target when its roster row changes
      section, while re-resolving availability for display and actions.
- [ ] Run `useFriendNote.test.tsx`, its HMR contract, new shared-note tests and
      `FriendDrawer.test.tsx`. Checkpoint `feat(vrx-143): add linked profile navigation and shared notes`.

## Task 5: Identity management and explicit destructive confirmations

**Files:** Add `components/IdentitiesDialog.tsx`, `LinkConfirmDialog.tsx` and their
tests; wire through `FriendDrawer.tsx`. Add English/Japanese translation keys.

**Interfaces:** Identities consumes the selected ProfileTarget and scoped
LinkSnapshot, opens an account target through `profileSelection`, and sends
LinkRequest commands. LinkConfirmDialog consumes the exact affected profiles and
their revisions, plus selected FriendRefs and preferred platform.

- [ ] Copy reviewed text from the preserved prototype, without its sample names,
      browser-storage claims or demo labels. Test offline candidates, duplicate names,
      no matches, already-linked same pair, single conflict and double conflict.
      Confirmation must enumerate both old pairs and unselected accounts when needed.
- [ ] Implement link picker and preferred-platform selection. Preview name changes
      before confirming. Custom name is local-only; explicit "Use platform name"
      clears custom mode. Preferred platform never overwrites a custom name.
- [ ] Gate destructive confirmation with the reviewed acknowledgement. A stale
      revision returns to review without applying changes. Cancel closes with no
      mutation. Failure retains the current flow and displays a concise retryable
      error. Prevent duplicate submission while pending.

```ts
expect(screen.getByRole('button', { name: /replace and link/i })).toBeDisabled()
await user.click(screen.getByRole('checkbox', { name: /permanently deleted/i }))
await user.click(screen.getByRole('button', { name: /replace and link/i }))
expect(changeLinkedProfile).toHaveBeenCalledTimes(1)
```

`user` is the suite's interaction helper; if the repository does not include
user-event, use its existing Testing Library `fireEvent` helpers instead of
adding a dependency just for this test. Mock the bridge with the typed task-two
signature. Assert rejected writes preserve fixture snapshots.

- [ ] Do not offer new links against an unavailable selected platform. Keep
      existing unavailable identities listed and allow confirmed unlink through a
      healthy authenticated member. Account switches invalidate the open confirmation.
- [ ] Run dialog tests, note isolation tests, localization parity and IPC tests.
      Checkpoint `feat(vrx-143): add identity management and link confirmations`.

## Task 6: Approved visuals and one safe destination chooser

**Files:** Modify `FriendsList.tsx`, `FriendDrawer.tsx`, `assets/main.css`.
Create `components/LinkedDestinationChooser.tsx` and tests. Reuse `InstancePill`,
`PolicySpacePill`, `Avatar`, `instancePillFor`, `policySpaceFor`, `ringFor`,
`isWorldHidden` and `isFriendJoinable`. Keep `useJoinInstance` as final action owner.

**Interfaces:** `LinkedDestinationChooser({ accounts, onClose })` accepts current
account Friends; the reviewed target snapshot is captured when opening. A chosen
Friend is passed into the existing `join` function, preserving current confirmation,
mode choice, feature setting, cooldown, failure text and main target CAS.

- [ ] Write chooser tests for zero, one and two eligible destinations; one hidden;
      one disconnected; location moved after opening; joining disabled; and one side
      failing without blocking the other. Both entry points invoke the same chooser.

```ts
expect(joinInstance).not.toHaveBeenCalled()
publishPresenceEvent(targetMovedEvent)
fireEvent.click(screen.getByRole('button', { name: /join on vrchat/i }))
expect(joinInstance).not.toHaveBeenCalled()
```

Fixture names above are scoped to the existing join test setup. Capture
worldId/instanceId when the choice is displayed, compare again on activation,
then rely on main's `expectedTarget` check. Do not substitute a fresh destination
for the one the user selected. Do not add an automatic preferred-platform join.

- [ ] Add tokens for approved combined rail, name caps and overlays. Preserve
      physical margins on vertical text, both density settings, existing label scheme,
      image fallback and separate status semantics. Do not hardcode fixture purple/
      green across all instance types. Match exact geometry from the brief.
- [ ] Add single/split image overlays, platform outlines, muted bottom trust,
      gradient-outline Identities, merged avatar preference and attributed status.
      Keep rule context in the Join flow. Keep single-world pill top right on both
      platforms. Use a neutral, clearly labeled hidden placeholder, not old art.
- [ ] Runtime probes cover dark/light, grayscale, 520px row, long names, missing
      artwork and all presence/filter fixtures. Assert 60px compact height, the 14px
      corner offsets, note ownership, and no layout overflow. Obtain one-time screen
      capture approval for each actual user window; use a disposable seeded Electron
      instance for automated DOM checks without touching real accounts.
- [ ] Run chooser, roster join and drawer tests, then checkpoint
      `feat(vrx-143): render linked profiles and destination choices`.

## Task 7: Live transition stability and completion gates

**Files:** Add `hooks/useStableLinkedRows.ts` and tests; integrate in
`FriendsList.tsx`. Update `docs/DESIGN.md`, `docs/design.html`, `docs/glass.html`,
`docs/INTERNAL-API.md`, `CHANGELOG.md`, translations and closest affected contracts.

**Interfaces:** `useStableLinkedRows(rows: LinkedRow[])` returns displayed rows
and pointer/focus interaction handlers. Store stable identity keys, never row
indices. Safety data is read from current raw friends, not delayed placement data.

- [ ] Use fake timers to test the proposed five-second maximum deferral, release
      on pointer/focus exit, combined-to-split transitions, filter changes, deleted
      links and virtual-window movement. Keep editor identity independent of this hook.

```ts
vi.useFakeTimers()
holdRow('person:fixture')
publishPresenceEvent(mixedPresenceEvent)
expect(currentRowOrder()).toEqual(before)
expect(staleJoinButton()).toBeDisabled()
vi.advanceTimersByTime(5000)
expect(currentRowOrder()).toEqual(expectedMixedOrder)
```

Implement the test helpers with the rendered hook/component fixture; they
observe actual DOM order and disabled action, not a second copy of the algorithm.

- [ ] Preserve nodes and roving focus while only payloads change. If a structural
      update must apply at the deadline, restore to the matching account/person opener;
      if none remains, use search. Never let a pointerdown on an old target activate a
      new target after reorder. Require a fresh pointer gesture when identity changed
      between pointerdown and click. Section/overall counts update from unique people.
- [ ] Add integration tests for every critical transition: notes open during
      change, chooser open during move/privacy loss, logout/relogin/switch, pending
      confirmation then shared-note edit, failed replacement, restart and migration.
      Verify unlinked Friends, Dashboard hot instances, alerts, settings and joining
      remain unchanged. Do not project combined synthetic friends into their caches.
- [ ] Complete the DOX matrix. API-volatility/policy docs stay unchanged if no
      adapter assumptions or network behavior changed; say so. Do not import sample
      friend screenshots into public design guides.
- [ ] Run focused tests, full suite, then the required gate without masking exits:

```sh
npm test
npm run typecheck && npm run lint && npm run format:check && npm run build && echo LINKED_FRIENDS_GATE_GREEN
```

Read the sentinel and exit code. Run `verify-electron` for actual renderer
behavior, `review-loop` on the exact PR diff, including dead code and duplicate
checks, then fix functional findings and rerun applicable gates.

- [ ] Update Linear linking issue, open a feature PR, wait for final-head CI and
      substantive CodeRabbit/Greptile findings. Preserve exact review anchors. Leave
      the PR open without explicit merge authority. No release is part of this plan.

## Overnight execution handoff

Owner clarification after plan delivery: the upcoming overnight block is
**linking only**. Do not roll into Explore or its Dashboard preview, even if
linking finishes early. The owner intends to use GPT-6 Astra and wants a bounded
first run because its usage for this work is not yet known. This records the
intended model, not a model switch or a started task. Check usage before launch,
checkpoint after each unit, and decide execution approach with the owner after
plan review. Preparing Explore's separate plan is authorized; implementing it
in the linking overnight block is not.

Recommended first block completes Tasks 1–3 with verified checkpoints before
attempting UI integration. The whole feature may require more than one night;
do not trade migration, account isolation or note safety for an overnight promise.
If time/headroom remains and authority covers the reviewed full plan, proceed
in order through Tasks 4–7. Check usage before sizing the block.

Authority currently permits this planning and local mock work only. Before a
run, record explicit approved implementation scope and stop condition. Normal
feature-branch commits, pushes, PRs and tracker updates may follow an implementation
grant under the standing contract. Merge, release, real-account tests, deleting
real notes, and unattended screen capture are not granted by that permission.

Stop for any new product choice, failing migration guarantee, unresolved session
isolation, unavailable review gate, or exhausted usage. Save exact completed and
unstarted tasks, test results, branch/head, dirty files, worker state and next safe
action. Do not call a partial build complete. Leave the existing local mock server
available for the owner unless they ask otherwise.

## Self-review and coverage

| Requirement                                                   | Tasks      |
| ------------------------------------------------------------- | ---------- |
| Scoped link identity, migration, atomic replacement, failures | 1, 2       |
| Single-platform use, unavailable member, session changes      | 2, 3, 5, 7 |
| Preferred/default/custom naming, merged picture               | 1, 3, 5, 6 |
| Counts, filters, mixed-state rows, aliases                    | 3, 7       |
| Three notes, navigation, unlink loss acknowledgement          | 1, 4, 5    |
| Existing visual geometry and semantic colors                  | 6          |
| Safe shared Join chooser, privacy, stale target               | 6, 7       |
| Live editor and roster stability, focus                       | 4, 7       |
| Localization, design docs, tests, review and handoff          | 5, 6, 7    |

The owner delegated the strict atomic writer and migration approach to Codex's
technical judgment. The five-second placement deferral and fallback focus remain
review proposals. Production execution still needs approval after plan review.
No production implementation is complete merely because this plan is written.
