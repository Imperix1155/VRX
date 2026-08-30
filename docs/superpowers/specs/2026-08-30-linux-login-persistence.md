# Linux Login Persistence Design

**Status:** Approved by the owner on 2026-08-30 under VRX-34.

## Problem

Before this VRX-34 correction, VRX could report a successful VRChat or
ChilloutVR login after the platform accepted the credential but the local
encrypted credential write had failed. The adapter kept the authenticated
session in memory, so the app worked until a full quit and then started signed
out.

On Linux, one expected trigger was Electron selecting its insecure `basic_text`
backend. VRX correctly rejected that backend, but the adapters suppressed the
resulting exception. Other credential-store write failures had the same
false-success outcome. The affected tester's selected backend is not known yet;
the correction must diagnose the class without logging secrets.

## Approved Behavior

- A direct login is successful only after its session has been encrypted and
  persisted.
- VRChat's completed 2FA leg follows the same durable-or-fail rule. The first
  leg may retain its partial cookie only while the user is completing 2FA.
- A server-rotated ChilloutVR access key discovered while validating a restored
  session must also persist before the adapter publishes authenticated state.
  Persistence failure clears that restored session and reports unauthenticated.
- If persistence fails, clear the newly authenticated in-memory state, make a
  best-effort deletion of any partially written or stale credential, and return
  the literal error code `credential_persistence_failed`.
- A failure to delete during rollback must not replace the typed login failure.
- Do not publish an authenticated identity, start a new pipeline, or run
  renderer success invalidations after persistence failure.
- Show a dedicated localized error: sign-in did not finish because VRX could
  not save the session securely; the user should unlock or configure the OS
  credential store and retry.
- Log only a fixed platform/stage diagnostic. Never include a credential,
  cookie, access key, ciphertext, username, account id, or raw thrown error.

## Security Boundaries

- Keep `safeStorage` in the main process and keep the renderer token-free.
- Continue to reject Linux `basic_text`; do not store plaintext or enable
  Electron's plaintext mode.
- Do not migrate blindly to Electron's asynchronous API. Electron 43.4.1 can
  choose Chromium's public hardcoded Posix fallback while reporting async
  encryption available, and exposes no supported async-provider identity.
- Do not force `gnome-libsecret` globally because KDE and keyring-less systems
  require different handling.
- Do not add a session-only success state.

## Verification

- Test VRChat direct login, VRChat completed 2FA, and ChilloutVR direct login
  with a credential-store write failure. Each must return the literal code,
  clear in-memory authentication, avoid identity publication/pipeline startup,
  and attempt cleanup.
- Preserve success-path tests for all three flows.
- Test both renderer surfaces so the literal code maps to dedicated copy while
  every other failure remains generic and does not trigger success invalidation.
- Run a real Electron probe on Linux in two separate processes sharing a
  disposable `userData` directory and a temporary Secret Service session. Both
  test-only processes explicitly select `--password-store=gnome-libsecret`, and
  each must attest Electron reports `gnome_libsecret`. The first process writes
  an obviously synthetic fixture, and the second reads it. The probe must also
  assert that the fixture plaintext is absent on disk.
- Mutation-check the adapter tests by temporarily restoring the false-success
  behavior and observing the focused tests fail.
- Run the complete repository gate and the T2 authentication/security review.

## Non-Goals

- Proving which backend the affected tester's machine selected without a run on
  that machine.
- Supporting Linux systems that have no usable secure credential service.
- Migrating existing ciphertext to Electron's asynchronous safeStorage API.
- Changing credential import, explicit logout, or restored-session behavior
  beyond the rotated ChilloutVR key persistence boundary named above.
