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
- Merge only with explicit owner authority, applicable local gates and required
  final-head CI green, and `review-loop` coverage of the general review anchor plus validated
  focused functional reviews and nonfunctional checks through the final head. Its tier-specific bot and bounded-wait
  policy applies; known material defects or uncertainty block readiness,
  cosmetic preferences do not. Without merge authority, leave the PR open.
  An active grant permits merge only when all applicable gates are satisfied.
- Branch names are exactly `imperix/vrx-XX-slug`; commit messages reference
  `vrx-XX`.
- Pin third-party GitHub Actions to full commit SHAs with exact version
  comments. Set `actions/checkout` credential persistence to false unless a job
  intentionally pushes commits or tags.
- Use `app.getPath()` rather than hardcoded `C:\\`, `%APPDATA%`, or `~` paths.
- Use `electron-log`, not `console.log`.
- Do not add `any` or `@ts-ignore` without an explanation comment.

## Verification and Done

Before declaring application implementation complete, run:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run build
```

For changes only to review-policy instructions or reviewer-role configuration,
use focused format/configuration/reference and policy-scenario checks. Changes
to app, build, runtime, release, or CI configuration still need their applicable
project gates. Required CI still applies to a published PR.

Run focused tests for changed application behavior as well. Read the final
sentinel or exit status; silence is not proof. For bug fixes, demonstrate that the new test
fails without the fix when practical.

Before every PR, invoke the available `review-loop` skill over the actual
PR diff. Its deterministic pass includes `fallow dead-code` and `fallow dupes`
for application JavaScript/TypeScript changes. Functional fixes use focused
behavioral review by default, with broader review under the criteria below.
Nonfunctional-only corrections use a separate focused check.

Linux release builds must keep the AppImage and deb launcher identity, desktop
metadata, 512px RGBA icon, architecture-qualified AppImage name, updater files,
and release asset allowlist in sync. The tag workflow extracts both packages
and checks those contents before it may make the draft release public.

Ubuntu CI also proves credential persistence across a real Electron restart: two
probe processes share a disposable `userData` directory inside a temporary
Secret Service session. Both test-only processes explicitly select
`--password-store=gnome-libsecret`, then attest Electron reports
`gnome_libsecret`. The first securely writes a synthetic fixture, the second
reads and clears it, and the probe rejects any fixture plaintext found in the
disposable `userData` tree.
Its bundle, source, config, and contract test are test-only and must remain
explicitly excluded from Electron Builder packages; the probe contract test
pins that boundary.

If the personal `review-loop` skill is unavailable, use this repository-portable
fallback: use the reviewer routing and tier rules below to inspect the final PR
diff from a fresh context; run the applicable documented gate; for application
JavaScript/TypeScript changes, run `fallow dead-code` and `fallow dupes` when Fallow is
installed. If it is unavailable, record that limitation and use the repository
TypeScript and ESLint results plus a targeted diff inspection for unused
exports and duplicated logic. Check security, correctness, tests, and
documentation sync; resolve or refute material findings; use focused behavioral
review after functional fixes and broaden under the criteria below. Inspect
nonfunctional-only deltas with the separate focused checks below.
Record that this fallback is a same-lineage Codex review, not independent model
confirmation.

## Code Review Rules

These rules apply to local review and Codex GitHub PR review:

- GitHub automatic Codex review was configured for every push with exhaustive
  review. This policy does not change that account setting. Push coherent
  checkpoints rather than tiny incremental updates, and
  check Codex usage during long work blocks and after unusually review-heavy
  PRs. If review usage becomes disproportionate, surface it to the owner and
  revisit the trigger or depth instead of silently exhausting the allowance.
- Starting 2026-08-18, re-evaluate exhaustive auto-review after one week or
  the first three VRX PRs opened after that date, whichever comes first.
  Compare usage consumed, actionable findings found, false-positive burden,
  and whether the findings escaped the local `review-loop`; keep or change the
  setting from that evidence.
- `review-loop` is the primary workflow authority. Meaningful ordinary changes
  get one fresh Astra at High general review covering requirement/acceptance
  alignment and correctness/quality. Sol at High handles additional
  bounded checks only for a concrete risk, coverage gap, or unresolved question;
  use Astra for critical or unusually difficult questions. Choose model and
  effort separately, with higher supported effort upfront when justified or
  one automatic escalation per named question. Obtain missing evidence first.
  Unresolved material uncertainty remains unresolved after the cap.
- All ordinary T0/T1 PR bots are advisory, including CodeRabbit, Greptile, and
  automatic Codex GitHub review. Inspect actual available feedback while other
  required work runs and before merge. Missing, running, skipped, or rate-limited
  advisory bots do not block readiness. No minimum wait, ceremonial full-review
  request, or waiting solely for advisory output is required. Validate material
  findings and fix or refute them; cosmetic preferences are not gates.
- T2 is top-level critical: credible risk of making the app unusable or putting
  a user's VRChat/ChilloutVR account in danger. Judge reachable behavioral
  consequences, not filenames or hypothetical "anything could break." Investigate
  startup/core-process failure, updates that prevent launch, credential exposure
  or wrong-account access/actions, and API request amplification, frequency,
  rate-limit/backoff/retry faults, or forbidden actions/policy violations that
  could cause an account ban. Certainty of failure is not required.
- UI changes must preserve access to previously exposed controls and workflows
  unless removal was explicitly approved. Observe the affected UI using the
  applicable verification skill and capture consent. Credible loss of essential
  workflows/app usability is T2 even when processes still run. Styling alone
  does not make a change critical; accidental smaller regressions still require
  correction. Existing credential, security, irreversible-data, account,
  test/CI, and owner-permission safeguards remain mandatory outside T2 too.
- T2 requires evidence for the actual critical consequences, applicable probes,
  risk disclosure, owner review, and substantive CodeRabbit and Greptile output
  for the initial PR head and every later functional head. One fresh general
  review remains the baseline, covering acceptance alignment and correctness.
  Add targeted Astra review only for a concrete critical risk or coverage gap;
  there is no fixed additional-reviewer count.
  Preserve explicitly scoped workflow exceptions, including `dependabot-triage`'s
  verified safe class, which excludes credible critical risk. Scores,
  skipped/rate-limit messages, and bare green checks do not satisfy required
  review. Same-lineage agreement does not waive critical merge gates.
- The general review head is the local anchor. Functional corrections normally
  get fresh focused review of the exact delta and affected behavior, callers,
  and contracts, relevant regression tests/probes, applicable required gates,
  and current-head CI. Record which prior conclusions remain valid and why.
  Assess the cumulative delta so combined coverage reaches the actual final
  head. Restart general review if design/security assumptions change, shared
  behavior is broadly affected, earlier conclusions fail, or effects cannot be
  reliably bounded. Small line counts do not prove bounded impact. Critical
  bots still require substantive coverage on every later functional head.
- A verified nonfunctional-only delta changes no app, build, test, release,
  security, workflow, or policy behavior. It gets focused format/link/consistency
  and `git diff --check` checks plus required final-head CI. It needs no new
  general review or bot wait solely for that correction. Preserve prior review
  coverage; mixed or uncertain corrections use the functional lane. This check
  is distinct from focused functional review and cannot verify changed behavior.
- Required CI, local reviews, and genuinely required external reviews need
  bounded watchers with practical deadlines, sane polling, and distinct
  completion, failure, parse-failure, and timeout outcomes. Timeout requires
  investigation, a blocker, or a durable handoff, never success or a merge
  waiver. Do not restart the same deadline or wait half a day for bot quota; a
  known limit may justify immediate parking of a required review.
  Do not change GitHub protection or review settings to implement this
  policy; report any actual protection blocker.
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
