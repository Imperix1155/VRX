# src/shared

## Purpose

Pure types, schemas, constants, and helpers used by main, preload, renderer,
and the design guide. It is the vocabulary at the process boundary. Import it
through `@shared`.

## Ownership

- `ipc.ts`: the typed invoke, notification, and push contract. Values stay
  renderer-safe. Main keeps sender trust, validation, credentials, rate limits,
  sessions, URLs, and launch authority.
- `types.ts`: platform, friend, presence, instance, account, auth, settings
  choice, and adapter event vocabulary.
- `settings.ts`: schema, defaults, `SETTINGS_VERSION`, migrations,
  `parseSettings`, and `shouldPersistSettings`.
- `inbox.ts`: view-only inbox vocabulary (kinds, entries, changes, rows), its
  size bounds, and the ID and text guards the parsers share.
- `explore.ts`: display-only discovery values, opaque main-issued `worldRef`
  and `selectionRef`, typed refresh reasons, and the 2/4/6 world totals.
  `exploreRanking.ts`: pure per-platform ranking and balanced cross-platform
  selection.
- `linkedProfiles.ts`: versioned linked-person values, changes, and snapshots.
- `activity.ts`: Activity entry values and the page's Show filter. Entries
  carry no location, only a world name that is null for hidden worlds.
- `joinability.ts` and `hotInstanceKey.ts`: the shared privacy, joinability,
  hot-membership, and hot-grouping predicates.
- `backgroundPicture.ts`: which background pictures main refuses and which
  Settings warns about (size and shape against the landscape window).
- `constants.ts`: the single source for limits, TTLs, and API endpoints.
- Look up symbols in [`docs/INTERNAL-API.md`](../../docs/INTERNAL-API.md).

## Local Contracts

- Stay pure: no Electron or Node imports and no file, network, credential,
  logging, or renderer-global access. ESLint `no-restricted-imports` enforces
  the import boundary.
- Use string-literal unions or `as const` arrays, never `const enum`.
  Account-qualified identities carry platform and platform account ID; never
  reduce them to a bare upstream ID.
- `parseSettings` migrates, strips unknown keys, and falls back per field to
  defaults. It throws only when a migration between released versions is
  missing. A file from a newer version is never down-leveled, and
  `shouldPersistSettings` refuses to write over it.
- Every additive persisted setting bumps `SETTINGS_VERSION` and registers an
  identity migration from the previous version, so an older build cannot strip
  it during a downgrade. Keep the full migration chain.
- `cvrSessionImportChoice` has no reader since the startup import was removed;
  it stays in the schema so older builds keep their saved answer. Alerts and
  `autoUpdate` default off. `updateChannel` is `stable`, `beta`, or `dev`
  (default `stable`); anything else stays `stable`. `SETTINGS_VERSION` 15
  keeps that choice across a downgrade. `confirmJoin` and `joinMode` keep their values while `allowJoinInstances` is
  off. The Dashboard section switches hide sections only and change no other
  preference. The page switches (`showHotInstancesPage`, `showExplorePage`,
  `showActivityPage`, `showInboxPage`) hide sidebar pages only;
  `showActivityPage` also stops main keeping activity. `SETTINGS_VERSION` 19
  adds `showInboxPage` (on) and the `notifyInvites` and `notifyFriendRequests`
  alerts (off). Missing or invalid `setupPending` is `false`, so
  only `freshInstallSettings` (a brand-new install) starts the welcome setup.
- The renderer sends friend IDs and opaque Explore references, never a launch
  URL or an authoritative location. Typed denials stay structured; never pass
  exception text, tokens, cooldowns, or session data across IPC.
- `ExploreImageResult` is a `data:` result, terminal `null`, or a typed
  `deferred` admission result. It grants no URL or session authority.
  Synthetic references belong only in tests and guide fixtures.
- VRChat `get-friends` replies carry completeness and provenance. Partial
  replies list the covered IDs; only complete snapshots advance absence
  freshness. CVR complete snapshots remain arrays. `FriendEvent` carries a
  main-owned `rosterRevision`, never a timestamp or renderer value.
- `CREDENTIAL_PERSISTENCE_FAILED`, `SESSION_IMPORT_NOT_FOUND`, and
  `SESSION_IMPORT_REJECTED` are the login errors with dedicated copy.
  `AUTH_IDENTITY_UNAVAILABLE` is terminal with generic copy. `sessionCleared`
  means main discarded local auth state.
- `Friend` keeps presence `state` separate from VRChat `status`. ChilloutVR
  fields with no equivalent are `null`. `InstanceInfo.type` stays
  platform-true; `openness` is the normalized tier; `opennessUnknown` marks an
  unrecognized raw privacy value.
- Hot instances group by exact instance identity, never world or type. Ask Me
  and DND friends in a world are hidden from the whole hot system, actions, and
  alerts. `isFriendJoinable` also rejects hidden world IDs and offline CVR
  instances.
- Linked snapshots carry a `storeRevision` and main-owned `accountIds`. Shared
  notes belong to the installation-global person; per-friend notes stay
  account-scoped. `AccountScoped<T>` is a versioned envelope with no person ID.
  Never mix linked-person, account cache, and installation-global data.
- Changed unofficial API assumptions belong in
  [`docs/api-volatility.md`](../../docs/api-volatility.md); etiquette changes
  also update [`docs/api-policy.md`](../../docs/api-policy.md).

## Work Guidance

Read the catalog entries before changing a shared contract. Reuse the existing
type, constant, predicate, or channel when it fits. Update the catalog and
every affected main, preload, renderer, and guide caller in the same change.

## Verification

Run focused schema, migration, predicate, ranking, and IPC contract tests.
When settings change, test a migration from the previous version and an
invalid load. Run the root gate for application changes and inspect the diff
for forbidden imports and stale callers.

## Child DOX Index

No child contracts.
