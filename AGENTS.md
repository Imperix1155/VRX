# VRX agent contract

VRX is a local Electron desktop companion for VRChat and ChilloutVR. It signs
in as the user on their own computer and shows their friends, presence,
worlds, instances, and joins in one window. It is not a bot, server, or
content uploader.

## Start here

This repository uses the [DOX framework](https://github.com/agent0ai/dox).
Read this contract and every nearer `AGENTS.md` on the path to each file you
edit. The closest contract owns local details; no child weakens DOX or the
security rules below. The code is the source of truth: inspect current source
instead of trusting another session's memory, an old plan, or chat.

A fresh clone holds everything a contributor, human or agent, needs. Personal
skills, model choices, device permissions, account integrations, and
orchestration are optional local tools, never prerequisites for building,
reviewing, or releasing VRX. Repository instructions grant no access to a
device or external account.

- [Development](docs/DEVELOPMENT.md): install, run, test, diagnose CI.
- [Review](docs/REVIEW.md): review coverage and merge readiness.
- [Releasing](docs/RELEASING.md): version, package, publish, verify.
- [Contributing](CONTRIBUTING.md): branch, commit, and PR conventions.
- [Design](docs/DESIGN.md), [visual guide](docs/design.html), and
  [component scenes](docs/glass.html): UI rules and live examples.
- [Internal API](docs/INTERNAL-API.md): look up the symbol and process before
  adding a channel, event, hook, store, parser, service, or constant.
- [API policy](docs/api-policy.md) and [API volatility](docs/api-volatility.md):
  platform etiquette, limits, and uncertain assumptions.
- [Multi-account architecture](docs/architecture/multi-account.md): account
  identity, scoped storage, and session boundaries.

Git history holds past plans and decisions. They never override a current
contract.

## Architecture

- electron-vite, React 19, strict TypeScript. The main process is `src/main`,
  the restricted bridge is `src/preload`, and the UI is `src/renderer`.
- `src/shared`, imported as `@shared`, holds pure cross-process types and
  values. No Node or Electron imports.
- Platform integrations go through adapters. Zustand owns view state; TanStack
  Query owns server and cache state. Reuse an existing interface before adding
  another.
- Use string-literal unions, not `const enum`, for esbuild and Zod safety.
- Use `app.getPath()` for app storage and the redacting `electron-log` wrapper
  for logging. Don't add `any` or `@ts-ignore` without a comment saying why.
- User-visible text lives in the English and Japanese translation files; a
  parity test keeps their keys in step.

## Design contract

Read [Design](docs/DESIGN.md) before UI work. Renderer components and
`src/renderer/src/assets/main.css` are the implementation; the guide renders
those components with sample data. A known defect is never a design rule.

- Liquid glass is the material. Dark is the stylesheet baseline; the Theme
  setting defaults to System. Light mode uses `[data-theme="light"]`
  overrides of the same tokens.
- Every color carries meaning in a consistent place and has a non-color cue
  nearby: a label, glyph, shape, or text. VRChat is blue and ChilloutVR is
  orange, following each platform's brand. The one deliberate exception is the
  friend-list avatar ring and corner marker, which show presence by color
  alone; the written status is in the friend details panel and the row's
  accessible label.
- VRChat and ChilloutVR are equal: the same treatment, wording weight, and
  feature parity wherever both platforms support a feature. Flag anything that
  favors one, including the app icon.
- Simple by default, more on demand: show what most people need in few words,
  and put longer explanations, fine print and power-user options behind a Show
  more or ? control, Settings, or About. Required notices stay reachable.
- Background color must not change information-bearing cards or panels.
  Neutral sheen can vary; decorative chrome such as the sidebar may take on
  ambient color.
- Presence state and VRChat status are separate inputs. Show them with the
  avatar ring and the written status in the friend details panel.
- App icon sources and exports follow [App icon](docs/APP-ICON.md). Keep the
  optical small sizes and regenerate outputs with their SVG masters.
- Use tokens for color and spacing. Keep existing controls and workflows
  reachable unless the owner approved removing them. Look at changed UI in both
  themes and at the relevant window sizes; compiling proves nothing about
  rendering.

## Security non-negotiables

- Keep every BrowserWindow at `contextIsolation: true`, `sandbox: true`, and
  `nodeIntegration: false`. Guard every IPC handler with `isTrustedIpcSender`.
- Prefer OS-backed `safeStorage` for credentials. The existing local fallback
  uses authenticated encryption with a random installation key in private app
  files when OS encryption is unavailable or fails. It is weaker: whoever has
  both the key and the ciphertext can recover the session. Never encrypt with
  Electron `basic_text`, hardcode a key, or expose tokens to the renderer.
- Allowlist URLs before `shell.openExternal`. Never allow `unsafe-inline` in
  the shipped CSP. Only the Vite dev server may relax `style-src` for HMR
  (`scripts/dev-style-csp.ts`, serve-only, never in a build).
- Never log credentials, tokens, or personal data. Never write to VRCX or
  ChilloutVR folders; read local VRCX, ChilloutVR or CVRX files only through
  the "Use my sign-in from this PC" import, which runs only on that button
  press.
- Keep the packaged-app Electron fuses in `electron-builder.yml`
  (`electronFuses`, checked by `scripts/package-files.test.mjs`).
- Never commit secrets. Keep the gitleaks and dependency/security CI gates.
  Allowlist only confirmed fake fixture values, never whole paths.
- Keep repository docs, tooling, and tests out of the packaged app
  (`electron-builder.yml` `files`, checked by `scripts/package-files.test.mjs`).

## External API etiquette

- Use VRChat Pipeline and ChilloutVR `/users/ws` for live presence. Never poll
  friend status or add mass invites or other bot-like behavior.
- Respect the shared per-platform request queue with its one-request-per-second
  ceiling, exponential backoff, jitter, cooldowns, and a proper User-Agent.
- Cancel obsolete work across session and account changes. Parse unknown
  values defensively; missing data is never permission to invent a status or
  a join target.
- Update [API volatility](docs/api-volatility.md) when observed shapes or
  assumptions change, and [API policy](docs/api-policy.md) when etiquette or
  policy changes.

## Work and delivery

Start from a baseline: check the branch, dirty files, open PRs, and worktrees.
Preserve others' work. Make the smallest coherent change that meets the
request, and state material assumptions and tradeoffs. Independent workers may
use separate worktrees; whoever integrates owns the combined result.

Use a feature branch and PR. Never commit or push directly to the protected
`main`. An authorized implementation task includes ordinary branch commits,
pushes, PRs, and review fixes unless it was limited to local work. Merging,
public releases, and replacing an installed app need an explicit owner grant
that covers those actions. Carry an existing scoped grant forward without
asking again. Local tools and branch protection remain separate safeguards.

Name branches `imperix/vrx-XX-slug` with a Linear issue or `imperix/<slug>`
without one, and write Conventional Commits with the issue as scope when there
is one. A tracker is optional: link and update existing GitHub or Linear
issues when you can reach them, and don't let missing tracker access block
repository work.

Before a PR, follow [Review](docs/REVIEW.md). Merge only with owner authority,
review coverage through the exact final head, passing local and required CI
checks, and no unresolved material defect or uncertainty. Review feedback is
not merge authority. Publish through [Releasing](docs/RELEASING.md).

Pin third-party GitHub Actions to full SHAs with exact version comments. Keep
checkout credential persistence off unless the job intentionally pushes.

## Verification and done

The application, build, and CI gate is:

```bash
npm run lint && npm run format:check && npm test && npm run build
```

`build` includes both TypeScript checks and the entry-chunk assertion. Add
focused behavioral and runtime or UI evidence for the changed feature. For a
fix, show the regression test failing without the fix when practical. Read
exit codes; silence or a worker's claim is not proof.

Documentation-only work uses the focused checks in
[Development](docs/DEVELOPMENT.md#verification). Policy edits also need
realistic workflow scenarios. Required PR CI still applies. Record checks that
couldn't run and what that does to confidence; never label unavailable
evidence as passing.

## Code Review Rules

- Review the actual diff and final head for acceptance, correctness, security,
  tests, and documentation sync. Give actionable file and line findings with a
  concrete failure mode and evidence. Don't repeat formatting preferences.
- Block credential exposure, wrong-account actions, unsafe IPC or window
  settings, unallowlisted URLs, presence polling, request amplification, data
  loss, crashes, and writes to VRCX or ChilloutVR data.
- Critical risk means a credible path to an unusable app or to a user's
  platform account being endangered. Classify consequences, not filenames.
  Essential controls disappearing can be critical even when the app launches.
- Check main, preload, and renderer boundaries, strict types, both platforms,
  session ownership, dark and light parity, and relevant behavioral tests.
- Check catalog entries for new interfaces and the documentation list below.
  Known app defects must not become design requirements.
- Automated PR reviewers are advisory at every risk level. Inspect their
  findings and resolve or refute the material ones. Missing or quota-limited
  output is unavailable evidence, not a clean review or a reason to wait.
- [Review](docs/REVIEW.md) defines review coverage, critical-risk evidence,
  correction review, and merge checks without requiring a particular agent.

## Documentation sync

After every meaningful change, do a DOX pass. Update the closest owning
contract when purpose, structure, constraints, or workflow change. Refresh
parent and child indexes and delete stale or contradictory instructions.
Create a child contract only for a durable ownership boundary, using Purpose,
Ownership, Local Contracts, Work Guidance, Verification, and Child DOX Index
where they apply. Keep contracts short and current; detailed API entries
belong in the catalog, and history belongs in version control.

Update in the same PR:

- IPC, bridge, events, hooks, stores, parsers, services, shared constants:
  `docs/INTERNAL-API.md`.
- Visual or interaction design: `docs/DESIGN.md`, `docs/design.html`,
  `docs/glass.html`, and their shared guide implementation.
- Platform API assumptions: `docs/api-volatility.md`; policy changes also
  update `docs/api-policy.md`.
- User-visible app behavior: `CHANGELOG.md`, plus `README.md` or
  `docs/INSTALL.md` when what users see or do changes.
- Directory purpose, contracts, workflows: the nearest `AGENTS.md` and its
  indexes.
- Project facts, setup, stack, feature status, links: `README.md` and the
  owning development docs.

Report docs you intentionally left unchanged. Don't duplicate a procedure
across files; link its owner. Keep every root-to-leaf contract chain
comfortably below 32 KiB so agents with bounded instruction loading get all
of the rules.

## Child DOX Index

- [Build assets](build/AGENTS.md): icon sources, native exports, packaging
  resources.
- [Shared](src/shared/AGENTS.md): pure cross-process contracts and constants.
- [Main](src/main/AGENTS.md): main process and preload, security, services,
  adapters.
- [Renderer](src/renderer/AGENTS.md): UI, state, design tokens, interactions.
- [Design guide](docs/guide/AGENTS.md): sample-data scenes built from real
  components, and their isolation.

`src/preload` is owned by the main contract.
