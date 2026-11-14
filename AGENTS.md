# VRX agent contract

VRX is a local Electron desktop companion for VRChat and ChilloutVR. It signs
in as the user on their own computer and shows their friends, presence,
worlds, instances and joins in one window. It is not a bot, server or content
uploader.

## Start here

This repository uses the [DOX framework](https://github.com/agent0ai/dox).
Read this contract and every nearer `AGENTS.md` on the path to each file you
edit. The closest contract owns local details; no child weakens DOX or the
security rules below. The code is the source of truth: read current source
instead of trusting another session's memory, an old plan or chat. A past
plan never overrides a current contract.

A fresh clone holds everything a contributor, human or agent, needs. Personal
skills, model choices, device permissions, trackers and orchestration are
optional local tools, never prerequisites. Repository instructions grant no
access to a device or external account.

| Read                                                                                  | For                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Development](docs/DEVELOPMENT.md), [Maintaining](docs/MAINTAINING.md)                | Setup, commands, tests; recipes and where to look.            |
| [Contributing](CONTRIBUTING.md)                                                       | Branches, commits, PRs.                                       |
| [Review](docs/REVIEW.md)                                                              | Review coverage and merge readiness.                          |
| [Releasing](docs/RELEASING.md)                                                        | Branch flow, versions, publishing.                            |
| [Design](docs/DESIGN.md), [visual guide](docs/design.html), [scenes](docs/glass.html) | The design language, its tokens, and live examples.           |
| [Internal API](docs/INTERNAL-API.md)                                                  | Every channel, event, hook, store, parser, service, constant. |
| [API policy](docs/api-policy.md), [API volatility](docs/api-volatility.md)            | Platform etiquette, limits, writes, uncertain assumptions.    |
| [Multi-account architecture](docs/architecture/multi-account.md)                      | Account identity, scoped storage, session boundaries.         |

## Architecture

- electron-vite, React 19, strict TypeScript, Tailwind CSS 4. The main process
  is `src/main`, the restricted bridge is `src/preload`, the UI is
  `src/renderer`.
- `src/shared` (`@shared`) holds pure cross-process types and values. No Node
  or Electron imports.
- Platform integrations go through adapters. Zustand owns view state; TanStack
  Query owns server and cache state. Reuse an existing interface before adding
  one.
- Use string-literal unions, not `const enum`. Use `app.getPath()` for storage
  and the redacting `electron-log` wrapper for logging. No `any` or
  `@ts-ignore` without a comment saying why.
- User-visible text lives in the English and Japanese translation files; a
  parity test keeps their keys in step.

## Design contract

Read [Design](docs/DESIGN.md) before UI work; its numbered Locked rules are
binding. Renderer components and `src/renderer/src/assets/main.css` are the
implementation, and the guide renders them with sample data. A known defect is
never a design rule.

- **Layered frosted glass** is the material: a canvas (aurora or the user's
  picture), frosted back panels and sheets, cards and rows as their own
  frosted pane, and glossy chips for pills and badges. Menus and dialogs keep
  an opaque backing. Names and custom status text stay plain text, never
  chips.
- Dark is the stylesheet baseline; the Theme setting defaults to System.
  Light overrides the same tokens under `[data-theme='light']`.
- Every color carries one meaning and has a non-color cue nearby: a word,
  glyph, shape or text. VRChat is blue and ChilloutVR is orange, following
  each brand. The one exception is the friends-list avatar ring and corner
  dot, which show presence by color alone; the written status is in friend
  details and the row's accessible label.
- VRChat and ChilloutVR are equal: same layout, fields, order, wording weight
  and feature parity wherever both support a feature. Don't invent a feature
  to hide a real platform difference. Flag anything that favors one.
- Simple by default, more on demand: few words up front; longer text, fine
  print and power options behind Show more, ?, Settings or About. Never force
  a tour; optional guidance has a visible skip.
- Use tokens for color and spacing. Keep existing controls reachable unless
  the owner approved removing them. Look at changed UI in both themes and at
  900×670; compiling proves nothing about rendering.
- App icon sources and exports follow [App icon](docs/APP-ICON.md).
- Name the platforms only, never the companies behind them.

## Security non-negotiables

- Keep every BrowserWindow at `contextIsolation: true`, `sandbox: true` and
  `nodeIntegration: false`. Guard every IPC handler with `isTrustedIpcSender`.
- Prefer OS-backed `safeStorage` for credentials. The local fallback uses
  authenticated encryption with a random installation key in private app
  files, only when OS encryption is unavailable or fails. Never encrypt with
  Electron `basic_text`, hardcode a key, or expose tokens to the renderer.
- Allowlist URLs before `shell.openExternal`. Never allow `unsafe-inline` in
  the shipped CSP; only the Vite dev server may relax `style-src` for HMR
  (`scripts/dev-style-csp.ts`, serve-only).
- Never log credentials, tokens or personal data. Never write to VRCX or
  ChilloutVR folders; read local VRCX, ChilloutVR or CVRX files only through
  the "Use my sign-in from" import, which runs only on that button press.
- Keep the packaged-app Electron fuses in `electron-builder.yml`, and keep
  repository docs, tooling and tests out of the package
  (`scripts/package-files.test.mjs` checks both).
- Never commit secrets. Keep the gitleaks, `check-secrets` and dependency
  gates; allowlist only confirmed fake fixture values, never whole paths.
