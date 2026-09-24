# VRX-282 Linux credential regression investigation

Status: tester reports enabling KDE Wallet fixed login. Automatic local fallback
implemented and locally verified; PR delivery in progress, not released.

## Outcome and authority

Josh requests sustained investigation and an app-side fix for Bazzite login
persistence without asking the tester to run commands or configure a wallet.
Reported sequence: a version after the email-2FA correction remembered login
across full quit; a later version forgot login; v0.19.2 and v0.21.0 block login
with the credential-persistence message. Exact first failing version is unknown.

Authorized: research, synthetic experiments, scoped implementation, verification,
feature-branch commits/pushes, tracker updates and a PR. No merge, public release,
installed-app replacement, real platform-account probes, unapproved credential weakening,
or access to unrelated personal data. Preserve ciphertext compatibility and
account ownership. A missing secure store must not silently become plaintext.

Acceptance: sign in, fully quit, reopen and remain signed in on supported Linux;
verify secure persistence and normal logout/account boundaries. Distinguish
laboratory evidence from a reproduction on the tester's actual machine.

## Source and isolation

- Base: `424610f1e265d13c55a018edd663f1a69f88bc34`, published v0.21.0.
- Worktree: `/private/tmp/vrx-282-linux-credentials`.
- Branch: `imperix/vrx-282-linux-credential-recovery`.
- Linear: VRX-282, In Progress.
- Original checkout is behind origin/main with untracked local tool folders;
  preserved. Existing PRs 326 and 327 are unrelated and remain untouched.
- Local host is macOS arm64, without an existing Linux VM CLI. Prepare an
  isolated temporary Linux VM with no host-directory mounts or forwarded agent.
  An arm64 Linux probe is not proof of x86_64 packaged Bazzite behavior.

## Verified starting facts

- The displayed message was added by PR 291 / VRX-34, first published v0.19.2.
- That change made encrypted-save success mandatory instead of swallowing save
  failures. It also introduced invalidation markers and stronger account fences.
- The secure-backend availability guard, including rejecting `basic_text`,
  existed in the original credential service before the reported working era.
- The credential service is byte-identical in v0.19.2 and v0.21.0.
- Electron lockfile versions: v0.18.1 uses 43.3.0, v0.19.2 uses 43.4.1,
  v0.21.0 uses 44.3.0. This is a candidate variable, not evidence of causation.
- The current adapter maps all save exceptions to the same message and fixed
  log line; it cannot distinguish filesystem, owner-record and encryption errors.
- Existing Linux CI explicitly forces GNOME libsecret in a prepared Ubuntu
  keyring. It does not prove default desktop detection or KDE/Bazzite behavior.

## Bounded work units

1. Reconstruct storage, ownership, login and startup changes from the known
   working era. Read-only investigator; driver verifies cited artifacts.
2. Examine pinned Electron/Chromium and Bazzite storage selection and recovery.
   Read-only investigator; driver checks supported behavior and security limits.
3. Build a synthetic Linux reproduction matrix covering secure-store selection,
   startup availability and durable save/read across separate processes. Record
   failures and explicit success sentinels before choosing implementation.
4. Implement only a reproduced, bounded correction. Add regression and mutation
   evidence; preserve old ciphertext and account-switch/logout behavior.
5. Update owning DOX, run focused tests and the project gate, conduct the required
   SHA-pinned review, and open a PR. Authentication/storage changes are T2 when
   they can block sign-in or weaken account isolation. No merge authority.

## Open hypotheses

- Runtime or desktop detection selects a different or unavailable secure backend.
- Availability fails early and remains failed for that process.
- A hardened owner-record or file-write step fails despite working encryption.
- Changed app identity or path strands an older encrypted session.

None is established as the tester's cause. Do not describe a diagnostic-only
change or a passing forced-GNOME probe as a fix for his Bazzite installation.

## Runtime evidence and updated requirement

