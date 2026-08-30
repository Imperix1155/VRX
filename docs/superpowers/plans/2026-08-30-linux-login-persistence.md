# Linux Login Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VRChat and ChilloutVR login success contingent on durable encrypted credential persistence, with actionable UI feedback and real Linux restart verification.

**Architecture:** Keep the existing synchronous, fail-closed safeStorage service. Turn adapter persistence into an explicit result, roll back a newly authenticated session on failure, carry one shared literal error code through the existing LoginResult IPC contract, and map only that code to dedicated renderer copy. Add a test-only Electron entry that explicitly selects and attests GNOME libsecret while exercising the production credential service across two Linux processes in a temporary Secret Service session.

**Tech Stack:** Electron 43.4.1, electron-vite, strict TypeScript, Vitest, React 19, i18next, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-linux-login-persistence.md`

## Global Constraints

- Keep credentials in the main process and encrypted with `safeStorage`.
- Continue rejecting Linux `basic_text`; never enable plaintext encryption.
- Never log credentials, cookies, access keys, usernames, account ids, ciphertext, or raw persistence errors.
- No session-only success and no globally forced Linux password backend.
- Branch is `imperix/vrx-34-linux-login-persistence`; commits reference `vrx-34`.
- User-visible behavior updates `CHANGELOG.md`; shared and hook contract changes update `docs/INTERNAL-API.md`.

---

### Task 1: Adapter Durable-or-Fail Contract

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/main/services/adapters/VrcAdapter.test.ts`
- Modify: `src/main/services/adapters/VrcAdapter.ts`
- Modify: `src/main/services/adapters/CvrAdapter.test.ts`
- Modify: `src/main/services/adapters/CvrAdapter.ts`

**Interfaces:**

- Produces: `CREDENTIAL_PERSISTENCE_FAILED = 'credential_persistence_failed'` from `@shared/types`.
- Produces: adapter `LoginResult` terminal failure
  `{ ok: false, needs2fa: false, error: CREDENTIAL_PERSISTENCE_FAILED, sessionCleared: true }`.
- Preserves: synchronous injected credential-store `save` and `delete` signatures.

- [ ] **Step 1: Reverse the existing save-throws expectations and add state assertions**

  Change the VRChat direct-login and ChilloutVR save-throws tests from success to
  the literal persistence failure. Assert `getAuthStatus()` returns
  `unauthenticated`, the store cleanup is attempted, authenticated identity is
  never published, and the CVR pipeline is not restarted. Add the same failure
  case after a successful VRChat 2FA response. Add a restored CVR validation
  case where the server rotates the access key but its persistence fails; it
  must clear the session and report unauthenticated. Pin one exact fixed warning
  with no metadata and verify a throwing rollback deletion cannot replace the
  typed failure.

- [ ] **Step 2: Run the focused tests and verify the existing false-success implementation fails**

  Run: `npx vitest run src/main/services/adapters/VrcAdapter.test.ts src/main/services/adapters/CvrAdapter.test.ts`

  Expected: the three persistence-failure cases receive `{ ok: true }` or remain
  authenticated, proving the regression tests detect the shipped behavior.

- [ ] **Step 3: Add the shared literal and minimal adapter rollback**

  Export `CREDENTIAL_PERSISTENCE_FAILED` from shared types. Make each adapter's
  `persist()` return `true` only after `save` completes. On `false`, run a private
  rollback that clears all in-memory session state, attempts `delete()` inside a
  non-throwing `try/catch`, emits one fixed warning through the injected logger,
  and returns the typed failure before identity publication or pipeline startup.
  Apply the same gate after VRChat 2FA refresh and when restored CVR validation
  rotates the access key; the latter returns unauthenticated because it has no
  interactive `LoginResult` caller.

- [ ] **Step 4: Run the focused adapter tests and verify green**

  Run: `npx vitest run src/main/services/adapters/VrcAdapter.test.ts src/main/services/adapters/CvrAdapter.test.ts`

  Expected: both files pass with the new failure and unchanged success paths.

### Task 2: Renderer Error Mapping

**Files:**

- Modify: `src/renderer/src/utils/loginError.test.ts`
- Modify: `src/renderer/src/utils/loginError.ts`
- Modify: `src/renderer/src/utils/accountCard.test.ts`
- Modify: `src/renderer/src/utils/accountCard.ts`
- Modify: `src/renderer/src/hooks/useAuthFlow.ts`
- Modify: `src/renderer/src/components/LoginScreen.tsx`
- Modify: `src/renderer/src/components/LoginScreen.test.tsx`
- Modify: `src/renderer/src/components/AccountCard.tsx`
- Modify: `src/renderer/src/components/AccountCard.test.tsx`
- Modify: `src/renderer/src/locales/en/translation.json`
- Modify: `src/renderer/src/locales/ja/translation.json`

