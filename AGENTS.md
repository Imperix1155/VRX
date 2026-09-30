# VRX agent contract

VRX is a local Electron companion for VRChat and ChilloutVR. It authenticates
as the user on their machine and presents their friends, presence, worlds,
instances, and invites. It is not a bot, server, or content uploader.

## Start here

This repository uses the [DOX framework](https://github.com/agent0ai/dox).
Read this contract and every nearer `AGENTS.md` on the path to each file you
edit. The closest contract owns local details; no child weakens DOX or the
security rules below. Inspect current source instead of relying on another
session's memory.

A fresh clone contains the project instructions needed by any coding agent or
human contributor. Personal skills, model choices, device permissions, account
integrations, and orchestration belong to the contributor's local setup. They
are optional tools, not prerequisites for building, reviewing, or releasing VRX.
Repository instructions do not grant access to a device or external account.

- [Development](docs/DEVELOPMENT.md): install, develop, test, diagnose CI.
- [Review](docs/REVIEW.md): review coverage and merge readiness.
- [Releasing](docs/RELEASING.md): version, package, publish, verify.
- [Contributing](CONTRIBUTING.md): branch and contribution conventions.
- [Design](docs/DESIGN.md), [visual guide](docs/design.html), and
  [component scenes](docs/glass.html): UI rules and examples.
- [Internal API](docs/INTERNAL-API.md): look up the relevant symbol and process
  section before adding a channel, event, hook, store, parser, service, or constant.
- [API policy](docs/api-policy.md) and [volatility](docs/api-volatility.md):
  platform behavior, limits, and uncertain assumptions.

Historical plans and receipts describe past work. They do not override current
contracts or require access to the author's machine, skills, or old artifacts.

## Architecture

- electron-vite, React 19, strict TypeScript. Main is `src/main`, the restricted
  bridge is `src/preload`, and UI is `src/renderer`.
- `src/shared`, imported through `@shared`, contains pure cross-process types
  and values. No Node or Electron imports.
- Platform integrations use adapters. Zustand owns view state; TanStack Query
  owns server/cache state. Reuse existing interfaces before introducing another.
- Prefer string-literal unions over `const enum` for esbuild and Zod safety.
- Use `app.getPath()` for app storage and `electron-log` with redaction for
  logging. Do not add `any` or `@ts-ignore` without an explanation comment.

## Design contract

Read the three design documents before UI work. Renderer components and
`src/renderer/src/assets/main.css` define the current implementation. The guide
uses those components with synthetic data; known defects are not design rules.

- Liquid glass is the material. Dark is the stylesheet baseline; the Theme
  preference defaults to System. Light uses `[data-theme="light"]` parity
  overrides.
- Color communicates meaning in a consistent location, with a non-color label
  or glyph. VRChat is blue; ChilloutVR is orange. Treat both platforms equally.
- Background color must not alter information-bearing cards or panels. Neutral
  sheen can vary; decorative chrome such as the sidebar may retain ambient color.
- Presence `state` and VRChat `status` are separate axes. Use the avatar ring
  fold and written drawer status, not the old row dot/status-pill examples.
- Use tokens for color and spacing. Preserve access to existing controls and
  workflows unless removal was approved. Observe changed UI in both themes and
  relevant window sizes; compilation alone does not prove rendering.

## Security non-negotiables

- Keep BrowserWindows at `contextIsolation: true`, `sandbox: true`, and
  `nodeIntegration: false`. Guard every IPC handler with `isTrustedIpcSender`.
- Prefer OS-backed `safeStorage` for credentials. The existing local fallback
  uses authenticated encryption and a random installation key in private app
  files when OS encryption is unavailable or fails. It is weaker: possession of
  both key and ciphertext permits session recovery. Never encrypt with Electron
  `basic_text`, hardcode a key, or expose tokens to the renderer.
- Allowlist URLs before `shell.openExternal`. Do not permit `unsafe-inline` in CSP.
- Never log credentials, tokens, or PII. Never write to VRCX or CVRX folders.
- Never commit secrets. Keep gitleaks and dependency/security CI gates. Allowlist
  only confirmed fake fixture values, never whole paths.

## External API etiquette

- Use VRChat Pipeline and CVR `/users/ws` for live presence. Do not poll friend
  status or implement mass invites or other bot-like behavior.
- Respect the shared per-platform request queue and one-request-per-second
  ceiling, exponential backoff, jitter, cooldowns, and a proper User-Agent.
- Cancel obsolete work across session/account changes. Parse unknown values
  defensively; missing data is not permission to invent a status or join target.
- Update API volatility documentation when observed shapes or assumptions
  change, and API policy when etiquette or policy changes.

## Work and delivery

Establish a baseline and inspect branch, dirty files, active PRs, and worktrees.
Preserve others' work. Make the smallest coherent change that meets the request;
state material assumptions and tradeoffs. Independent workers may use separate
worktrees, but the integrating contributor owns the combined result.

Use a feature branch and PR. Never commit or push directly to protected `main`.
An authorized implementation task includes ordinary branch commits, pushes,
PRs, and review fixes unless restricted to local work. Merge, public release,
and replacement of an installed app require an explicit owner grant covering
those actions. Carry an existing scoped grant forward without repeated approval.
Local tools and branch protection remain separate enforcement boundaries.

Use `imperix/vrx-XX-slug` with a Linear issue or `imperix/<slug>` without one,
and Conventional Commits with the issue reference when applicable. A tracker
is optional. Link existing GitHub or Linear issues and update them when access
is available; missing tracker access does not prevent repository work.

Before a PR, follow [Review](docs/REVIEW.md). Merge only with owner authority,
review coverage through the exact final head, passing applicable local and
required CI checks, and no unresolved material defect or uncertainty. Review
feedback is not merge authority. Publish through [Releasing](docs/RELEASING.md).

Pin third-party GitHub Actions to full SHAs with exact version comments.
Keep checkout credential persistence off unless the job intentionally pushes.

## Verification and done

The canonical application/build/CI gate is:

```bash
npm run lint && npm run format:check && npm test && npm run build
```

`build` includes both TypeScript checks and the entry-chunk assertion. Add
focused behavioral and runtime/UI evidence for the changed feature. For fixes,
show that the regression test fails without the fix when practical. Read exit
statuses; silence or a worker's claim is not proof.

Documentation-only work uses the focused checks in
[Development](docs/DEVELOPMENT.md#verification). Policy edits also need realistic
workflow scenarios. Required PR CI still applies. Record checks that could not
run and their effect on confidence; do not label unavailable evidence as passing.

## Code Review Rules

- Review the actual diff and final head for acceptance, correctness, security,
  tests, and documentation sync. Give actionable file/line findings with a
  concrete failure mode and evidence. Do not repeat formatting preferences.
- Block credential exposure, wrong-account actions, unsafe IPC/window settings,
  unallowlisted URLs, presence polling, request amplification, data loss,
  crashes, and writes to VRCX/CVRX data.
- Critical risk means a credible path to an unusable app or a user's platform
  account being endangered. Classify consequences, not filenames. Essential
  controls disappearing can be critical even when the process still launches.
- Check main/preload/renderer boundaries, strict types, both VR platforms,
  session ownership, dark/light parity, and relevant behavioral tests.
- Check reuse/catalog entries for new interfaces and the documentation matrix
  below. Known app defects must not become design requirements.
- Automated PR reviewers are advisory at every risk level. Inspect available
  findings and resolve or refute material ones. Absent or quota-limited output
  is unavailable evidence, not a clean review or a reason to wait by itself.
- [Review](docs/REVIEW.md) defines review coverage, critical-risk evidence,
  correction review, and merge checks without requiring a particular agent.

## Documentation sync

After every meaningful change, perform a DOX pass. Update the closest owning
contract when purpose, structure, constraints, or workflow changes. Refresh
parent/child indexes and delete stale or contradictory instructions. Create a
child contract only for a durable ownership boundary; use Purpose, Ownership,
Local Contracts, Work Guidance, Verification, Child DOX Index where applicable.
Keep contracts concise and current; detailed API entries belong in the catalog,
and historical reasoning belongs in records and version control.

Update in the same PR:

- IPC, bridge, events, hooks, stores, parsers, services, shared constants:
  `docs/INTERNAL-API.md`.
- Visual or interaction design: `docs/DESIGN.md`, `docs/design.html`,
  `docs/glass.html`, and their shared guide implementation.
- Platform API assumptions: `docs/api-volatility.md`; policy changes also update
  `docs/api-policy.md`.
- User-visible app behavior: `CHANGELOG.md`.
- Directory purpose, contracts, workflows: nearest `AGENTS.md` and indexes.
- Project facts, setup, stack, feature status, links: `README.md` and owning
  development documentation.

Report intentionally unchanged docs. Avoid duplicating a procedure across files;
link its owner. Keep every root-to-leaf contract chain comfortably below 32 KiB
so agents with bounded instruction loading receive the complete rules.

## Child DOX Index

- [Shared](src/shared/AGENTS.md): pure cross-process contracts and constants.
- [Main](src/main/AGENTS.md): main process and preload, security, services, adapters.
- [Renderer](src/renderer/AGENTS.md): UI, state, design tokens, interactions.
- [Design guide](docs/guide/AGENTS.md): synthetic real-component examples and isolation.

`src/preload` is owned by the main contract. The placeholder `src/main/platform`
and `src/renderer/src/routes` directories do not need separate contracts.
