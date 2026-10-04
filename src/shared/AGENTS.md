# Shared model

## Purpose

`src/shared` contains pure types, schemas, constants, and helpers used across
main, preload, and renderer. It is the vocabulary at the process boundary.

## Ownership

- `ipc.ts` defines the typed invoke and push contract used by main, preload, and
  renderer. Keep request and response values renderer-safe. Main owns sender
  trust checks, validation, credentials, rate limits, sessions, URLs, and launch
  authority.
- `explore.ts` owns display-only discovery values, opaque main-issued world and
  selection references, typed refresh reasons, and 2/4/6 display totals.
  Ranking stays pure and balanced across platform lists. Synthetic references
  belong only in tests.
- `types.ts` owns platform, friend, auth, account, presence, linking, settings
  choice, and event vocabulary. Use string-literal unions, not `const enum`.
  Account-qualified identities include platform and platform account ID; never
  reduce them to a bare upstream ID.
- `settings.ts` owns the schema, defaults, version, migrations, and safe parse.
  `parseSettings` migrates, strips unknown keys, and falls back to defaults
  without throwing. `SETTINGS_VERSION` is 11. Every additive persisted field
  requires a version bump and identity migration. Preserve the v1-v11 migration
  chain. A missing released migration throws rather than stamping an old shape
  as current. A newer-version file stays read-only and is never down-leveled or
  rewritten by an older build. The v9-v10 identity migration adds default-on
  `dashboardPopularNow` and `hotInstancesEnabled`; dashboard, alert, and join
  preferences remain retained when their parent feature is disabled.
  The v10-v11 identity migration adds `cvrSessionImportChoice` (ask/skip/import);
  missing or invalid data never grants external-session discovery consent.
- `linkedProfiles.ts` owns versioned linked-person values. Snapshots carry a
  document `storeRevision` and main-owned ready `accountIds`; readers retain the
  newest revision within an identity lease. Shared notes belong to the
  installation-global person, while account notes remain account-scoped.
- `joinability.ts` and `hotInstanceKey.ts` own the shared privacy and grouping
  predicates. Exact instance identity, not world or type, groups hot instances.
  Hidden Ask Me and DND locations are excluded everywhere, including actions and
  alerts. `InstanceInfo.type` remains platform-true; `openness` is the normalized
  tier and `opennessUnknown` marks an unrecognized raw privacy value.

## Local Contracts

- Keep this directory pure. It imports neither Electron nor Node and contains no
  file, network, credential, logging, or renderer-global access. ESLint enforces
  the import boundary.
- The renderer sends friend IDs as requests and opaque Explore references as
  capabilities. It never supplies a launch URL or authoritative location. Typed
  denials remain structured and renderer-safe; do not pass exception text,
  tokens, cooldowns, or session data across IPC.
- `ExploreImageResult` permits ready `data:` data, terminal `null`, or a typed
  bounded local-admission deferral. It grants no URL or session authority.
  VRChat friend responses carry completeness and physical-read provenance;
  partial follow-ups retain the earlier revision for omitted rows. CVR complete
  snapshots remain arrays. Friend events carry a main-owned ordering revision,
  never a timestamp or renderer-supplied authority.
- `CREDENTIAL_PERSISTENCE_FAILED` is the sole login error with dedicated renderer
  copy. `AUTH_IDENTITY_UNAVAILABLE` remains terminal but uses generic copy.
  `sessionCleared` means main discarded local auth state and consumers must set
  known unauthenticated state.
- `Friend` keeps presence state separate from VRChat status. ChilloutVR fields
  with no equivalent remain `null`. Unknown upstream enums degrade safely.
  `AccountScoped<T>` remains a versioned persistence envelope with no person ID.
  Do not mix linked-person data, account cache data, and installation-global
  shared notes.
- Keep constants as the single source for limits and API values. Any changed
  unofficial API assumption belongs in `docs/api-volatility.md`; policy or
  etiquette changes also update `docs/api-policy.md`.

## Work Guidance

Read `docs/INTERNAL-API.md` sections 1-3 and 7-8 before changing a shared
contract. Reuse the existing type, constant, predicate, or channel where it
fits. Update that catalog with any callable or cross-process change and update
all affected main, preload, renderer, and guide callers in the same change.

## Verification

Run focused schema, migration, predicate, and IPC contract tests for the changed
model. Test a migration from its immediately preceding version and an invalid
settings load when settings change. Run the canonical gate in
`docs/DEVELOPMENT.md` when application code changes, and inspect the diff for
forbidden imports and stale callers.

## Child DOX Index

No children.
