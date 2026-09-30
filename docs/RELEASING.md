# Releasing VRX

This procedure works from a fresh clone with Git, the documented Node/npm
toolchain, and authorized GitHub access. No personal release skill or Mac
artifact is required. [Review](REVIEW.md) and [Development](DEVELOPMENT.md)
remain the prerequisites.

An implementation request alone does not authorize merging, publishing, or
replacing someone's installed app. Carry an explicit delivery grant through
its covered steps without asking repeatedly. Keep any other steps pending.

## 1. Prepare a version PR

1. Fetch current `main`, inspect open PRs and the last public release, and
   establish the intended release scope. Include all intervening user-visible
   changes, not just the latest private test build.
2. On a feature branch, choose a SemVer bump. Features normally increment MINOR;
   compatible fixes increment PATCH. Before 1.0, approved breaking changes may
   use MINOR, with their impact disclosed. Do not reuse an already published tag.
3. Run `npm version X.Y.Z --no-git-tag-version`, substituting the chosen version.
   Check `package.json`, the lockfile root version, and its root package version
   agree. The version-only operation must not change the dependency graph.
4. Move all applicable `[Unreleased]` entries into
   `## [X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`. Leave a new Unreleased heading.
   Do this for private owner test builds too; otherwise the in-app What's New
   view shows old release notes.
5. Run `node scripts/extract-changelog.mjs X.Y.Z` and verify nonempty notes
   covering the release. The workflow leaves the existing body unchanged if
   extraction is empty or fails; it does **not** generate replacement notes.
6. Run the full development gate, review the exact diff, open the version PR,
   and wait for required final-head CI. Merge only under the applicable grant.
   Do not commit version changes directly to protected `main`.

Public changelog/release text describes user-visible changes and limitations.
Keep owner-specific click instructions and synthetic test details in a private
handoff, using the authorized task or linked private tracker when available.
A missing private tracker does not prevent making that handoff in the task.

## 2. Tag the merged commit

Fetch the merged result. Verify the intended commit is on `origin/main`, its
package/lock/changelog versions match, and the release checks cover that code.
Record its SHA. Tag that explicit commit, not whichever branch happens to be
checked out:

```bash
git tag vX.Y.Z MERGED_COMMIT_SHA
git push origin vX.Y.Z
```

Replace both placeholders before running. Tag push is publication authority:
[release.yml](../.github/workflows/release.yml) will build and publish a public
pre-release. Do not push the tag before that outcome is authorized. Never move
an existing public tag to repair a release.

The workflow verifies tag/package agreement, builds Windows and Linux, and lets
electron-builder create the draft. It resolves that draft by release ID,
verifies the exact asset set, writes changelog notes, and publishes with
`draft: false`, `prerelease: true`. It does not build a public macOS release.
All current releases remain pre-releases; promotion is a separate decision.
Do not pre-create a competing draft or toggle release settings to skip this flow.

## 3. Verify publication

Monitor the workflow for the exact tag and SHA with a bounded deadline. Check
all jobs, including Linux package inspection and final publication. Failure,
timeout, missing results, or an ambiguous release is not success.

Read back the published release, preferably by its resolved numeric ID. Check
its tag/commit, public URL, `draft: false`, `prerelease: true`, body, and these
seven nonempty assets for the chosen version:

- `vrx-X.Y.Z-setup.exe`
- `vrx-X.Y.Z-setup.exe.blockmap`
- `VRX-X.Y.Z.exe`
- `vrx-X.Y.Z-x86_64.AppImage`
- `vrx_X.Y.Z_amd64.deb`
- `latest.yml`
- `latest-linux.yml`

The exact list is owned by `release.yml` and `electron-builder.yml`; keep both
and this guide aligned when packaging targets change. Verify updater manifests
identify the same version and matching package sizes/hashes. The Linux job
extracts AppImage and deb contents and checks launcher identity, desktop
metadata, 512px RGBA icon, package type, and updater metadata before publication.
Those checks prove package contents, not GNOME/KDE launch behavior.

An already published tag cannot be safely rerun as if it were a fresh draft:
electron-builder can skip uploads and leave stale binaries. Stop and diagnose;
do not delete releases, overwrite assets, or re-draft a public release under
ordinary rerun authority. Prefer an approved new patch version for a shipped fix.

## 4. Optional local packaging and installation

After the canonical gate, package on the corresponding operating system:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Choose the target command, not all three. macOS and Linux packaging scripts do
not repeat the full typecheck/test gate. Public Windows/Linux packages come
from the tag workflow; a local Mac build is a separate artifact.

Inspect the packaged version, required production modules/resources, font
licenses, and absence of test/guide bundles. Never count bundling or signing
alone as proof the app launches. Record host OS, architecture, source SHA,
package path, observed launch result, and any untested target. Current Mac
configuration disables notarization; do not describe that artifact as notarized.
Do not loosen sandbox, CSP, signing, or credential rules to make it launch.

Replace an installed app only when explicitly requested. Quit the running app,
keep a rollback copy outside application-search locations, replace the existing
installation rather than creating duplicates, and preserve user data/settings.
Verify there is one intended installed entry with the correct version, then
check launch. Real-account testing requires the task's appropriate authorization;
never publish private screenshots or credentials in release evidence.

## 5. Handoff

Report the version, merged source SHA, release URL, verified asset targets,
verification evidence, and material limitations. Provide a short test checklist
for the changed user flows and record owner feedback separately from automated
checks. Update the linked issue, if any, when access is available. Do not claim
an OS or live-account scenario was tested merely because CI packaged it.
