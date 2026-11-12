# Upstream and feature prep, November 2026

Prep notes from 2026-11-10. They record what was checked against upstream and
what is not ready to build. A contract and the current source win if they
disagree with this file.

VRX 1.0 shipped on 2026-10-23. This pass compared that date with upstream
through 2026-11-10, then with the versions locked on `dev` before this branch
(`electron` 45.2.1, `vite` 8.3.5, `electron-vite` 6.0.0, `eslint` 10.14.0,
`typescript-eslint` 8.72.1).

## Shipped in this change

- Electron 45.2.3, Vite 8.3.7, typescript-eslint 8.72.2. Patch updates only.
- Explore room rows show a VRChat instance `displayName`, `description` and a
  BCP-47 `dominantLanguage` from the room response VRX already fetches
  (`GET /worlds/{worldId}/{instanceId}`). The row names the tag with
  `languageTagLabel`, so `pt-BR` is a language name rather than the raw tag.
  ChilloutVR rows stay without them.
- The signed-in user's own world Like and Dislike shipped in #592. There is
  still no public like count, and that rating does not change Explore
  ranking. The instance owner is still not a display name in the community
  spec.

## Tooling left for later

### Electron 46

- **What:** Move off Electron 45.
- **Blocked:** 46 is still alpha (46.0.0-alpha.8 on 2026-11-09). Alpha.5
  upgrades Node to 26.13.0 and removes `--experimental-transform-types`.
