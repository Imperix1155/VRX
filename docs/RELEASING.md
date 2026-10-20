# Releasing VRX

This procedure works from a fresh clone with Git, the documented Node/npm
toolchain, and GitHub access to the repository. No personal release skill or
Mac build is needed. [Review](REVIEW.md) and [Development](DEVELOPMENT.md)
come first.

A request to implement something doesn't authorize merging, publishing, or
replacing someone's installed app. When the owner grants a delivery step,
carry that grant through the steps it covers without asking again, and leave
every other step pending.

## 1. Prepare a version PR

1. Fetch the current `main`. Check open PRs and the last published release,
   and settle what the release includes: every user-visible change since the
   last public release, not only the latest test build.
2. On a feature branch, pick a [SemVer](https://semver.org/) version. New
   features bump MINOR; compatible fixes bump PATCH; breaking changes bump
   MAJOR. Use `-beta.N` or `-rc.N` for a test build (section 2). Never reuse a
   version that was already published.
3. Run `npm version X.Y.Z --no-git-tag-version` with your version. Check that
   `package.json` and both root version fields in `package-lock.json` agree,
   and that nothing else in the lockfile changed.
4. In `CHANGELOG.md`, move every applicable `[Unreleased]` entry under
   `## [X.Y.Z] - YYYY-MM-DD` and leave a fresh empty `[Unreleased]` heading. Do
   this for owner test builds too, so their packaged notes are right.
5. Run `node scripts/extract-changelog.mjs X.Y.Z` and check that it prints the
   notes for this release. If extraction is empty or fails, the workflow leaves
   the release body unchanged; it never writes notes for you.
6. Run the full [development gate](DEVELOPMENT.md#verification), review the
   exact diff, open the version PR, and wait for CI on its final head.
   **Merging a version PR publishes that version** (section 2), so merge it
   only with the owner's permission to release in that channel. Never commit a
   version change directly to `main`.

Public changelog and release text describe user-visible changes and known
limits. Keep owner-specific test steps and sample data out of it; put them in
the task or a private tracker.

## 2. Tag and publish

The tag is created for you. When a push to `main` changes the `package.json`
version and no `v<version>` tag exists yet,
[release.yml](../.github/workflows/release.yml) creates that tag at the merge
commit, then builds and publishes it in the same run. A tag the workflow
creates doesn't start a second run. Pushes that leave the version unchanged
(dependency bumps, workflow edits) never publish.

**CI gate.** Before it creates or uses a tag, the workflow requires the commit
to be on `main` with a passing `ci-success` check on that exact commit
([scripts/require-green-ci.mjs](../scripts/require-green-ci.mjs)). After a
merge, CI and Release start together, so `prepare tag` waits up to 60 minutes
for CI. A failed, cancelled, or missing `ci-success` stops the run before
anything is tagged or built. Fix the cause on `main` with a new version, or,
if CI passes on a re-run of the same commit, re-run the Release run's failed
jobs. CI runs for `main` are never cancelled by a newer push, so every merge
commit gets a result.

After merging, find the Release run for the merge commit and confirm that
`prepare tag` created `vX.Y.Z` at the intended commit. If a build job fails,
fix the cause and re-run that run's failed jobs. The **Run workflow** button
publishes `main`'s current version only when its tag doesn't exist yet, for
example if the automatic run never started. It is a publication like any
other and needs the same permission. Pushing a tag yourself also works for a
commit already on `main`:

```bash
git tag vX.Y.Z MERGED_COMMIT_SHA
git push origin vX.Y.Z
```

Never move an existing public tag to repair a release; ship a new version.

The workflow checks that the tag matches the package version, builds Windows
and Linux, and lets electron-builder create a draft release. It then finds that
draft by its ID, checks the exact asset list, writes the changelog notes, and
publishes it. No macOS build is published. The tag decides the channel:

| Tag             | Marked pre-release | Updater files                    |
| --------------- | ------------------ | -------------------------------- |
| `vX.Y.Z`        | No                 | `latest.yml`, `latest-linux.yml` |
| `vX.Y.Z-beta.N` | Yes                | `beta.yml`, `beta-linux.yml`     |
| `vX.Y.Z-rc.N`   | Yes                | `rc.yml`, `rc-linux.yml`         |

`N` is a whole number with no leading zeros. Any other suffix or build
metadata is rejected. [scripts/release-channel.mjs](../scripts/release-channel.mjs)
owns this validation and the asset list. Normal installs ignore pre-releases.
Beta installs get newer betas and normal releases. Release-candidate installs
stay on release candidates, including later version lines, until someone
installs a normal release by hand; changing that needs an owner decision.
Don't create a competing draft or change release settings to skip this flow.

## 3. Verify publication

Watch the workflow for the exact tag and commit, with a deadline. Check every
job, including the Linux package inspection and the final publish. A failure,
timeout, missing result, or unclear release is not a success.

Read the published release back, preferably by its ID. Check its tag and
commit, public URL, that it is not a draft, the right pre-release flag, the
notes, and these seven non-empty assets:

- `vrx-X.Y.Z-setup.exe`
- `vrx-X.Y.Z-setup.exe.blockmap`
- `VRX-X.Y.Z.exe`
- `vrx-X.Y.Z-x86_64.AppImage`
- `vrx_X.Y.Z_amd64.deb`
- `CHANNEL.yml`
- `CHANNEL-linux.yml`

`CHANNEL` is `latest`, `beta`, or `rc` from the table above. Keep
`scripts/release-channel.mjs`, `electron-builder.yml`, and this list in step
when packaging targets change. Check that the updater files name the same
version with matching sizes and hashes. The Linux job unpacks the AppImage
and deb and checks the launcher, desktop entry, 512 px icon, package type,
and updater metadata before publishing. That proves what is in the package,
not that it launches on every desktop.

Never re-run an already published tag as if it were a fresh draft:
electron-builder may skip uploads and leave old files behind. Stop and find
the cause. Don't delete releases, overwrite assets, or turn a public release
back into a draft under ordinary re-run permission. Ship a fix as a new patch
version.

## 4. Optional local packaging

After the full gate, package on the matching operating system:

```bash
npm run build:win
npm run build:linux
npm run build:mac
```

Run only the one you need. Public Windows and Linux packages come from the
release workflow; a local Mac build is a separate, unpublished artifact. Mac
notarization is off, so never call that build notarized.

Check the packaged version, the required production modules and resources,
the font licenses, and that no tests, design guide, or repository docs are
inside. Packaging or signing alone never proves the app launches. Record the
OS, architecture, source commit, package path, what happened at launch, and
anything untested. Never loosen the sandbox, CSP, signing, or credential rules
to make a build launch.

Replace an installed app only when asked. Quit it, keep a rollback copy
outside places where the OS looks for apps, replace the existing install
instead of adding a second one, and keep user data and settings. Then check
that one install with the right version exists and that it launches. Testing
with real accounts needs the task's permission; never publish private
screenshots or credentials as release evidence.

## 5. Before the first stable release (1.0.0)

Windows is the main target. On a clean, supported Windows machine, check:
installer, launch, sign-in and session restore after restart, tray recovery,
a consented update from an earlier installer, settings and data kept after
the update, uninstall, and the portable build. Use only authorized test
accounts. Confirm that a normal install isn't offered a beta or release
candidate, and that beta and release-candidate updater files download the
right installer. Check signing and SmartScreen behavior on the file people
will actually download. Mac tests and packaging CI don't replace these checks.

Linux AppImage and deb packages stay marked as less tested until launch,
saved-session persistence, and updates are checked on target desktops. macOS
is a local development build, not a release target. See the
[install guide](INSTALL.md).

## 6. Handoff

Report the version, merge commit, release URL, verified assets, the evidence
you collected, and known limits. Give the owner a short test list for the
changed features, and record their feedback separately from automated checks.
Update the linked issue when there is one. Never claim an OS or live-account
scenario was tested just because CI packaged it.
