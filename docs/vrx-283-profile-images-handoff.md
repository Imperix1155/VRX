# VRX-283 profile image investigation

## Scope and authority

Restore missing VRChat profile pictures reported in 0.21.0 on macOS and Linux.
Keep Settings, navigation and Linux credential work separate. Commit, push and
PR preparation are authorized. Merge, release and installed-app replacement are
not authorized.

## Evidence

- Starting revision `424610f`, the 0.21.0 release merge. The four image-path
  files named in the task match `v0.21.0`.
- Josh reports all VRChat profile pictures missing, with CVR profile pictures
  and VRChat Explore world pictures working. No screenshots or live account
  requests were made during this investigation.
- A read-only parse of the complete `vrx-query-cache` record in VRX's local
  LevelDB log found 194 VRChat friends, all with null avatar URLs, and 163 CVR
  friends, all with populated URLs. The cache buster was `0.21.0.1`.
  Only aggregate counts were emitted. No friend records, private URLs or
  credentials were printed or saved. This proves the cached output, not the
  exact current server response.
- The [current friend schema](https://github.com/vrchatapi/specification/blob/c5f467d17087fc56f4f3dbc4e7f5b11d941ecd9a/openapi/components/schemas/LimitedUserFriend.yaml)
  uses `iconUrl` and `currentAvatarImageUrl`. The specification
  [removed VRX's three legacy image fields on September 16](https://github.com/vrchatapi/specification/commit/2a62f547e7e1b407ca04efc826ba6b4e1b78a421)
  and [restored the full avatar field on September 20](https://github.com/vrchatapi/specification/commit/9cdcf27d9e52ce307001ec56cb8964ef3fecaa17).
- A synthetic current-format response reproduces the failure. The old Zod
  schema strips both current fields, and normalization returns null. The
  renderer consequently never requests an image. The known mounted-avatar
  retry gap cannot recover a missing source URL and remains outside this fix.

## Implementation

The shared REST/Pipeline normalizer prefers `iconUrl`, preserves the three
legacy fallbacks and finally accepts `currentAvatarImageUrl`. Malformed new
optional fields degrade independently rather than dropping a friend.
Recognized VRChat file URLs from the current fields become 256px thumbnail
URLs. Other URLs remain unchanged for existing cache validation.

No new API calls, retry loops, polling, cookies, allowed hosts, IPC methods or
session behavior were added. Thumbnail requests use existing image admission,
cookie confinement, redirect checks, MIME validation and the 3 MiB body cap.

## Verification and review

- Baseline: 73 existing image, hook, IPC and friend tests passed.
- Current-format REST/Pipeline tests failed before the fix.
- Mutation probe replaced only `fetchFriends.ts` with the original revision.
  All 18 new regression cases failed, including both normalizer-to-image-cache
  paths. The fixed file was restored in a `finally` block.
- Full suite: 2,834 tests passed in the sandbox; two socket integration tests
  could not bind localhost there. Both passed on an authorized rerun outside
  the sandbox. Combined coverage is 2,836 passing tests across 185 files.
- `lint -- --no-cache`, `format:check` and `build` passed, ending in
  `VRX_283_PROJECT_GATE_GREEN`; the entry-chunk assertion also passed.
- Fallow dead-code reported zero changed-file findings. Duplication inspection
  found one eight-line repeated test setup for the existing authenticated
  redirect fixture; retained for explicit independent test setup. No duplicate
  production logic was introduced.
- Fresh general review passed with no material findings, T1. Effective runtime
  was `gpt-6-astra`, High, read-only sandbox, approval never. This is same-lineage
  Codex review, not independent-model confirmation. The reviewer independently
  probed old/current normalization, URL variants, legacy precedence, mocked
  authenticated redirects, unsafe URL rejection and session quarantine.
- Review anchor: base `424610f1e265d13c55a018edd663f1a69f88bc34`, 9-file patch,
  23,864 bytes and 426 lines, SHA-256
  `d0432ac27ed3d09b7d01f0dbed2e5b8951dc93ae524ed69985bb6131de8deb6e`.
  Acceptance and correctness passed for the scoped normalization correction.
  This review receipt is the only later delta and changes no implementation or
  contract behavior; focused formatting and diff checks cover it.
- Remote CI and advisory-bot disposition are recorded on the PR and Linear
  issue for its exact final head. No merge authority is held.

## Documentation pass

Updated the owning VRChat contract, internal API catalog, API volatility notes
and changelog. Design artifacts, renderer contracts, API etiquette policy and
README remain unchanged because layout, interactions, request policy and
project structure are unchanged.

## Remaining limits

No fresh signed-in response capture or rendered-image confirmation was taken
on either affected machine. Current-format fixtures and schema evidence verify
the normalization correction. They do not prove every live icon URL downloads
successfully. The installed 0.21.0 app remains unchanged. After an authorized
release, verify VRChat pictures in Friends and a drawer, including users with
custom icons and users whose picture falls back to their avatar; confirm CVR
and Explore pictures remain available.
