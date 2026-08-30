# VRX Agent Contract

This repository uses the [DOX framework](https://github.com/agent0ai/dox).
`AGENTS.md` files are binding work contracts for their subtrees. Read this file,
then every `AGENTS.md` on the path to each file you touch. The closest contract
controls local details, but no child may weaken DOX.

## What VRX Is

VRX is a local Electron companion for **VRChat** and **ChilloutVR**. It
authenticates as the user on their machine and reads only that user's social
data: friends, presence, instances, and invites. It is not a bot, server, or
content uploader.

## Before Editing

1. Identify every file or folder the task may touch.
2. Walk from the repository root to each path and read every `AGENTS.md` found.
3. Read the owning technical documentation named by this contract.
4. Establish a verified baseline, confirm constraints and compatibility, then
   make incremental changes with verification between meaningful steps.

Do not rely on remembered instructions from another task.

## Architecture

- electron-vite + React 19 + strict TypeScript.
- Processes: `src/main`, `src/preload`, and `src/renderer`.
- Cross-process types and plain values live in `src/shared`, imported through
  `@shared`. Shared code must remain pure: no Electron or Node imports.
- Platform integrations use adapters. State uses Zustand; server/cache state
  uses TanStack Query.
- Prefer string-literal unions over `const enum` for esbuild and Zod safety.
- Before adding a channel, event, hook, store, parser, service, utility, or
  shared constant, consult [`docs/INTERNAL-API.md`](docs/INTERNAL-API.md).
  Reuse an existing surface when possible and update the catalog in the same PR
  whenever the callable surface changes.

## Design Contract

Before UI work, read [`docs/DESIGN.md`](docs/DESIGN.md), the rendered guide at
`docs/design.html`, and the living reference at `docs/glass.html`.

- Liquid glass is the material language. Dark is default; light is a
  `[data-theme="light"]` parity override, not a fork.
- Color communicates meaning, never decoration. Each meaning needs one fixed
  location and a non-color glyph.
- Platform identity is blue for VRChat and orange for ChilloutVR, expressed
  only through tint, spine, and glyph.
- Presence has two independent axes: `state` drives the dot; `status` drives
  the VRChat pill. Never conflate them.
- Use design tokens for color and spacing; do not introduce stray hex values.

## Security Non-Negotiables

For every BrowserWindow or IPC change:

- Keep `contextIsolation: true`, `sandbox: true`, and
  `nodeIntegration: false`.
- Guard every IPC handler with `isTrustedIpcSender`.
- Store credentials with `safeStorage`; never expose raw tokens to the
  renderer.
- Apply a URL allowlist before `shell.openExternal`.
- Do not permit `unsafe-inline` in CSP.
- Never log credentials, tokens, or PII; use `electron-log` with redaction.
- Never write to VRCX or CVRX folders.
- Never commit secrets. The CI `secret-scan` job and local pre-commit hook use
  gitleaks. Allowlist only confirmed fake fixture values, never whole paths.

## External API Etiquette

- Prefer WebSockets (VRChat Pipeline and CVR `/users/ws`) for real-time data.
  Do not poll friend status.
- Treat one request per second as the safe ceiling. Use exponential backoff,
  jittered intervals, and a proper User-Agent.
- Do not implement mass invites or other bot-like behavior.
- Parse defensively: unknown enum values must degrade gracefully.
- Record changed assumptions about unofficial API shapes or behavior in
  `docs/api-volatility.md`; update `docs/api-policy.md` when etiquette or policy
  changes.

## Work and Git Rules

- Solve the requested problem with the smallest coherent change. State
  assumptions and important tradeoffs before coding.
- Same-lineage Codex subagents may handle independent, bounded work in separate
  worktrees. Their output is fresh context, not independent model-lineage
  review; the driver remains responsible for verification and integration.
- For any user-authorized implementation or delivery task not explicitly
  restricted to local-only work, the driver may commit only on a non-protected
  feature branch, push that branch, open or update a PR, push review fixes, and
  keep Linear current without a separate permission prompt. These are normal,
  reversible delivery steps. Never commit or push directly to protected `main`.
- Merge only with explicit merge authority, `review-loop` coverage of the review
  anchor plus any verified nonfunctional-only delta, the applicable local gates
  green, final-head CI green, and substantive CodeRabbit and Greptile output
  covering the initial PR head and every later functional head. The initial PR
  head is the review anchor until a later functional head replaces it; this also
  defines the anchor for PRs with no functional changes. Resolve or refute every
  finding. The focused nonfunctional lane under Code Review Rules is the
  standing exception for later corrections. Any other review-leg exception must
  be narrowly defined by its owning skill and does not generalize. Without merge
  authority, leave the green PR open for owner approval; with it, merge when all
  gates are satisfied.
- Branch names are exactly `imperix/vrx-XX-slug`; commit messages reference
  `vrx-XX`.
- Pin third-party GitHub Actions to full commit SHAs with exact version
  comments. Set `actions/checkout` credential persistence to false unless a job
  intentionally pushes commits or tags.
- Use `app.getPath()` rather than hardcoded `C:\\`, `%APPDATA%`, or `~` paths.
- Use `electron-log`, not `console.log`.
- Do not add `any` or `@ts-ignore` without an explanation comment.

## Verification and Done

Before declaring implementation complete, run:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run build
```

Run focused tests for the changed behavior as well. Read the final sentinel or
exit status; silence is not proof. For bug fixes, demonstrate that the new test
fails without the fix when practical.

Before every PR, invoke the available `review-loop` skill over the actual
PR diff. Its deterministic pass includes `fallow dead-code` and `fallow dupes`
for JavaScript/TypeScript. A functional fix starts a new full review round. A
verified nonfunctional-only correction follows the focused delta lane under
Code Review Rules and does not restart the full review loop.

Linux release builds must keep the AppImage and deb launcher identity, desktop
metadata, 512px RGBA icon, architecture-qualified AppImage name, updater files,
and release asset allowlist in sync. The tag workflow extracts both packages
and checks those contents before it may make the draft release public.

Ubuntu CI also proves credential persistence across a real Electron restart: two
probe processes share a disposable `userData` directory inside a temporary
Secret Service session. Both test-only processes explicitly select
`--password-store=gnome-libsecret`, then attest Electron reports
`gnome_libsecret`. The first securely writes a synthetic fixture, the second
reads and clears it, and the probe rejects any fixture plaintext found on disk.

If the personal `review-loop` skill is unavailable, use this repository-portable
fallback: inspect the final PR diff from a fresh context; run the documented
project gate; run `fallow dead-code` and `fallow dupes` when Fallow is
installed. If it is unavailable, record that limitation and use the repository
TypeScript and ESLint results plus a targeted diff inspection for unused
exports and duplicated logic. Check security, correctness, tests, and
documentation sync; reconcile every finding; then re-review after functional
fixes. Inspect a later nonfunctional-only delta with the focused checks below.
Record that this fallback is a same-lineage Codex review, not independent model
confirmation.

## Code Review Rules

These rules apply to local review and Codex GitHub PR review:

- GitHub automatic Codex review is enabled for every push with exhaustive
  review. Push coherent checkpoints rather than tiny incremental updates, and
  check Codex usage during long work blocks and after unusually review-heavy
  PRs. If review usage becomes disproportionate, surface it to the owner and
  revisit the trigger or depth instead of silently exhausting the allowance.
- Starting 2026-08-18, re-evaluate exhaustive auto-review after one week or
  the first three VRX PRs opened after that date, whichever comes first.
  Compare usage consumed, actionable findings found, false-positive burden,
  and whether the findings escaped the local `review-loop`; keep or change the
  setting from that evidence.
- Except for a narrow safe-class review exception explicitly defined by its
  owning skill, inspect substantive CodeRabbit and Greptile output for the
  initial PR head and every later functional head. Read the walkthrough or
  summary, inline findings, unresolved threads, attached evidence, and last
  reviewed commit. A score, bare green check, or skipped/manual-review/rate-limit
  message is not substantive; request a full review and wait when that review
  leg is required.
- Classify each verified bot finding by effect, not file type. A **functional**
  finding can change app runtime, tests that could hide an app bug, packaging,
  workflows, security, permissions, or other operational behavior. Fix it,
  write the focused test or probe, run the full project gate and a new exact-diff
  `review-loop`, push, wait for final-head CI, and obtain fresh substantive
  CodeRabbit and Greptile reviews. Repeat until no valid functional finding
  remains.
- A **nonfunctional** correction changes only prose, spelling, formatting,
  spacing, comments, labels, or test descriptions and cannot affect or conceal
  app, build, test, release, security, or workflow behavior. Fix it directly;
  inspect the exact delta and run only the relevant formatting, link,
  consistency, or `git diff --check` checks. Do not rerun the full
  `review-loop`, and do not manually request or wait for another bot review
  solely to bless that correction. Prior substantive bot coverage remains valid
  for the review anchor. If a change mixes lanes or its effect remains uncertain
  after a decisive probe, use the functional lane. Record the
  classification and evidence in one concise PR disposition.
- Review the actual PR head and changed lines. Report only actionable findings
  introduced or exposed by the diff.
- Prioritize data loss, credential exposure, authentication mistakes, unsafe
  IPC or BrowserWindow settings, renderer trust-boundary violations, API
  etiquette/rate-limit regressions, crashes, and user-visible correctness.
- Treat missing `isTrustedIpcSender` guards, renderer-visible raw tokens,
  unallowlisted external URLs, polling of social presence, or writes to
  VRCX/CVRX data as blocking findings.
- Check that new callable surfaces reuse or update
  `docs/INTERNAL-API.md`, design changes update all three design artifacts,
  external-API assumptions update API docs, and user-visible behavior updates
  `CHANGELOG.md`.
- Check for focused tests and for compatibility with strict TypeScript, the
  Electron process boundary, both supported platforms, and dark/light parity
  where applicable.
- Do not report formatting-only preferences already enforced by repository
  tooling. Give a file/line reference, concrete failure mode, and evidence for
  every finding. If no material finding exists, say so plainly.
- Review feedback never authorizes a merge.

## Documentation Sync

Every meaningful change requires a DOX pass before closeout. Update the closest
owning `AGENTS.md` when purpose, structure, contracts, workflows, permissions,
constraints, or durable user preferences change. Update parent and child
indexes when their boundaries change. Delete stale or contradictory text.

Create a child `AGENTS.md` when a directory becomes a durable boundary with
its own purpose, rules, responsibilities, workflow, materials, or quality
standards. When parent changes alter local behavior, update the affected child
contracts too. New child contracts use this concise section order when the
sections apply: Purpose, Ownership, Local Contracts, Work Guidance,
Verification, Child DOX Index.

| If the change touches…                                                              | Update in the same PR                                                   |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| IPC, `window.vrx`, `AdapterEvent`, hook, store, parser, service, or shared constant | `docs/INTERNAL-API.md`                                                  |
| Visual or interaction design                                                        | `docs/DESIGN.md`, `docs/glass.html`, and `docs/design.html`             |
| VRChat/CVR API assumptions                                                          | `docs/api-volatility.md` and, when policy changes, `docs/api-policy.md` |
| User-visible behavior                                                               | `CHANGELOG.md`                                                          |
| Directory purpose, structure, contracts, or workflows                               | Nearest owning `AGENTS.md`                                              |
| Project facts, stack versions, feature status, or doc links                         | `README.md`                                                             |

Small edits that do not alter behavior or contracts may leave docs unchanged,
but the DOX pass still happens and intentionally unchanged docs are reported.

## Linear

Work is tracked on Linear team **VRX**. Issues use `VRX-N`. The `v1.0` label
means ships in 1.0; `v1.x` is deferred. M1 (Foundation) precedes later
milestones.

- Starting an issue: set it to **In Progress**.
- Opening a PR: set it to **In Review**.
- After required verification and merge: set it to **Done** and record a brief
  build/verification summary.
- Keep the board current during the work. Use the Linear integration directly;
  ask the owner only when a state change requires their authorization.

## Child DOX Index

- [`src/shared/AGENTS.md`](src/shared/AGENTS.md): pure cross-process types and
  constants.
- [`src/main/AGENTS.md`](src/main/AGENTS.md): Electron main-process security,
  logging, credential redaction, and the small preload bridge contract.
- [`src/renderer/AGENTS.md`](src/renderer/AGENTS.md): React UI, Tailwind v4,
  design-token-only styling, and populated renderer subtrees.

`src/preload` remains owned by `src/main/AGENTS.md`. The `.gitkeep`-only
`src/main/platform` and `src/renderer/src/routes` directories do not yet need
child contracts.
