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
