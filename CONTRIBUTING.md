# Contributing to VRX

VRX is a desktop companion for VRChat and ChilloutVR with one owner. Open an
issue to talk about a large change before you start. Work the owner already
asked for has its scope and needs no new issue.

## Ground rules

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security problems privately, as [SECURITY.md](SECURITY.md) describes.
- VRX signs in as the user on their own computer. Bot behavior, mass invites,
  bulk friend actions and presence polling will be rejected, and so will
  anything that asks a platform for more than VRCX or CVRX do.
- Read [AGENTS.md](AGENTS.md) and every nearer `AGENTS.md` on the path to the
  files you change. Those rules apply to every contributor, human or agent.
  Personal agent skills, trackers and other integrations are optional.
- UI work follows [DESIGN.md](docs/DESIGN.md). Look at it in the
  [design guide](docs/DEVELOPMENT.md#design-guide) in both themes.

## Setup and checks

Use Node.js **22.22.2 or a later 22.x patch** with npm (`.nvmrc` selects the
line). Run `npm ci`, then `npm run dev`. [Development](docs/DEVELOPMENT.md)
covers every command, focused checks, CI failures and UI verification. The
gate for every change to the app, build or CI is:

```bash
npm run verify   # lint, format:check, test, build
```

`npm ci` also installs a pre-commit hook that scans staged changes with
[gitleaks](https://github.com/gitleaks/gitleaks#installing) when it is
installed. CI always scans, with or without the local tool.

## Branches

VRX has three long-lived branches, one per update channel:

| Branch | Holds                                  | Takes pull requests from               |
| ------ | -------------------------------------- | -------------------------------------- |
| `dev`  | Everything merged since the last build | Feature and fix branches               |
| `beta` | Beta test builds (rarely used)         | Version PRs, dependency PRs            |
| `main` | Released stable code                   | Release PRs from `dev`, dependency PRs |

Start new work from the latest `dev` and open the pull request into `dev`:

```bash
git fetch origin dev
git switch -c imperix/<short-slug> origin/dev
```

Name a branch `imperix/vrx-XX-slug` when it has a tracker issue, or
`imperix/<slug>` otherwise. Agent tools that pick their own branch prefix are
fine; say what the branch is for in the PR. Never push to `main`, `beta` or
`dev` directly. [Releasing](docs/RELEASING.md) explains how `dev` reaches
`main`.

## Commits

Write [Conventional Commits](https://www.conventionalcommits.org/), with the
issue as the scope when there is one:

```text
feat(friends): add an order control
fix(vrx-14): keep the selected platform after a restart
docs: rewrite the design guide
chore(release): 1.4.0-dev.14
```

## Pull requests and merging

Follow [Review](docs/REVIEW.md) before you open a PR, and fill in the PR
template: what changed and why, the checks you ran, review evidence, known
limits, and the linked issue if there is one. Update the docs your change
affects (the "Documentation sync" list in [AGENTS.md](AGENTS.md)) and say
which docs you left unchanged on purpose.

Human contributors don't merge their own PRs. An agent working for the owner
merges only with the owner's permission and after the final-head checks in
[Review](docs/REVIEW.md#merge-checklist).

## Dependencies and security

Dependabot opens grouped minor and patch updates and separate major updates
for npm packages and GitHub Actions each week, against each of `main`,
`beta` and `dev`. Check
compatibility and upstream changes before accepting one, and explain why when
an update doesn't fit. [Development](docs/DEVELOPMENT.md#dependency-and-security-changes)
covers advisories. Never relax a security gate to clear the queue.

CI runs on every push and every pull request: build and tests on Windows and
Ubuntu, a dependency audit and a secret scan. CodeQL runs on `main` and
weekly. Never commit or log real credentials, tokens or personal data.

## Releases

[Releasing](docs/RELEASING.md) is the full procedure. In short: a version PR
changes `package.json`, the lockfile and `CHANGELOG.md`, and merging it
publishes that version. The changelog section for the version must not be
empty; the workflow never writes notes for you.
