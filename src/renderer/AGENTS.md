# Renderer

## Purpose

`src/renderer` is VRX's sandboxed React and Tailwind UI. It presents main-process
data and calls the typed preload bridge. It never gains direct Electron, Node,
credential, network, or launch authority.

## Ownership

- `src/App.tsx` owns the auth gate and mounts the live-event bridge once. Auth errors
  keep the shell available until main proves the account is signed out. Boot must
  not flash the login form over a restored session. Login keeps platform input
  separate, freezes its selector during a submit, and maps only the typed
  credential-persistence failure to dedicated copy.
- TanStack Query owns server and cache state. Zustand owns view state only. Do not
  put server data in a store, have stores import each other, or create a second
  subscription for an app-wide event.
- Friend, linked-profile, Explore, and note queries own account-bound data. On an
  identity or auth boundary they cancel old work, clear mounted data and fences,
  and prevent an old reply from publishing under the replacement account. An
  absent cache differs from a known empty roster.
- `projectLinkedFriends` only projects qualified people. Raw friend caches stay
  account-scoped. Linked snapshots retain the newest `storeRevision` within a
  lease; their main-owned `accountIds` preserve ownership through transient auth
  status errors. Shared person notes are installation-global, drafts stay in
  memory, writes are serialized and explicitly retried, and renderer requests
  never choose note or account ownership. A partial roster preserves omitted
  cached friends; only a complete roster can make an absence authoritative.
- `useJoinInstance` and `JoinConfirmDialog` own one join flow for friends, hot
  instances, and Explore. The renderer may give main a reviewed friend ID or an
  opaque Explore `selectionRef` and expected target. Main alone decides
  joinability, builds the allowlisted URL, enforces settings, and launches.
  Failure feedback remains readable until another attempt or account boundary;
  retries use this same flow and never run automatically.
- `LinkedProfilesLoadError` exposes local-read retry in Friends and Identities,
  coalescing active reads through the existing account-fenced query. Name saves
  and platform-name resets clear only drafts with no later edits.
- Explore route and Dashboard preview share ranking, selection, and the
  non-modal sheet. `useExploreCoordinator` is the sole renderer trigger for
  discovery: it reacts to eligible visibility, focus, and connectivity wakes,
  has no polling or timer-driven discovery, and gates automatic work by account
  and platform. Cache reads, selection, images, and recovery remain fenced by
  generation, account, close, and opaque-reference identity. A loading world
  snapshot stays open until `onExploreChanged` performs a cache-only reread; it
  must not close the sheet or retry discovery. A manual open or refresh may
  recover one expired reference for the same world. Visible
  consumers may retry only typed image-admission deferrals within the bounded
  per-reference budget; terminal failures stay neutral.
- VRChat roster deltas belong to the pending IPC transport, shared across query
  cancellation/replacement because main coalesces reads. Replay by response identity
  in structural sharing before publication, never by a key-only success listener.
  Account boundaries explicitly discard old transports. Failure, abandoned
  settlement, and publication release journals/listeners. Overflow bounds events,
  rejects without retry, and fences reuse until the old transport settles. CVR
  snapshot replay remains separate. Compare event revisions with each row’s
  physical-read provenance before replay; one IPC can include a newer follow-up.
  Partial follow-ups and rate-limit fallback retain earlier fences. Reject
  malformed envelope/revision metadata as a refresh error. Keep one bounded
  published roster fence per query client: Electron can deliver older pushes
  after invoke completion, so direct live application uses the same per-row
  ordering. Clear this fence at account boundaries. Legacy arrays and
  unversioned partial replies retain their existing behavior.
- `mergeKnownInstanceMetadata` is the roster merge helper. It may fill missing
  metadata only when the current instance keeps the same world or group identity;
  fresh values win.
- Error boundaries, document-drop prevention, localized copy, and local licensed
  fonts are renderer responsibilities. Keep diagnostics local to explicit copy,
  preserve font licenses and provenance, and never load remote fonts.

## Local Contracts

- Use `window.vrx` and the `@shared/ipc` types. Do not duplicate channel types,
  bypass the bridge, treat opaque references as IDs or URLs, or expose main-only
  cooldown, session, or error detail. See `docs/INTERNAL-API.md` sections 1, 2,
  and 5 for the current callable contracts and limits.
- Preserve the privacy and presentation model in `docs/DESIGN.md` sections 2-10:
  token-only styles, dark/light parity, information-panel backing independent of
  ambient glow, platform text or glyphs, and separate presence state and VRChat
  status. Hidden locations never leak into labels, images, gesture metadata, or
  actions. Use the shared hot-instance membership/key and joinability predicates
  instead of local copies.
- Keep established accessibility behavior. Reuse overlay primitives; sheets are
  non-modal and restore their opener, confirmation dialogs trap focus, controls
  keep their radiogroup keyboard behavior, and existing workflows stay reachable
  at the 900x670 desktop floor. Virtualized friend rows retain stable section
  identity and recover focus when live updates remove a focused control. Keep
  TanStack Virtual's default `useFlushSync` commit for variable-height rows.
- User-facing copy goes through i18next and every supported locale receives the
  matching key. Do not hardcode renderer copy.
- Settings changes use `@shared/settings`. Every additive persisted field bumps
  `SETTINGS_VERSION` and adds an identity migration, so an older build cannot
  erase it during a downgrade round trip. Preserve independent child preferences
  when a parent control is off.
- Images supplied to the DOM are main-issued `data:` URLs. Failed images use
  neutral fallbacks. Explore and room sheets distinguish incomplete coverage,
  verified emptiness, stale data, and typed denials without pretending success.

## Work Guidance

Read `docs/DESIGN.md`, `docs/design.html`, and `docs/glass.html` before UI
work. Read the relevant entries in `docs/INTERNAL-API.md` before adding or
changing a query, hook, store, utility, bridge call, or shared type. Use current
source as the implementation record; examples and old audit notes do not
authorize a behavior change. Update `CHANGELOG.md` for user-visible behavior
and the API or design references named by the root contract when they change.

## Verification

Run focused tests for changed queries, hooks, components, accessibility behavior,
or boundary fencing. For UI changes, inspect the affected production component or
isolated guide scene in both themes and at the supported desktop floor. Run the
canonical gate in `docs/DEVELOPMENT.md` for application changes, then inspect
the diff and applicable API/design documentation for sync.

## Child DOX Index

No children.

- Combined Friends query state ignores disabled platforms for pending/error/fetching
  flags and explicit refresh. Keep cached-data folding and memoized array identity
  intact; an enabled but paused first load still counts as pending.