- Describe security work in generic words ("security hardening") in commits,
  PRs, changelog, comments and docs. Never explain how a weakness could be
  used.
- No personal information about the owner or any user anywhere in the
  repository, history included.

## External API etiquette

- Never risk a user's account. Ask each platform for no more than VRCX and
  CVRX do.
- Use VRChat Pipeline and ChilloutVR `/users/ws` for live presence. Never poll
  friend status or add mass invites, bulk friend actions or other bot-like
  behavior.
- Respect the shared per-platform request queue: one request per second at
  most, exponential backoff, jitter, cooldowns and a proper User-Agent.
  Writes happen only on a user's press, once, never retried.
- Cancel obsolete work across session and account changes. Parse unknown
  values defensively; missing data never permits inventing a status or a join
  target.
- Update [API volatility](docs/api-volatility.md) when observed shapes or
  assumptions change, and [API policy](docs/api-policy.md) when etiquette,
  limits or writes change.

## Work and delivery

Start from a baseline: branch, dirty files, open PRs, worktrees. Preserve
others' work. Make the smallest coherent change that meets the request, and
state material assumptions. Whoever integrates parallel work owns the result.

Branch from `dev` and open PRs into `dev` ([branch flow](docs/RELEASING.md#branch-flow)).
Never push to `main`, `beta` or `dev` directly. Name branches
`imperix/vrx-XX-slug` (with an issue) or `imperix/<slug>`; a tool's own prefix
is fine. Write Conventional Commits.

An authorized implementation task includes branch commits, pushes, PRs and
review fixes unless it was limited to local work. Merging, publishing and
replacing an installed app need an explicit owner grant covering those
actions; carry an existing scoped grant forward without asking again. Review
feedback is not merge authority.

Pin third-party GitHub Actions to full SHAs with exact version comments. Keep
checkout credential persistence off unless the job pushes.

Comments cite tracker issues (`VRX-51`), audit rounds (`audit W5`) and past
reviewers. They are history labels; you don't need to look them up, and the
code and contracts are the record. When a test file you are adding to grows
past about 2,000 lines, split it into topic files
(`VrcAdapter.login.test.ts`) with shared fixtures in `__testutils__`.

## Verification and done

```bash
npm run verify   # lint, format:check, test, build; stops at the first failure
```

`build` includes both TypeScript checks and the entry-chunk assertion. App
changes also pass `npm run test:e2e` (the built app, fake platforms). Add
focused behavioral and runtime or UI evidence for the change; for a fix, show
the regression test failing without it when practical. Read exit codes; a
worker's claim is not proof. Documentation-only work uses the focused checks
in [Development](docs/DEVELOPMENT.md#verification). Record checks that
couldn't run; never label missing evidence as passing.

## Code Review Rules

- Review the actual diff and final head for acceptance, correctness,
  security, tests and documentation sync. Give file and line findings with a
  concrete failure and evidence; skip formatting preferences.
- Block credential exposure, wrong-account actions, unsafe IPC or window
  settings, unallowlisted URLs, presence polling, request amplification, data
  loss, crashes and writes to VRCX or ChilloutVR data.
- Critical risk is a credible path to an unusable app or an endangered
  platform account. Judge consequences, not filenames.
- Check process boundaries, strict types, both platforms, session ownership,
  dark and light parity, catalog entries and the documentation list below.
- Automated reviewers are advisory; resolve or refute their real findings.
  Missing bot output is unavailable evidence, not a clean review.
  [Review](docs/REVIEW.md) has the full process.

## Documentation sync

After every meaningful change, do a DOX pass: update the closest owning
contract when purpose, structure, constraints or workflow change, refresh
indexes, and delete stale or contradictory text. Create a child contract only
for a durable ownership boundary (Purpose, Ownership, Local Contracts, Work
Guidance, Verification, Child DOX Index). Detailed API entries belong in the
catalog; history belongs in version control. Update in the same PR:

- IPC, bridge, events, hooks, stores, parsers, services, shared constants:
  the matching section file in `docs/internal-api/` (index:
  `docs/INTERNAL-API.md`).
- Visual or interaction design: `docs/DESIGN.md` and the guide in
  `docs/guide`. A token change in `main.css` also runs
  `npm run design:tokens`.
- Platform API assumptions: `docs/api-volatility.md`; policy, limits and
  writes: `docs/api-policy.md`.
- User-visible behavior: `CHANGELOG.md`, plus `README.md` or
  `docs/INSTALL.md` when what users see or do changes.
- Directory purpose, contracts, workflows: the nearest `AGENTS.md`.
- Setup, stack, commands, links: `README.md` and `docs/DEVELOPMENT.md`.

Report docs you left unchanged on purpose. Don't duplicate a procedure; link
its owner. Keep every root-to-leaf contract chain below 32 KiB so agents with
bounded instruction loading get every rule.

## Child DOX Index

- [Build assets](build/AGENTS.md): icon sources, native exports, packaging
  resources.
- [Shared](src/shared/AGENTS.md): pure cross-process contracts and constants.
- [Main](src/main/AGENTS.md): main process and preload, security, services,
  adapters, platform writes.
- [Renderer](src/renderer/AGENTS.md): UI, state, design tokens, interactions.
- [Design guide](docs/guide/AGENTS.md): sample-data scenes built from real
  components, the token generator and doc-sync tests.