**Interfaces:**

- Consumes: `CREDENTIAL_PERSISTENCE_FAILED` from `@shared/types`.
- Produces: `mapLoginError(code)` and `accountLoginErrorKey(platform, code)` mappings for the one known persistence code.
- Produces: `UseAuthFlowOptions.errorKeyForCode(code?: string): string`.

- [ ] **Step 1: Add failing mapper and surface tests**

  Assert the known code maps to `login.error.credentialPersistence` and
  `settings.accounts.error.credentialPersistence`; unknown codes still map to
  the existing generic keys. Drive both real forms with a failed login result
  and assert the dedicated translated message appears without auth/friends
  success invalidations.

- [ ] **Step 2: Run the focused renderer tests and verify red**

  Run: `npx vitest run src/renderer/src/utils/loginError.test.ts src/renderer/src/utils/accountCard.test.ts src/renderer/src/components/LoginScreen.test.tsx src/renderer/src/components/AccountCard.test.tsx`

  Expected: persistence-code expectations fail because every error is currently generic.

- [ ] **Step 3: Route result codes through the existing mappers**

  Replace `genericErrorKey` with an `errorKeyForCode` option in `useAuthFlow`.
  Invoke it with no code for bridge/throw failures and with `result.error` for a
  normal adapter failure. Pass the existing per-surface mapper from LoginScreen
  and AccountCard. Add English and Japanese copy explaining that sign-in did not
  finish and the OS credential store must be unlocked or configured.

- [ ] **Step 4: Run the focused renderer tests and i18n parity**

  Run the Task 2 focused command plus `npx vitest run src/renderer/src/i18n/parity.test.ts`.

  Expected: all focused files pass.

### Task 3: Real Linux Credential Restart Probe

**Files:**

