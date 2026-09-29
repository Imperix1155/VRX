# Contributing to VRX

VRX is a local desktop social companion for VRChat and ChilloutVR, maintained
by one owner. Discuss substantial unsolicited changes in an issue before
opening a PR. An owner-assigned task already supplies its scope; it does not
need a new issue just to begin.

## Ground rules

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report suspected vulnerabilities privately through [SECURITY.md](SECURITY.md).
- VRX authenticates on the user's own machine. Botting, mass invites, and
  polling social presence are outside the app's purpose.
- Read [AGENTS.md](AGENTS.md) and the contracts on the path to your edits.
  Project requirements apply to every contributor. Personal agent skills and
  integrations are optional, and device permissions remain local.

## Setup and verification

Use Node.js **22.22.2 or a later 22.x patch** and npm. `.nvmrc` selects the
supported line. Start with `npm ci`, then `npm run dev`.
[Development](docs/DEVELOPMENT.md) owns setup, focused checks, CI diagnostics,
UI verification, and the documentation-only exception. The application gate is:

```bash
npm run lint && npm run format:check && npm test && npm run build
```

`build` includes typechecks. Install gitleaks for local secret scanning; the
pre-commit hook is configured during dependency installation. CI scanning
remains required when local gitleaks is unavailable.

## Branches and commits

Branch from current `main`. Use `imperix/vrx-XX-slug` when work has a Linear
issue, or `imperix/<slug>` otherwise. A GitHub or Linear issue is optional.
Use [Conventional Commits](https://www.conventionalcommits.org/), including an
issue scope when applicable:

```text
feat(vrx-14): wire locale detection
fix: preserve the selected platform
chore: bump dependencies
```

## Pull requests and merge

Follow [Review](docs/REVIEW.md) before opening a PR. Describe the concrete
problem and resulting behavior, relevant checks, review evidence, limitations,
and linked issue when one exists. Complete the DOX pass and explain intentionally
unchanged docs. Keep commits coherent and preserve others' work.

All changes enter protected `main` through a PR. Human contributors do not
self-merge. An owner-operated agent can merge only under explicit owner authority
and the final-head checks in the review guide. An active scoped grant does not
need to be repeated, but it never replaces required evidence or tool access.

## Dependencies and security

Dependabot proposes grouped minor/patch and separate major updates for npm and
GitHub Actions. Evaluate compatibility and upstream changes, verify useful
updates, and document unsuitable ones. [Development](docs/DEVELOPMENT.md#dependency-and-security-changes)
owns advisory handling and narrow exceptions. Do not relax security gates to
clear a queue. Reporting a vulnerability in VRX uses the private security policy.

CI and secret scanning run on PRs targeting main and pushes to main. CodeQL
also runs weekly. Secrets use main-process credential storage, with OS encryption
preferred and the documented authenticated local fallback when unavailable.
Never log or commit real credentials, tokens, or personal data.

## Releases

[Releasing](docs/RELEASING.md) is the complete procedure: select a version,
synchronize package and lockfile metadata and changelog, review and merge the
version PR, tag the merged commit, then verify publication and assets.
A nonempty changelog section is required preparation; automatic notes are not
a fallback. The current workflow publishes Windows and Linux pre-releases.
Local Mac packaging and installation are separate, explicitly requested steps.