- **Sources:** [Electron releases](https://releases.electronjs.org/release/),
  [v46.0.0-alpha.5](https://releases.electronjs.org/release/v46.0.0-alpha.5),
  [v45.2.3](https://releases.electronjs.org/release/v45.2.3).
- **Plan:** Wait for a stable 46. Read the breaking-change list, then bump
  `electron` and rebuild native deps. Re-check the fuses in
  `electron-builder.yml`, the window flags, and `npm run build`.
- **Files:** `package.json`, `package-lock.json`, `electron-builder.yml`.
- **Acceptance:** `npm run verify` passes on the stable 46 release. No window
  flag or fuse is weakened. The changelog names the Electron version.

### electron-vite

- **What:** A newer electron-vite than 6.0.0.
- **Blocked:** 6.0.0 (2026-10-15) is the latest stable npm release and already
  peers Vite 6, 7 and 8. Nothing newer was published by 2026-11-10.
- **Sources:** [electron-vite changelog](https://github.com/alex8088/electron-vite/blob/master/CHANGELOG.md),
  [npm electron-vite](https://www.npmjs.com/package/electron-vite).
- **Plan:** When a 6.0.x or 6.1.x ships, read its changelog and bump it with
  Vite in the same change. Do not take a beta to get ahead of Vite.
- **Files:** `package.json`, `package-lock.json`, `electron.vite.config.ts`.
- **Acceptance:** `npm run build` still emits the main, preload and renderer
  bundles, and `scripts/assert-entry-chunk.mjs` passes.

### ESLint

- **What:** An ESLint release after 10.14.0, and the new shell-script plugin.
- **Blocked:** 10.14.0 (2026-10-30) was still the latest core release on
  2026-11-10. `@eslint/shell` is a new plugin, not a drop-in upgrade, and VRX
  does not lint shell scripts today.
- **Sources:** [ESLint releases](https://github.com/eslint/eslint/releases),
  [shell-script support note](https://releasebot.io/updates/eslint).
- **Plan:** Bump `eslint` on the next patch or minor after reading the rule
  changes. Adopt `@eslint/shell` only if we want a new lint surface; that is a
  separate change with its own config and fixtures.
- **Files:** `package.json`, `eslint.config.*`.
- **Acceptance:** `npm run lint` stays at zero warnings. A shell plugin, if
  added, lints the scripts we choose and does not fail the existing TypeScript
  project.

### typescript-eslint after 8.72.2

- **What:** Later 8.x or a 9.x major.
- **Done now:** 8.72.2 (2026-11-09), rule bugfixes only.
- **Sources:** [v8.72.2](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.72.2).
- **Plan:** Keep taking 8.x patches. Treat 9.x as its own migration.
- **Acceptance:** `npm run lint` passes with no new suppressions.

### Vite, Vitest and the React plugin minors not taken

- **What:** `@vitejs/plugin-react` 6.3.0 (locked 6.2.1) and Vitest 5.1.0
  (locked 5.0.5). Vite itself moved 8.3.5 → 8.3.7 in this change.
- **Blocked:** Those two are minors outside the three toolchains this pass
  upgraded. They need their own changelog read so a test-runner change is not
  hidden inside an Electron bump.
- **Sources:** [Vite changelog](https://github.com/vitejs/vite/blob/main/packages/vite/CHANGELOG.md)
  (8.3.6 and 8.3.7 are the patches already taken), npm `vitest` and
  `@vitejs/plugin-react`.
- **Plan:** One follow-up that bumps the plugin and Vitest together, then runs
  the full test suite.
- **Files:** `package.json`, `package-lock.json`.
- **Acceptance:** `npm test` and `npm run build` pass. No test is skipped to
  go green.

## VRChat 2026.4.2 instance features

Client notes: [VRChat 2026.4.2 open beta](https://docs.vrchat.com/docs/vrchat-202642-open-beta)
(build 1948). The notes do not list new API fields. The notes do say the
public-instance owner rules are already live on the backend.

Community spec checked at `vrchatapi/specification` `main`, last push
2026-11-10T00:33:56Z. Schemas below are that tree.

### Already shown

`GET /worlds/{worldId}/{instanceId}` returns
[`Instance`](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/Instance.yaml)
(`getWorldInstance` → `InstanceResponse`). Explore already requests it.
`parseVrcExploreRoom` now copies:

| Wire field         | VRX field             | Rule                                                                                                                                             |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `displayName`      | `instanceTitle`       | Own property, string, clipped to 80 code points. Blank is null.                                                                                  |
| `description`      | `instanceDescription` | Own property, string, clipped to 280 code points.                                                                                                |
| `dominantLanguage` | `spokenLanguage`      | Own property. A trimmed string `isBcp47LanguageTag` accepts, including `pt-BR`. The row names it with `languageTagLabel`. Anything else is null. |

The row shows the title as plain text, the description on two lines, and
`Language: {name}` from `languageTagLabel`. No new request. `docs/DESIGN.md`
§9.4 records that layout, and the design-guide fixtures show a VRChat room
with a title, `pt-BR` and a two-line description beside ChilloutVR rooms
that omit all three.

### Instance owner, separate from the world author

- **What:** On a hot instance and on an Explore room, show the instance owner
  and the world author as two labeled facts. Never put the author in the
  owner row. Group instances already show the group; do not add a second line
  that repeats the group name.
- **Blocked:** The full `Instance` schema has `creatorId` (`UserID | null`, no
  description that says "owner") and `ownerId`. `InstanceOwnerId` still says:
  "A groupId if the instance type is group, null if instance type is public,
  or a userId otherwise." There is no `ownerName` on `Instance`.
  `LimitedInstance.ownerName` and `ownerIconUrl` (added 2026-11-02, commit
  `ddc454dd`) are described as the **group** `ownerId` names, or null when
  `ownerId` is null. `World.authorName`, `authorId` and `authorIconUrl` are the
  world author and are not an owner.
- **Watch for, in this order:**
  1. `ownerId`'s description no longer says public instances are null, and a
     public instance example carries a `usr_` id.
  2. `ownerName` and `ownerIconUrl` on **`Instance`**, not only
     `LimitedInstance`, with a description that names a user for a non-group
     instance.
  3. A field actually named for a person (`ownerDisplayName`, `creatorName`).
     Do not promote `creatorId` into a label. An id is not a name, and a
     `GET /users/{id}` per instance is a new read.
- **Sources:** [2026.4.2 notes](https://docs.vrchat.com/docs/vrchat-202642-open-beta),
  [`Instance.yaml`](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/Instance.yaml),
  [`LimitedInstance.yaml`](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/LimitedInstance.yaml),
  [`InstanceOwnerId.yaml`](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/InstanceOwnerId.yaml),
  [`World.yaml`](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/World.yaml).
- **Plan:**
  1. Extend the room parser only after the spec text above changes. Keep the
     new strings nullable. Clip the name the same way as `displayName`.
  2. Add `worldAuthorName` from `authorName` on the world detail VRX already
     fetches, and `instanceOwnerName` from the new owner field. Parse them in
     `parseVrcExploreWorld` and `parseVrcExploreRoom`.
  3. Show both in the Explore sheet's "About this world" facts and on the room
     row only as plain text with the labels "World by" and "Instance owner".
     Group rooms keep `groupName` and leave the owner line empty when the
     spec still says that name is the group.
  4. Hot instances: see the next section. The same two labels go in
     `HotInstanceSheet`'s "About this instance" facts.
  5. Record the shape in `docs/api-volatility.md`. No `api-policy.md` change
     if the only source is the world and room responses Explore already gets.
- **Files:** `src/shared/explore.ts`, `src/shared/types.ts` (`InstanceInfo` if
  hot instances carry it), `src/main/services/adapters/vrchat/parseExplore.ts`,
  `src/main/services/adapters/vrchat/parseLocation.ts` (still cannot see this
  on a location string), `src/renderer/src/components/ExploreWorldSheet.tsx`,
  `src/renderer/src/components/HotInstanceSheet.tsx`, both translation files,
  `docs/guide/fixtures.ts`, `docs/api-volatility.md`, the Explore rows in
  `docs/internal-api/6-main-process.md` and `docs/internal-api/7-shared.md`.
- **Acceptance:**
  - A public room fixture with a documented user `ownerName` and a different
    `authorName` shows both, with those labels, and never the raw `usr_` id.
  - A fixture whose `ownerName` is absent shows the author only, or neither,
    and does not copy the author into the owner line.
  - A group room does not show the group twice.
  - A response that omits the new fields looks like today's sheet.
  - ChilloutVR is unchanged until that platform documents the same pair.
  - Parser tests cover a missing field, a blank string, an inherited
    property, and a too-long name.

### Hot instance cards

- **What:** The same instance name, description, language, category, vibes and
  owner on hot instance cards and the hot sheet, not only Explore.
- **Blocked:** Friends carry a location string. `parseLocation` never receives
  an `Instance` object, so the fields above are not in the data the card
  already has. Filling them means a new call to the existing
  `GET /worlds/{worldId}/{instanceId}` when the user opens the sheet. That URL
  is already used by Explore for public rooms. Using it for every hot card on
  a timer, or once per card as the dashboard paints, would multiply requests.
  Owner, category and vibe names are additionally blocked by the sections
  below. Impy should confirm the one extra read on sheet open before it ships;
  it is not a new endpoint, but it is a new reason to call one.
- **Sources:** same Instance schema; `src/main/services/adapters/vrchat/parseLocation.ts`;
  `src/renderer/src/components/HotInstanceSheet.tsx`.
- **Plan:**
  1. Extract the display-copy parser from `parseVrcExploreRoom` so a
     non-Explore caller can reuse it without the public-only access rules.
  2. On sheet open, one admission-queued read, `retry: 'none'`, fenced by the
     session lease, cancelled when the sheet closes or the account changes.
     Cache a success for a few minutes and a failure briefly, the same shape
     as `WorldResolver`'s negative cache. Do not read on a timer and do not
     read for cards that stay collapsed.
  3. Until that read returns, the card keeps today's world name, access pill,
     region and friend count. Never invent a title from the numeric instance id.
  4. Add the one-sentence trigger to `docs/api-policy.md` only if Impy accepts
     the extra read, and the shape to `docs/api-volatility.md`.
- **Files:** `HotInstanceSheet.tsx`, `HotInstancesView.tsx`, a main-process
  reader next to `WorldResolver` or inside `VrcAdapter`, `src/shared/ipc.ts`,
  `src/preload`, the IPC catalog section, hot-sheet tests.
- **Acceptance:**
  - Opening one sheet causes one instance GET, visible in an adapter test.
  - Closing it, or switching account before the response, does not publish.
  - A second open inside the success TTL does not fetch again.
  - A 401 still follows the data-path rule. A 403 or 404 leaves the sheet
    without a title and is not retried in a loop.
  - Ask Me and Do Not Disturb friends still never contribute a location.
  - Dashboard paint with many hot cards performs no extra instance GETs.

### Category and vibes

- **What:** Show the instance category and up to three vibes (Hangout, Games,
  and the mood words from the 2026.4.2 notes).
- **Blocked:** The room response VRX already gets has `categoryId`
  (`InstanceCategoryID`, example `icat_…`), `displayVibeId` and `vibeIds`
  (`InstanceVibeID`, example `ivib_…`). Those are opaque ids. Names live on
  other resources VRX does not call:
  - `GET /instances/categories` (`getInstanceCategories`) → `InstanceCategory`
    with `id`, `name` (example `Hangout`), `iconUrl` (example
    `vrchat://category_hangout`), `order`, `deleted`.
  - `GET /instances/vibes` (`getInstanceVibes`) → `InstanceVibe` with `id`,
    `title` (example `adventure`), `deleted`.
    Adding those routes is a new endpoint pair. `docs/api-policy.md` has to
    record them, and Impy has to accept them, before any code calls them.
    `creationLanguages` is an array of `Unknown` and must not be parsed.
    `languages` is the crowd's language mix, not the category.
- **Sources:** [`InstanceCategory.yaml`](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/InstanceCategory.yaml),
  [`InstanceVibe.yaml`](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/InstanceVibe.yaml),
  [`instances.yaml` paths](https://github.com/vrchatapi/specification/blob/main/openapi/components/paths/instances.yaml).
  `categoryId`, `vibeIds` and `displayVibeId` have been on `Instance` since
  the 2026-09-03 schema fill (`1f2a2a99`) and `displayVibeId` since
  2026-09-28 (`153b70ce`). The 2026.4.2 client is what started asking everyone
  to set them.
- **Plan:**
  1. After the policy line is accepted, fetch each catalog at most once per
     session (or once per 24 h), through the admission queue, `retry: 'none'`.
     Skip `deleted: true`. Keep at most a few dozen entries.
  2. Map `categoryId` to `name` and at most three `vibeIds` to `title`, with
     `displayVibeId` first if it is also in `vibeIds`. Unknown ids are
     dropped, never shown raw.
  3. Ignore `iconUrl` when it is not `https`. A `vrchat://` link is not an
     image and is not opened.
  4. Show the words on the room row's detail line and in the hot sheet, as
     plain text. The instance title stays plain text and is never a chip.
  5. Creating or editing a category or vibe is a write (`CreateInstanceRequest`
     already has `categoryId`, `description`, `displayName`, `vibeIds`). Do
     not add it.
- **Files:** a small catalog cache beside `WorldResolver`, `parseExplore.ts`,
  `ExploreWorldSheet.tsx`, `HotInstanceSheet.tsx`, `docs/api-policy.md`,
  `docs/api-volatility.md`, both translation files only if a new label word
  is needed (the category name itself comes from the API).
- **Acceptance:**
  - A room whose ids match a cached catalog shows the name and at most three
    vibe titles.
  - An unknown id, a deleted catalog row, and a missing catalog leave that
    label out and still show the title and description.
  - Tests prove no `icat_` or `ivib_` string reaches the renderer.
  - The catalog requests are not repeated per room.
  - No create or update instance request is added.

### World Like and Dislike

- **Shipped in #592.** The world sheet on VRChat has Like and Dislike for the
  signed-in user's own rating. Pressing the choice already shown clears it.
  A failed change puts the previous rating back. ChilloutVR has no rating
  control. The implementation is `worldRating.ts`, `WorldRatingControl` and
  the policy entry that #592 added. There is no public like count, and a
  dislike stays private, so `rankExploreWorlds` is unchanged: VRChat still
  sorts by occupants, then popularity.
- **Still blocked:** using a like count, or the caller's rating, to rank
  worlds. The community spec checked on 2026-11-10 had no public count on
  `World` or `LimitedWorld`. #592 did not add one. Do not treat `favorites`,
  `heat` or `popularity` as likes, and do not show a dislike number.
- **Watch for:** a documented public count on `World` and `LimitedWorld`
  (`likes`, `likeCount`, or whatever name the spec adds). Only then may a
  count break ties after occupants and popularity, inside one platform, and
  never outrank a busier world.
- **Sources:** [2026.4.2 notes](https://docs.vrchat.com/docs/vrchat-202642-open-beta),
  [`World.yaml`](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/World.yaml),
  #592.
- **Acceptance for a later ranking change:**
  - More occupants still win. Equal occupants and popularity may prefer a
    higher documented like count.
  - No dislike number appears in the rendered card, the accessible name, or
    a log line.
  - Worlds without the new field rank exactly as they do today.
  - ChilloutVR ranking stays untouched.

### Live Now shelves and instance discover

- **What:** Themed shelves (Meet new people, Join a game, and the rest) from
  the Live Now overhaul.
- **Blocked:** `GET /instances/discover` (`discoverInstances`, returns
  `InstanceDiscovery`: `attributionId` plus `LimitedInstance[]`) is a new
  endpoint. Shelf parameters live under infopush
  (`InfoPushDataContentSourceInstanceDiscover`). New endpoint category: policy
  update and Impy's OK. The response order changes between requests, so it
  must not be polled.
- **Sources:** [2026.4.2 notes](https://docs.vrchat.com/docs/vrchat-202642-open-beta),
  spec commits `be14be15` (capacityLimit, 2026-11-02) and `eab36a33` (optional
  `n` on shelf params, 2026-11-10).
- **Plan:** A user-opened page, one discover read per open or Refresh, the
  existing admission queue, no timer. Reuse the instance-copy parser. Keep
  `attributionId` inside main if a later join needs it; do not send it to the
  renderer unless a join flow requires it.
- **Files:** `VrcAdapter`, `ExploreService` or a sibling service, a new view,
  `docs/api-policy.md`, `docs/api-volatility.md`, `docs/DESIGN.md`.
- **Acceptance:** One manual refresh performs one discover request. Leaving
  the page cancels it. Unknown `LimitedInstance` fields degrade to the same
  nulls as Explore. No shelf is requested on a timer.

### Instance-closed websocket event

- **What:** Drop or mark an instance when VRChat says it closed, instead of
  waiting for the next friend location.
- **Blocked:** Not required for the 2026.4.2 metadata above. The spec added it
  on 2026-11-06 (`ce2712a6`, "Update Websocket types from docs"). VRX's
  pipeline does not handle `type: instance-closed` yet.
- **Source:** `WebsocketInstanceClosed`: required `instanceLocation`.
- **Plan:** In `VrcPipeline`, ignore a malformed payload. On a valid location,
  emit a narrow event the location authority already understands, or ignore
  the event until a friend location agrees. Do not invent a new presence.
  Do not log the location.
- **Files:** `src/main/services/adapters/vrchat/VrcPipeline.ts` and its test,
  `docs/api-volatility.md`.
- **Acceptance:** A double-encoded `instance-closed` for a known friend
  location clears that instance only. An unknown location is ignored. A
  malformed body does not throw.

### Writes that stay out

These are in the 2026.4.2 client or the spec and are platform writes. Each
needs `docs/api-policy.md` and Impy's OK. Do not start them from this plan
alone.

| Action                                                            | Spec                                            | Why it waits                            |
| ----------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| Create an instance (name, description, language, category, vibes) | `CreateInstanceRequest`                         | New write.                              |
| Rename an instance                                                | `UpdateInstanceRequest.displayName`             | New write.                              |
| Close an instance                                                 | `closeInstance`                                 | Moderation write.                       |
| Kick from an instance                                             | `createUserModeration` (2026-11-06, `971d9547`) | Moderation write.                       |
| Cast a world like or dislike                                      | shipped in #592                                 | The user's own rating. No public count. |
| Device-code login                                                 | spec 2026-10-25, `c52ffc7f`                     | New auth flow, not an instance feature. |

## ChilloutVR

- **What changed upstream:** The newest post on chilloutvr.net/blog as of
  2026-11-10 is the [October 2026 status report](https://chilloutvr.net/blog/status_report_october_2026)
  (2026-10-24). It covers the portable camera, Game Server 2, lookalikes and
  prop sync. It does not document HTTP fields for instance titles, owners,
  categories, vibes, or world votes. The previous posts are the August 2026
  hotfixes. There is still no public API reference; the unofficial models
  (for example `InstanceDetails` in the community Rust crate) still expose
  id, name, region, world, player counts and members.
- **Blocked:** No documented field to show, and inventing a VRChat-shaped
  title on a ChilloutVR room would fake parity.
- **Plan:** When a ChilloutVR response VRX already fetches grows a title,
  description, language, owner or author, map it onto the same `ExploreRoom`
  and `InstanceInfo` fields, with a row in `docs/api-volatility.md`. Until
  then leave the ChilloutVR values null.
- **Files:** `src/main/services/adapters/cvr/parseExplore.ts`,
  `src/main/services/adapters/cvr/resolveCvrInstance.ts`.
- **Acceptance:** A CVR room test still returns null title, description and
  spoken language. A future field is covered by a parser test before the UI
  shows it.

## Docs left unchanged on purpose

`docs/api-policy.md` gained no new endpoint in this branch. #592 already
recorded the world-rating write. `src/main/services/avatarCache.ts` was not
touched. `docs/DESIGN.md` §9.4 now records the instance-copy row.