A disposable Fedora 44 arm64 VM uses no host mounts or SSH agent forwarding.
Electron 43.2.0, 43.4.1 and 44.3.0 were downloaded from official releases and
checksum-verified. With a synthetic public Secret Service available, all three
pass production save, owner binding, restart read, plaintext scan and clear
when selecting gnome-libsecret. GNOME default also passes. gamescope default
selects basic_text and fails; KDE default selects kwallet6 and fails when its
separate private Secret Service has no default wallet. This establishes a
backend-selection failure mode, not an Electron-version regression.

Evidence: `/private/tmp/vrx-282-runtime/gnome-matrix.log`, probe.cjs and
credentials.cjs. Lima home is `/private/tmp/vrx-282-runtime/instances`; VM
vrx-linux must be stopped when experiments finish. The native-wallet researcher
owns an independent disposable session and its artifacts under kde-agent.

Josh subsequently reports the tester enabled his previously disabled KDE Wallet
and login now works. This is tester self-report, not direct device inspection.
It does not establish that installed Bazzite disables wallets by default.
The requested outcome now explicitly includes remembered login with no available
OS wallet, using OS protection when possible and an automatic alternative when
not. Switching between OS backends alone cannot satisfy that requirement.

A tentative native-backend relaunch experiment was archived outside the source
at `/private/tmp/vrx-282-runtime/native-recovery-experiment.patch` and
linuxCredentialRecovery-experiment.ts. It was not verified or shipped. Production
source was restored to the base before designing the broader fallback.

A disposable Node AES-256-GCM experiment, using only synthetic data and no
keyring, passed LOCAL_WRITE_GREEN and LOCAL_RESTART_AND_TAMPER_GREEN in the VM.
It used a random installation key, 0600 key/ciphertext files, random nonce and
credential-slot associated data. It rejects altered ciphertext and slot swaps.
This proves feasibility only, not production implementation or Windows ACLs.

## Approved material decision

A selectable question asks Josh to approve automatic persistent local encryption
with a random installation key in private app files. Someone who obtains both
key and session files can recover sessions; same-user malware is not excluded.
The alternative is usable login with memory-only sessions, losing login at quit.
Josh answered "i aprove" after the concrete local-key risk disclosure. That
authorizes the proposed automatic persistent local fallback and the scoped
safeStorage-only contract amendment. No merge or release authority was granted.

## Approved implementation and checks

- Keep `credentials.ts` the sole persistence API and retain base64 safeStorage
  compatibility, exact invalidation marker, owner digest binding and logout.
- Version local ciphertext explicitly. Use maintained Node crypto primitives,
  random installation key and per-write nonce, authenticated encryption and
  credential-slot binding. Never use Electron basic_text, a built-in password,
  hardware IDs, platform passwords or renderer-visible secrets.
- Try OS-backed encryption for new authenticated sessions. Only encryption
  unavailability/failure may select local fallback. Filesystem, marker and owner
  failures remain failures. Read each record using its recorded format.
- Never silently reinterpret an unreadable existing OS-protected record as local
  data. A locked wallet cannot be decrypted by inventing a new key. Fresh login
  can replace its slot under the existing account-replacement rules.
- After a local session validates normally, re-save with OS protection when
  available. Do not retain a local duplicate of that session, which would defeat
  the stronger protection. If the wallet is disabled later, a fresh login may be
  needed once; subsequent local sessions must survive restart.
- Protect local key creation, file permissions/ownership, malformed input,
  symlinks, missing/corrupt keys, interrupted writes and bounded record sizes.
  Never regenerate a missing key while claiming old local ciphertext is usable.
- Tests: old OS ciphertext; OS available/unavailable/throwing; local restart;
  both platforms; tamper/slot swap; missing key; migration; owner failure;
  invalidation and logout with failed delete; account replacement; no plaintext.
  Mutation-check critical protections. Synthetic Linux no-wallet runtime probe
  must exercise the production module, plus existing real OS-storage CI probe.
