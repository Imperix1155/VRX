# Development

How to set up, run and check VRX from a fresh clone on Windows, Linux or
macOS. Read the root [contract](../AGENTS.md) first. No personal agent skills,
model subscription or tracker access is needed.

## Prerequisites

- Git, and Node.js **22.22.2 or a later 22.x patch** with npm. `.nvmrc`
  selects the 22 line and `package.json` records the minimum; CI uses the same
  file. With nvm, run `nvm install` and `nvm use`. Node 20 doesn't work (the
  locked jsdom needs 22.22.2+). Electron bundles its own Node for the app.
- Optional: [gitleaks](https://github.com/gitleaks/gitleaks#installing) for
  the local pre-commit secret scan. CI scans either way.
- GitHub access only for pushing, PRs and releases. Never put credentials in
  files or logs.

## Install and run

```bash
npm ci
npm run dev
```

`npm ci` installs the locked dependencies, sets up Electron and points Git at
the repository's pre-commit hook. Every checkout used for packaging needs its
own `node_modules`; a symlink to another checkout can leave production modules
out of the packaged app.

`npm ci` also runs [`scripts/patch-http-cache.mjs`](../scripts/patch-http-cache.mjs)
(see [SECURITY.md](../SECURITY.md#development-only-http-cache-patch)); every
build verifies it first. If you installed with lifecycle scripts disabled, run
`npm run postinstall` before building.

The development app can sign in to real accounts. When you only need to check
UI, use the [design guide](#design-guide) and its sample data instead.

## Commands

| Command                                                            | What it does                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`                                                      | Runs the app with hot reload.                                                |
| `npm run verify`                                                   | The full gate: lint, format check, tests, build. Stops at the first failure. |
| `npm start`                                                        | Runs the last `npm run build` without a dev server.                          |
| `npm run lint`                                                     | ESLint, zero warnings allowed.                                               |
| `npm run format` / `format:check`                                  | Prettier: fix, or check only.                                                |
| `npm test` / `test:watch` / `test:coverage`                        | Vitest: once, watching, or with coverage.                                    |
| `npm run typecheck`                                                | Both TypeScript 7 projects (main and renderer).                              |
| `npm run build`                                                    | Typecheck, bundle, then assert the renderer entry chunk.                     |
| `npm run build:win` / `build:linux` / `build:mac` / `build:unpack` | Package for one OS, or an unpacked folder.                                   |
| `npm run guide:dev` / `guide:build` / `guide:preview`              | The [design guide](#design-guide).                                           |
| `npm run docs:links`                                               | Checks every relative link and `#heading` in the committed Markdown.         |
| `npm run design:tokens` / `design:tokens:check`                    | Regenerate, or check, the token tables in `DESIGN.md` from `main.css`.       |
| `npm run icons:generate` / `icons:check`                           | Regenerate, or check, the app and tray icons ([App icon](APP-ICON.md)).      |
| `npm run test:credential-persistence-*`                            | CI's saved-session probes. Never run them against real user data.            |

TypeScript: `npm run typecheck` uses the TypeScript 7 compiler (`tsc` from
`@typescript/native`). ESLint and the design-token scanner use the TypeScript
6 API from the `typescript` package (`tsc6`), because TypeScript 7 doesn't
ship that API.

## Find your way around

| Folder         | What lives there                                              | Rules                               |
| -------------- | ------------------------------------------------------------- | ----------------------------------- |
| `src/main`     | Main process: services, platform adapters, IPC, tray, updater | [AGENTS](../src/main/AGENTS.md)     |
| `src/preload`  | The restricted `window.vrx` bridge                            | [AGENTS](../src/main/AGENTS.md)     |
| `src/shared`   | Plain types and constants shared by every process             | [AGENTS](../src/shared/AGENTS.md)   |
| `src/renderer` | React views, stores, queries, translations and styles         | [AGENTS](../src/renderer/AGENTS.md) |
| `docs/guide`   | The design guide: real components with sample data            | [AGENTS](guide/AGENTS.md)           |
| `scripts`      | Build, release, audit and icon tooling                        | Root contract                       |
| `build`        | Icon sources and packaging resources                          | [AGENTS](../build/AGENTS.md)        |

Before adding a channel, event, hook, store, parser, service or constant, look
it up in the [internal API catalog](INTERNAL-API.md) and read the code it
points to. The catalog is one file per area in [`internal-api/`](internal-api/);
search it with `rg -n 'name' docs/internal-api`. Before adding a platform
request, read the [API policy](api-policy.md).

## Design guide

The design guide renders the real app components and the shipped stylesheet
with invented sample data. It never signs in, launches a game or runs the
updater.

```bash
npm run guide:dev
```

- `http://127.0.0.1:4173/design.html` is the guide: every page, the layered
  glass, token tables read from `main.css`, and the real CSS and usage code
  beside each example.
- `http://127.0.0.1:4173/glass.html?scene=NAME` shows one scene with its own
  theme, glow, state, grayscale and background picture controls. Add
  `&render=1` for the bare scene (handy for screenshots), and `&theme=light`,
  `&glow=vivid`, `&variant=…` or `&picture=1` to pick a state.
- `npm run guide:build`, then `npm run guide:preview`, serves a production
  build at `http://127.0.0.1:4174/design.html`.

Opening the HTML straight from disk doesn't work. For UI checks, drive the
scenes with Playwright at 900×670 (the smallest supported window), in both
themes, and once with a Japanese locale to catch overflow.

When you change a token in `main.css`, run `npm run design:tokens` so
Appendix A of [DESIGN.md](DESIGN.md) matches. `docs/guide/design-doc.test.ts`
fails when DESIGN.md names a token or class that doesn't exist, when its
copied CSS drifts from `main.css`, or when a guide code sample names a
component that doesn't exist.

## Verification

For any change to the app, dependencies, build, release or CI:

```bash
npm run verify
```

`verify` runs `npm run lint && npm run format:check && npm test && npm run build`
and stops at the first failure. `build` already runs both TypeScript checks.
The first lint of a fresh clone takes a couple of minutes (it type-checks
every file); later runs reuse `.eslintcache`. The full test suite takes about
a minute and a half. Two warnings at the top of a test run are expected and
harmless: Vite's note that `vitest.config.ts` isn't ready for its future
`configLoader: 'native'`, and Node's SQLite `ExperimentalWarning` (the VRCX
import tests read a SQLite file).

- While working, run only the tests you need, for example
  `npx vitest run src/renderer/src/components/BootSplash.test.tsx`. Run the
  full gate before you deliver. For a bug fix, show a test that fails without
  the fix when practical.
- Look at changed UI in both themes and at the sizes it matters, with the
  keyboard too. The design guide proves the sample scene, not every real
  account or packaged-app path; say which you checked.
- Guide changes also need `npm run guide:build` and a look at the preview.
- Test or coverage tooling changes need `npm run test:coverage` followed by
  `npm run lint`, to prove the generated `coverage/` folder doesn't break
  linting.
- Documentation-only changes need `npm run format:check`, `npm run docs:links`
  (every relative link and heading anchor resolves; `npm test` runs it too), a
  check that each named file exists, a comparison of each factual
  claim against the code, and `git diff --check`. Rule or policy changes also
  need realistic scenarios showing the new wording works. Required PR CI still
  runs.

Record the revision you tested, the commands, their exit codes, what you saw
and what you couldn't check, in the PR or handoff. Check a helper's report
against the actual results.

### CI and failures

[CI](../.github/workflows/ci.yml) builds and tests on Windows and Ubuntu,
audits dependencies and scans for secrets, on every push and pull request.
The `ci-success` job sums them up. Pushes to `main`, `beta` and `dev` are
keyed by commit and never cancelled, because a release waits on `ci-success`
for that commit; other pushes and PRs cancel a superseded run.
[CodeQL](../.github/workflows/codeql.yml) runs on PRs to `main`, pushes to
`main`, and weekly.

On Ubuntu, CI also proves that saved sessions survive a restart: it runs
separate Electron processes against throwaway data with a temporary Secret
Service keyring, then tests the local-encryption fallback. The probe bundle,
its sources, config and contract test must never ship in a release.

Treat a failure as evidence. Confirm the revision, environment and logs, and
whether it also fails on the unchanged base. One re-run can help diagnose an
intermittent failure, but a later pass doesn't explain it. Don't call an
unrelated failure your regression, or an unexplained one a harmless flake.

## Dependency and security changes

Read upstream changes and check compatibility with the locked peer ranges.
Fix an update that works, or explain why it doesn't fit. Merging still needs
the owner's permission.

The audit job blocks high and critical advisories, and there is no current
exception. An exception is allowed only for a development-only advisory with
no fixed release: verify both, except only that exact advisory in
[`scripts/audit-policy.mjs`](../scripts/audit-policy.mjs), and record the
reason and review date in [SECURITY.md](../SECURITY.md) in generic words.
Production exposure or an available fix rules an exception out. Never lower
the audit threshold or disable the gate; changing the policy needs tests that
prove non-excepted, production and malformed cases still fail.

Credentials belong only in main-process credential storage, OS encryption
first and the documented local fallback second. Never store them in plain text
or let them reach the renderer. Allowlist a confirmed fake test value in
`.gitleaks.toml` by its exact value, never by path. A real committed secret is
a security incident: remove it and report it.
