# Development

This is the setup and verification procedure for a fresh VRX clone on Windows,
macOS, or Linux. Start with the root [agent contract](../AGENTS.md). No personal
agent skills, model subscription, or Linear integration is required.

## Prerequisites

- Git and npm. Use Node.js **22.22.2 or a later 22.x patch**. `.nvmrc` selects
  the 22 line; `package.json` records the minimum. CI uses the same file.
  With nvm, run `nvm install` then `nvm use`; another manager or the Node
  installer is equally valid. Check `node --version` and `npm --version`.
- Node 20 is unsupported by the locked jsdom/Vitest versions. Electron bundles
  its own runtime; its Node version does not select the host build toolchain.
- Install [gitleaks](https://github.com/gitleaks/gitleaks#installing) for the
  local pre-commit secret check. CI remains required if that tool is absent.
- GitHub credentials are needed only for private repository access, pushing,
  PR operations, and publishing. GitHub CLI examples can be replaced by the
  web UI or API with equivalent checks. Never put credentials into files or logs.

From the repository root:

```bash
npm ci
npm run dev
```

`npm ci` installs the locked dependency graph, runs Electron's dependency setup,
and configures the repository pre-commit hook. Network access is needed on a
fresh machine. Each checkout used for packaging needs its own dependencies;
do not replace the whole `node_modules` directory with a symlink to another
checkout. That can omit production modules from the packaged app.

After `npm run build`, `npm start` previews the built renderer without a Vite
server. Its IPC admission accepts only the exact built renderer entry as a
top-level local document. It does not enable packaged-only updates.

The development app can use real accounts. Prefer test fixtures when checking
UI or isolated behavior. Device access, screenshots, accounts, and permission
prompts follow the local environment and the owner's task authorization.

## Finding the code

Main-process services and adapters are under `src/main`; `src/preload` exposes
the restricted bridge. `src/shared` owns plain cross-process contracts.
`src/renderer` owns React views and client state. Read each applicable child
`AGENTS.md` before editing.

Search [Internal API](INTERNAL-API.md) by symbol and process section before
adding a new interface. It is a lookup catalog, not a requirement to read every
row for every task. Inspect the referenced implementation as well.

For visual work, read [Design](DESIGN.md) and run the real-component guide:

```bash
npm run guide:dev
```

Open `http://127.0.0.1:4173/design.html`; `glass.html` shows isolated scenes.
Synthetic fixtures do not authenticate, launch a game, or call a real updater.
Source HTML opened directly from disk is not a supported preview. For a
production guide build, use `npm run guide:build` then `npm run guide:preview`,
which serves `http://127.0.0.1:4174/design.html`.

## Verification

For application, dependency, build, runtime, release, or CI configuration changes:

```bash
npm run lint && npm run format:check && npm test && npm run build
```

On shells that do not support `&&`, run each command separately and stop at any
nonzero exit. `build` runs the node/web TypeScript checks, production bundling,
and entry-chunk assertion; a redundant typecheck adds no evidence.

- During implementation, use a relevant subset, such as
  `npx vitest run src/renderer/src/components/BootSplash.test.tsx`. Run the full
  gate before delivery. For a fix, reproduce it and show a regression test
  failing without the fix when practical.
- Observe changed UI at relevant sizes and in both themes, including keyboard
  interaction and access to existing controls. Use the locally available
  browser/app test tools. A guide fixture proves the fixture, not every real
  Electron/account path; record that distinction.
- Guide changes also need `npm run guide:build` and actual preview inspection.
- Test/coverage-tooling changes need `npm run test:coverage` followed by
  `npm run lint`, proving generated `coverage/` does not break source linting.
- Documentation-only changes need format, relative-link/reference checks,
  source comparisons for factual claims, and `git diff --check`. Instruction
  or policy changes also need realistic workflow scenarios. An app build adds
  no evidence for prose-only edits; required PR CI still runs.

Record the tested revision, commands, exit statuses, observations, and limits
in the PR or handoff. A worker report must be checked against artifacts.

### CI and failures

[CI](../.github/workflows/ci.yml) runs Windows and Ubuntu checks, dependency
advisory auditing, and secret scanning. `ci-success` aggregates its required
jobs. [CodeQL](../.github/workflows/codeql.yml) scans PRs to main, pushes to
main, and weekly. Inspect actual branch protection for any additional checks.

Ubuntu additionally proves credential persistence across separate Electron
processes with disposable data and a temporary Secret Service session. It
attests `gnome_libsecret` and separately tests the production local-encryption
fallback under `basic_text` selection. Production never encrypts through
`basic_text`. The test bundle, sources, config, and contract test must remain
excluded from release packages. The workflow contains the exact dependencies,
launch flags, isolation, and cleanup procedure; do not run it against user data.

Treat a failure as evidence to investigate. Confirm the revision, environment,
logs, and whether it reproduces on the unchanged base. A bounded rerun can help
diagnose an intermittent failure; a later pass does not by itself explain the
failure or waive a known defect. Do not label unrelated failures as introduced
regressions, or unresolved failures as harmless flakes. Record unresolved
material uncertainty and do not claim merge readiness.

Wait for checks on the exact PR head with a practical deadline. Distinguish
success, failure, missing/ambiguous results, and timeout. Investigate or leave a
concrete blocker at the deadline; do not restart an endless wait.

## Dependency and security changes

Inspect upstream changes and compatibility with the locked peer dependency
ranges. Fix viable updates, or document why an update is unsuitable. Queue
mutation or merging still needs the owner's applicable task authority.

The audit job blocks high/critical advisories outside its explicit allowlist.
An exception is eligible only for a dev-only advisory with no forward fix.
Verify both conditions, allowlist the exact advisory, and record the rationale
and revisit tracking. Production exposure or an available forward fix is not
eligible under this exception. Never weaken the audit threshold or disable the
gate to make an update green. Use
[SECURITY.md](../SECURITY.md) for private vulnerability reporting and the
current time-bounded dependency exception. The executable policy in
`scripts/audit-policy.mjs` evaluates full and production reports plus the
lockfile; policy changes require negative tests for non-exempt and production
advisories, expiry, and failed reports.

Secrets belong in main-process credential storage. OS encryption is preferred;
the existing authenticated local fallback stores a random installation key
separately in private app files and is weaker if both files are stolen. Never
substitute plaintext or expose credentials through the renderer. A confirmed
fake test secret may be allowlisted narrowly in `.gitleaks.toml`; real secrets
must be removed and handled as a security incident.