- Create: `scripts/credential-persistence-probe.ts`
- Create: `electron-vite.credential-probe.config.ts`
- Modify: `package.json`
- Modify: `tsconfig.node.json`
- Modify: `electron-builder.yml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: production `saveCredential`, `loadCredential`, `clearCredential`, and `CREDENTIAL_KEYS`.
- Produces: `npm run test:credential-persistence-linux`, a Linux-only two-process probe.

- [ ] **Step 1: Add a probe with write and read modes**

  Before any electron-store instance exists, require an absolute disposable
  root with the probe basename prefix, reject filesystem roots and symlinks, and
  require an existing empty directory in write mode. Write a fixed non-secret
  marker that read mode must verify before calling `app.setPath('userData', root)`.
  Then assert encryption is available and Electron reports the explicitly
  selected `gnome_libsecret` backend, save the fixed synthetic fixture
  `vrx-ci-fixture-not-a-token`, recursively inspect only the disposable root to
  assert plaintext absence, and exit. In read mode, load the same key, compare it to the fixture without
  printing it, clear it, and exit. Every failure prints only a fixed assertion
  label and nonzero exit code.

- [ ] **Step 2: Add a dedicated bundled Electron entry and script**

  Configure electron-vite to bundle the probe and production credential module,
  including ESM-only `electron-store`, into `out/credential-probe/index.js`.
  Add a package script that builds the entry and launches write then read in two
  separate Electron processes against the same caller-provided directory. Add
  the probe entry and its electron-vite config to `tsconfig.node.json` so the
  normal TypeScript-aware ESLint and node typecheck gates own both files. Suppress
  npm headers and raw child output; map build/write/read failures to fixed labels
  so the directory and runtime errors cannot leak into CI logs. Explicitly
  exclude the generated `out/credential-probe/**` bundle plus the probe source,
  config, and contract test from Electron Builder packages. Pin that boundary
  in the contract test so a same-workspace package cannot ship any test-only
  credential-probe artifact.

- [ ] **Step 3: Add the Ubuntu Secret Service CI environment**

  In the Ubuntu build leg only, install `dbus-x11`, `gnome-keyring`,
  `libsecret-1-0`, and `xvfb`; create a mode-0700 `XDG_RUNTIME_DIR`; start the
  secrets component inside one `dbus-run-session`; and run both Electron probe
  processes under Xvfb with `--password-store=gnome-libsecret`. Capture and check daemon initialization before evaluating
  its environment, discard raw daemon/probe diagnostics, and wrap the runtime in
  both a short GitHub step timeout and a `timeout --kill-after` deadman. Keep
  checkout actions SHA-pinned and preserve the final `ci-success` dependency.

- [ ] **Step 4: Verify the probe build locally and workflow syntax structurally**

  Run: `npm run build:credential-persistence-probe`

  Expected on macOS: the test-only entry bundles successfully. Do not claim the
  Linux runtime result locally; the Ubuntu CI leg is the decisive runtime gate.

### Task 4: Contracts and User-Facing Documentation

**Files:**

- Modify: `AGENTS.md`
- Modify: `src/shared/AGENTS.md`
- Modify: `src/main/AGENTS.md`
- Modify: `src/renderer/AGENTS.md`
- Modify: `docs/INTERNAL-API.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/design.html`
- Modify: `docs/glass.html`
- Modify: `CHANGELOG.md`
- Create: `docs/superpowers/specs/2026-08-30-linux-login-persistence.md`
- Create: `docs/superpowers/plans/2026-08-30-linux-login-persistence.md`

**Interfaces:**

- Documents: the literal error result, durable-or-fail adapter boundary, mapper behavior, and Linux CI proof.

- [ ] **Step 1: Update owning contracts and API catalog**

  Record that direct login/completed 2FA cannot return success until persistence
  completes, and that `LoginResult.error === 'credential_persistence_failed'`
  is the only failure intentionally mapped to dedicated copy. Update all
  duplicated login/verify rows in the generated-style API catalog consistently.
  Replace the removed `useAuthFlow.genericErrorKey` catalog entry with
  `errorKeyForCode(code?)`, document generic handling for bridge/thrown failures,
  and catalog both `mapLoginError(code)` and
  `accountLoginErrorKey(platform, code)`. Recast the spec's Problem section as
  explicitly pre-fix behavior rather than a current-state claim.
  Record the real two-process Ubuntu credential persistence gate in the root
  contract and format the approved spec/implementation-plan artifacts.

- [ ] **Step 2: Update the changelog and complete the DOX pass**

  Add the Linux works-until-quit fix under the current release. Confirm the
  existing ErrorBanner layout, tokens, and glyphs remain unchanged, and add the
  same durable-or-fail login/error-message interaction contract to
  `docs/DESIGN.md`, `docs/design.html`, and `docs/glass.html`.

### Task 5: Security-Grade Verification and Delivery

**Files:**

- Inspect: all changed files and final diff.

**Interfaces:**

- Produces: one verified commit and a PR against `main` for VRX-34.

- [ ] **Step 1: Mutation-check the regression**

  Temporarily restore the adapters' old behavior after save failure, run the
  focused adapter tests and observe failure, restore the fix, and rerun green.

- [ ] **Step 2: Run focused and full gates**

  Run focused auth/credential/renderer/CI tests, then
  `npm run typecheck && npm run lint && npm run format:check && npm run build`
  and `npm test`. Read exit codes and final sentinels.

- [ ] **Step 3: Run the T2 review-loop**

  Review the SHA-pinned diff for authentication correctness, rollback races,
  secret exposure, IPC contract drift, Linux compatibility, dead code, and
  duplication. Dispatch three fresh-context reviewer lenses, reconcile every
  finding, and rerun all invalidated gates after functional fixes.

- [ ] **Step 4: Commit, push, and open the PR**

  Commit with a message referencing `vrx-34`, push the feature branch, open a
  PR against `main` with security risk and verification evidence, and move
  Linear VRX-34 to In Review.

- [ ] **Step 5: Wait for final-head CI and substantive automated reviews**

  Read CI results plus CodeRabbit and Greptile walkthroughs, inline findings,
  unresolved threads, evidence, and reviewed commit SHA. Fix or refute each
  substantive finding under the repository's functional/nonfunctional rules.
  Leave the merge blocked for explicit owner approval.

## Implementation Deviations

Testing expanded the implementation beyond the initial save-failure seam to
close auth-state races at the same boundary. The final change also operation-
fences concurrent login, restore, and explicit logout; introduces the optional
`LoginResult.sessionCleared` reconciliation marker and
`auth_identity_unavailable`; validates VRChat credential ownership; quarantines
tentative cookies from every credential consumer; and generation-binds each
request in paginated roster and queued metadata work so it cannot continue with
a newer durable account's cookie. The approved specification records these
deliberate deviations.
