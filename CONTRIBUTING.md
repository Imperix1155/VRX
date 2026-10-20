# Contributing to VRX

VRX is a desktop social companion for VRChat and ChilloutVR with one owner.
Open an issue to discuss a substantial change before you start. Work the owner
assigned already has its scope and needs no new issue.

## Ground rules

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
- VRX signs in as the user on their own computer. Changes that add bot
  behavior, mass invites, or presence polling will be rejected.
- Read [AGENTS.md](AGENTS.md) and every nearer `AGENTS.md` on the path to the
  files you change. Those rules apply to every contributor, human or agent.
  Personal agent skills and integrations are optional.

## Setup and checks

Use Node.js **22.22.2 or a later 22.x patch** with npm (`.nvmrc` selects the
line). Run `npm ci`, then `npm run dev`. [Development](docs/DEVELOPMENT.md)
covers setup, focused checks, CI failures, and UI verification. The full gate
is:

```bash
npm run lint && npm run format:check && npm test && npm run build
```

`npm ci` also installs a pre-commit hook that scans staged changes with
[gitleaks](https://github.com/gitleaks/gitleaks#installing) when it is
installed. CI always scans, with or without the local tool.

## Branches and commits

Branch from the current `main`. Name the branch `imperix/vrx-XX-slug` when the
work has a Linear issue, or `imperix/<slug>` otherwise. Write commit messages
as [Conventional Commits](https://www.conventionalcommits.org/), with the
issue as the scope when there is one:

```text
feat(vrx-14): wire locale detection
fix: preserve the selected platform
chore: bump dependencies
```

## Pull requests and merging

Follow [Review](docs/REVIEW.md) before you open a PR. Fill in the PR template:
what changed and why, the checks you ran, review evidence, known limits, and
the linked issue if there is one. Update the docs your change affects (the
"Documentation sync" list in [AGENTS.md](AGENTS.md)) and say which docs you
left unchanged on purpose.

Everything reaches the protected `main` branch through a PR. Human
contributors don't merge their own PRs. An agent working for the owner merges only with the
owner's explicit permission and after the final-head checks in
[Review](docs/REVIEW.md#merge-checklist).

## Dependencies and security

Dependabot opens grouped minor and patch updates and separate major updates
for npm packages and GitHub Actions each week. Check compatibility and upstream
changes before accepting one, and explain why when an update doesn't fit.
[Development](docs/DEVELOPMENT.md#dependency-and-security-changes) covers
advisories and the narrow exception rule. Never relax a security gate to clear
the queue.

CI runs on every PR to `main` and every push to `main`: build and tests on
Windows and Ubuntu, a dependency audit, and a secret scan. CodeQL also runs
weekly. Never commit or log real credentials, tokens, or personal data.

## Releases

[Releasing](docs/RELEASING.md) is the complete procedure. In short: choose a
version, update `package.json`, the lockfile, and `CHANGELOG.md` in a version
PR, and merge it. Merging the version PR publishes the release: the
[release workflow](docs/RELEASING.md#2-tag-and-publish) creates the tag and
uploads the Windows and Linux builds. The changelog section for that version
must not be empty; the workflow never writes notes for you.