- Update owning main/root contracts and INTERNAL-API, CHANGELOG and this plan;
  preserve unrelated design/API docs. Full gates and T2 review before PR.

## Checkpoint

All investigators completed. The isolated VM was stopped after the experiments.
Native KDE secure persistence and cross-backend ciphertext compatibility were
not verified; those claims remain explicitly unproven.

Production fallback and expanded Linux CI probe are implemented. No release.
The original investigation probes and their intermediate limitations above are
historical evidence; the following verification covers the final implementation. Baseline focused credential/CVR
and probe-contract tests passed 132 tests across three files. The probe build
passed. Latest observed weekly usage was 12% used. No real platform requests.

## Local verification and review

- Full lint, format, node/web typechecks, build, entry-chunk assertion and probe
  bundle build passed with `VRX282_PROJECT_GATE_GREEN`.
- Focused credential, local encryption, VRChat, ChilloutVR and probe-contract
  tests passed 294 tests in five files. Mutations removing fallback and slot
  associated-data binding each made the corresponding regression fail; originals
  were restored and the focused suite passed again.
- Production Electron matrix: 18 cases across 43.2.0, 43.4.1 and 44.3.0 with
  GNOME/gamescope/KDE defaults and explicit libsecret yielded 36 successful
  write/read process results, no failures. Both platform slots, owner binding,
  plaintext absence and clear were exercised with synthetic data only.
- Explicit KDE `[Wallet] Enabled=false` with Electron 44.3.0 reported native
  `kwallet6` unavailable in both processes while production save, restart read
  and clear passed: `DISABLED_WALLET_GREEN`.
- Local-to-real-Secret-Service migration, another restart, and clear passed:
  `MIGRATION_MATRIX_GREEN`. The actual committed CI bundle separately attested
  OS and local formats and passed `CI_PROBE_GREEN`. CI shell syntax passed.
- Fallow dead-code reports the same five unrelated unused exports, one type and
  one duplicate pair observed before integration; no unresolved imports remain.
  Duplication scan has no finding involving the new encryption module or changed
  credential service. Unrelated existing findings were not changed.
- Fresh CLI Astra high review ran with verified read-only permissions and no
  approval authority. It verified artifact SHA-256
  `ef5fc65bb065bfbd02ebf193912f922b2ac446c122a02d3576ab79013b1823b5`
  and reported no material findings across 14 files, including critical credential
  and login consequences. This is same-lineage fresh context, not independent
  model confirmation. This later checkpoint prose is a nonfunctional delta;
  exact inspection/format/diff checks cover it without restarting code review.
- Limits: no real platform-account probe, no test on the friend's installed
  Bazzite package, and no native Windows/macOS wallet-failure test. Windows CI
  will exercise the real filesystem crypto tests; POSIX permission/alias cases
  are skipped there. Windows relies on inherited profile ACLs, synced key-file
  writes and atomic rename because Node cannot fsync directory handles there.
  Interrupted key-publication fault injection remains additional future coverage.
- DOX: root/main contracts, internal API and changelog updated. The credential-storage description in API volatility is also updated; platform
  API assumptions are unchanged. README, API etiquette and visual-design docs
  are intentionally unchanged because project stack, platform requests and UI
  are unchanged. Earlier approved
  safeStorage-only design remains historical, superseded for fallback by this
  explicitly approved scope.

Next: publish feature PR, inspect required final-head CI and available bot
feedback. Merge and release remain unauthorized. The user approved the disclosed
local-key security tradeoff, not those delivery steps.

### PR checkpoint

PR #328 publishes commit d49c1fa. GitHub Codex review found only remaining
safeStorage-only prose in the main contract and API-volatility document. Those
statements are corrected in a nonfunctional follow-up: no runtime, test or build
behavior changes. Exact prose diff, formatting and diff checks cover the delta;
the earlier general review remains the code anchor. CodeRabbit skipped automatic
review, so it supplies no substantive coverage. Required final-head CI is watched
with a bounded deadline. The synthetic Linux VM has been stopped.
