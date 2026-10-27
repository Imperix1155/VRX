# src/renderer

## Purpose

The sandboxed React and Tailwind UI. It presents main-process data and calls
the typed preload bridge. It never gains Electron, Node, credential, network,
or launch authority.

## Ownership

- `index.html` holds the shipped CSP. `src/App.tsx` owns the settings
  hydration gate, the welcome-setup gate (`components/setup`, before the shell
  and login), the auth gate, and the app-wide subscriptions it mounts once
  (`useLiveFriendEvents`, `useLinkedProfileEvents`, `useActivityEvents`,
  dashboard navigation).
- `src/components`, `hooks`, `queries` (TanStack Query), `stores` (Zustand),
  `utils` (pure helpers), `i18n` with `locales/en` and `locales/ja`, and
  `assets` (`main.css` tokens, local fonts).
- Look up symbols in [`docs/INTERNAL-API.md`](../../docs/INTERNAL-API.md).

## Local Contracts

**Boundary**

- Use `window.vrx` and `@shared/ipc` types. Do not duplicate channel types,
  bypass the bridge, treat opaque references as IDs or URLs, or expect
  main-only cooldown, session, or error detail.
- The CSP is `style-src 'self'` with no `unsafe-inline`. React `style={}` is
  allowed; `<style>` elements, `setAttribute('style', …)`, `cssText`,
  `dangerouslySetInnerHTML`, and `innerHTML` are not
  (`scripts/dev-style-csp.test.ts`).
- DOM images are main-issued `data:` URLs with neutral fallbacks. Fonts are
  local, with their licenses and `SOURCES.json`; never load remote fonts.

**Boot and auth**

- Show `BootSplash` until settings hydrate, then notify main once. A platform
  in `authenticated` or `error` state, or a failed auth query, enters the
  shell; pending auth keeps the splash, so login never flashes over a restored
  session.
- The login screen remounts its form per platform tab and locks the tabs while
  submitting. `CREDENTIAL_PERSISTENCE_FAILED` and the two sign-in-from-this-PC
  results (per platform, `importErrorKey`) get dedicated copy. A
  `sessionCleared` result sets known unauthenticated state.
- Auth status is invalidation-driven: a page mounting never re-checks it,
  because a VRChat check is a real API request. The only interval re-checks an
  `error` status once a minute (`AUTH_ERROR_RECHECK_MS`).
- While `setupPending` is true the welcome setup replaces the shell and login.
  Only Hot Instances, Activity and Explore can be hidden (`isPageShown`); a hidden
  active page falls back to the Dashboard.

**State**

- TanStack Query owns server and cache state. Zustand holds view state and the
  hydrated settings snapshot; stores never import each other. Do not add server
  data to a store (the accounts store is an existing exception).
- App-wide pushes reach the cache only through the hooks `App` mounts. A
  component may subscribe only to clean up its own local state.
- Only the `friends` namespace persists (`queries/cache.ts`): validated, 24 h
  maximum age, keyed to the app version and `CACHE_SCHEMA_VERSION`. Bump that
  version when the persisted shape changes. Images and notes never persist.

**Friends rosters**

- `useFriends` runs only while auth is `authenticated` or `error`. The
  reconcile cadence comes from settings, with jitter; WebSocket events are the
  live path. An absent cache differs from a known empty roster. A partial
  roster keeps cached omissions; only a complete roster makes an absence
  authoritative. `mergeKnownInstanceMetadata` fills missing world or group
  metadata only for the same world or group; fresh values win.
- VRChat deltas journal on the pending IPC transport (`friendEventReplay.ts`),
  shared across query cancellation because main coalesces reads. They replay in
  structural sharing before publication, never in a key-only success listener,
  comparing each event's `rosterRevision` with its row's physical-read
  provenance. Malformed provenance is a refresh error: partial `coveredIds`
  must equal the unique returned IDs and override IDs must be returned rows.
  Rejection keeps the prior cache and fences.
- One bounded fence per query client also orders late pushes. Partial coverage
  merges listed IDs only; complete snapshots replace all fences. Accumulation
  beyond twice `MAX_FRIENDS` is rejected without evicting evidence. Account
  boundaries discard transports and fences. CVR snapshot replay is separate.
- Combined Friends state ignores disabled platforms for pending, error,
  fetching, and refresh, and keeps memoized array identity.

**Account-bound data**

- Friend, linked-profile, Explore, and note queries cancel old work and clear
  data and fences at identity or auth boundaries. An old reply never publishes
  under the replacement account.
- `projectLinkedFriends` projects only qualified people; raw friend caches stay
  account-scoped. Linked snapshots keep the newest `storeRevision` within a
  lease, and main-owned `accountIds` keep ownership through transient auth
  errors. Shared person notes are installation-global. Drafts stay in memory,
  saves are serialized and retried only explicitly, and requests never choose
  note or account ownership.

**Join and Explore**

- `useJoinInstance` and `JoinConfirmDialog` own the one join flow for friends,
  hot instances, and Explore. The renderer sends a friend ID with the reviewed
  target, or an opaque `selectionRef`; main decides and launches. Failure
  feedback stays until another attempt or an account boundary. Retries reuse
  the flow and never run automatically.
- Explore and the Dashboard preview share ranking, selection, and the
  non-modal sheet. `useExploreCoordinator` is the only discovery trigger:
  visibility, focus, and connectivity wakes, gated by account and platform. No
  polling; timers serve only local freshness and typed image deferrals.
- Explore reads, selection, and images are fenced by generation, account,
  close, and reference identity. A loading world sheet waits for
  `explore-changed` and a cache-only reread. A manual open or refresh may
  recover one expired reference. Only typed image deferrals retry, within a
  bound. Sheets distinguish incomplete coverage, verified emptiness, stale
  data, and typed denials.

**Design and accessibility**

- Follow [`docs/DESIGN.md`](../../docs/DESIGN.md): tokens only, dark and light
  parity, information panels independent of ambient glow, platform text or
  glyphs beside color, and separate presence state and VRChat status. Ask Me
  and DND locations never reach labels, images, accessible names, or actions.
  Use the shared `isWorldHidden`, `isHotInstanceMember`, `hotInstanceKey`, and
  `isFriendJoinable`; no local copies.
- Reuse overlay primitives. Sheets are non-modal and restore their opener;
  confirmation dialogs are modal and trap focus; segmented controls keep
  radiogroup keyboard behavior. Every workflow stays reachable at 900x670.
  Virtualized friend rows keep stable section identity, recover focus when a
  focused row disappears, and keep TanStack Virtual's default `useFlushSync`.
  The scrollport is `clientHeight`; jsdom tests that render rows stub it.
  Row measurement still falls back to `offsetHeight`.
- All copy goes through i18next with every key in en and ja.
- Settings change through `@shared/settings`. A collapsed parent card keeps
  its child values (Allow joining keeps Confirm join and launch mode).
  Stable, Beta, and Dev sit in the Automatic updates card on About, beside
  the on/off control and the check button. They are not their own section.
- Error boundaries, the document-drop guard, and explicit local diagnostics
  copy belong here.

## Work Guidance

Read the three design documents before UI work and the relevant catalog
entries before changing a query, hook, store, utility, bridge call, or shared
type. Current source is the implementation record; examples and old notes do
not authorize behavior changes.

## Verification

Run focused tests for changed queries, hooks, components, accessibility, or
fencing. For UI changes, inspect the production component or guide scene in
both themes at 900x670. Run the root gate for application changes.

## Child DOX Index

No child contracts.
