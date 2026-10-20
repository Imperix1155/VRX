# Development

How to set up, run, and verify VRX from a fresh clone on Windows, Linux, or
macOS. Read the root [contract](../AGENTS.md) first. No personal agent skills,
model subscription, or Linear access is needed.

## Prerequisites

- Git, and Node.js **22.22.2 or a later 22.x patch** with npm. `.nvmrc` selects
  the 22 line and `package.json` records the minimum; CI uses the same file.
  With nvm, run `nvm install` and `nvm use`. Node 20 doesn't work: the locked
  jsdom needs 22.22.2 or later. Electron bundles its own Node for the app, so
  that version doesn't matter for building.
- Optional: [gitleaks](https://github.com/gitleaks/gitleaks#installing) for
  the local pre-commit secret scan. CI scans either way.
- GitHub access only for pushing, PRs, and releases. Never put credentials in
  files or logs.

## Install and run

```bash
npm ci
npm run dev
```

`npm ci` installs the locked dependencies, sets up Electron, and points Git at
the repository's pre-commit hook. Every checkout used for packaging needs its
own `node_modules`; a symlink to another checkout can leave production modules
out of the packaged app.

`npm ci` also runs [`scripts/patch-http-cache.mjs`](../scripts/patch-http-cache.mjs).
It patches a development-only HTTP cache library (see
[SECURITY.md](../SECURITY.md#temporary-dependency-exception)), and every build
verifies the patch first. If you installed with lifecycle scripts disabled,
run `npm run postinstall` before building. An unexpected library version or
source fails closed and needs a reviewed update, not just a new hash.
[`scripts/http-cache-security.test.mjs`](../scripts/http-cache-security.test.mjs)
covers it.

After `npm run build`, `npm start` runs the built app without a Vite server.
The main process accepts IPC only from the exact built renderer page. The
updater runs only in packaged builds.

The development app can sign in to real accounts. Prefer the design guide's
sample data when you only need to check UI.

## Find your way around

| Folder         | What lives there                                              |
| -------------- | ------------------------------------------------------------- |
| `src/main`     | Main process: services, platform adapters, IPC handlers, tray |
| `src/preload`  | The restricted `window.vrx` bridge                            |
| `src/shared`   | Plain types and constants shared by every process             |
| `src/renderer` | React views, stores, queries, and styles                      |
| `docs/guide`   | The design guide's real-component scenes and sample data      |
| `scripts`      | Build, release, audit, and icon tooling                       |
| `build`        | Icon sources and packaging resources                          |

Each of these has its own `AGENTS.md` where it has local rules. Before adding
a channel, event, hook, store, parser, service, or constant, look it up in the
[internal API catalog](INTERNAL-API.md) and read the code it points to.

For visual work, read [Design](DESIGN.md) and run the design guide:

```bash
npm run guide:dev
```

Open `http://127.0.0.1:4173/design.html`. `glass.html` shows one scene at a
time. The guide's sample data never signs in, launches a game, or runs the
updater. Opening the HTML straight from disk doesn't work. For a production
build of the guide, run `npm run guide:build`, then `npm run guide:preview`
and open `http://127.0.0.1:4174/design.html`.

## Icons

The SVG masters and generated app and tray icons are committed. After an
approved artwork change, run `npm run icons:generate` and
`npm run icons:check`. [App icon](APP-ICON.md) has the formats, sizes, and
package checks.

## Verification

For any change to the app, dependencies, build, release, or CI:

```bash
npm run lint && npm run format:check && npm test && npm run build
```

On a shell without `&&`, run each command separately and stop at the first
failure. `build` already runs both TypeScript checks, bundles the app, and
checks the entry chunk, so a separate typecheck adds nothing.

- While working, run the tests you need, for example
  `npx vitest run src/renderer/src/components/BootSplash.test.tsx`. Run the
  full gate before you deliver. For a bug fix, show a test that fails without
  the fix when practical.
- Look at changed UI in both themes and at the sizes it matters, including
  keyboard use and access to existing controls. The design guide proves the
  sample scene, not every real account or packaged-app path; say which you
  checked.
- Guide changes also need `npm run guide:build` and a look at the preview.
- Test or coverage tooling changes need `npm run test:coverage` followed by
  `npm run lint`, to prove the generated `coverage/` folder doesn't break
  linting.
- Documentation-only changes need `npm run format:check`, a check that every
  relative link and file reference resolves, a comparison of each factual
  claim against the code, and `git diff --check`. Changes to rules or policy
  also need realistic scenarios showing the new wording works. An app build
  adds nothing for prose, but required PR CI still runs.

Record the revision you tested, the commands, their exit codes, what you saw,
and what you couldn't check, in the PR or handoff. Check a worker's report
against the actual results.

### CI and failures

[CI](../.github/workflows/ci.yml) builds and tests on Windows and Ubuntu, audits
dependencies, and scans for secrets. The `ci-success` job sums them up.
[CodeQL](../.github/workflows/codeql.yml) runs on PRs to `main`, pushes to
`main`, and weekly. Check the repository's branch protection for any other
required checks.

On Ubuntu, CI also proves that saved sessions survive a restart: it runs
separate Electron processes against throwaway data with a temporary Secret
Service keyring, then tests the local-encryption fallback. The probe bundle,
its sources, config, and contract test must never ship in a release. The
workflow file holds the exact steps; never run them against real user data.

Treat a failure as evidence. Confirm the revision, environment, and logs, and
whether it also fails on the unchanged base. One re-run can help diagnose an
intermittent failure, but a later pass doesn't explain the failure. Don't call
an unrelated failure your regression, or an unexplained one a harmless flake.
Wait for checks on the exact PR head with a sensible deadline, and report a
timeout or missing result as exactly that.

## Dependency and security changes

Read upstream changes and check compatibility with the locked peer ranges.
Fix an update that works, or explain why it doesn't fit. Merging still needs
the owner's permission.

The audit job blocks high and critical advisories unless they are explicitly
excepted. An exception is allowed only for a development-only advisory with
no fixed release. Verify both, except only that exact advisory, and record the
reason and review date in [SECURITY.md](../SECURITY.md). Production exposure
or an available fix rules an exception out. Never lower the audit threshold or
disable the gate. [`scripts/audit-policy.mjs`](../scripts/audit-policy.mjs)
evaluates both audit reports and the lockfile; changing it needs tests that
prove non-excepted, production, expired, and malformed cases still fail.

Credentials belong only in main-process credential storage, with OS
encryption first and the documented local fallback second. Never store them
in plain text or let them reach the renderer. Allowlist a confirmed fake test
value in `.gitleaks.toml` by its exact value, never by path. A real committed
secret is a security incident: remove it and report it.
