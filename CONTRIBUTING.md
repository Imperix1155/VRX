# Contributing to VRX

Thanks for your interest in VRX — a local desktop social companion for VRChat and ChilloutVR.

VRX is currently in early development and maintained by a single owner. Contributions are welcome, but please open an issue to discuss anything substantial before opening a PR.

## Ground rules

- Be respectful — this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Found a security issue? **Do not** open a public issue — see [SECURITY.md](SECURITY.md).
- VRX authenticates as the user on their own machine. It is **not** a bot, server, or content uploader. Contributions that add botting, mass-invite, or polling behavior will be rejected.

## Development setup

```bash
npm install
npm run dev        # dev mode with HMR
```

## Branch naming

Branch off `main` using exactly:

```
imperix/vrx-XX-slug
```

where `vrx-XX` is the Linear issue number and `slug` is a short kebab-case description (e.g. `imperix/vrx-14-set-up-i18next-infrastructure`).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) and reference the issue in the scope when the work maps to one:

```
feat(vrx-14): wire i18next with OS-locale detection
fix(vrx-20): guard IPC sender on the friends channel
chore: bump dependencies
```

Common types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`.

## Before opening a PR

All three checks must pass locally:

```bash
npm run typecheck
npm run lint
npm test
```

Then:

- [ ] Branch named `imperix/vrx-XX-slug`
- [ ] Commits follow the convention above
- [ ] `typecheck`, `lint`, and `test` all pass
- [ ] No credentials, tokens, or PII logged; no hardcoded paths
- [ ] PR description explains what changed and links the issue

## Review & merge

The project owner reviews and merges all PRs. **Never self-merge.** `main` is branch-protected; open the PR, then wait for review. CI must be green before merge.

## Dependency & advisory triage

VRX handles user credentials, so supply-chain scanning is automated and treated as non-optional:

- **Dependabot** opens weekly grouped PRs for npm + GitHub Actions updates (minor/patch grouped; majors separate). Review the changelog, let CI run, and merge when green. Give majors a deliberate look.
- **`npm audit`** runs in CI and **fails the build on high/critical advisories**. To clear one: bump the dependency (or its parent), or — if it's a dev-only/unfixable false positive — explain the rationale in the PR. Don't disable the gate globally.
- **CodeQL** scans JS/TS on every push and PR; results appear under **Security → Code scanning**. Fix true positives; dismiss false positives with a stated reason.

A suspected exploitable vulnerability *in VRX itself* goes through [SECURITY.md](SECURITY.md) (private reporting), never a public issue.

## Versioning & releases

VRX follows [Semantic Versioning](https://semver.org) — `MAJOR.MINOR.PATCH`:

- **MAJOR** — changes a user would notice break (removed features, incompatible data).
- **MINOR** — backwards-compatible features.
- **PATCH** — backwards-compatible fixes.

Pre-1.0, breaking changes may still land in a MINOR bump.

Notable changes are recorded in [`CHANGELOG.md`](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/) format) under `[Unreleased]` as PRs merge. To cut a release:

1. Move the `[Unreleased]` entries into a new `## [X.Y.Z] - YYYY-MM-DD` section.
2. Bump `version` in `package.json` to `X.Y.Z` (the release pipeline fails fast if the tag and `package.json` disagree).
3. Commit, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The release pipeline builds the installers and publishes the GitHub Release, using that version's `CHANGELOG.md` section as the release notes (falling back to auto-generated notes if the section is missing).
