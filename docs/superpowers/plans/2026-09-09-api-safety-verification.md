# API-safety verification and review ledger

Scope: [approved six-unit plan](2026-09-09-api-traffic-hardening-plan.md), tracked
by VRX-218. Base `9dbac8b569efb27e03ef06882d96b89d8a45c969`. Feature branch
`imperix/vrx-218-api-traffic-hardening`. This is T2 because incorrect admission,
retry or account ownership can expose platform accounts to unsafe traffic.
Implementation and publication are authorized; merge and live-account testing
are not. Explore remains gated on a final reviewed, merged dependency and its
separately approved traffic allowance.

## Acceptance evidence

| Requirement                         | Decisive evidence                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared platform pacing and cooldown | `BaseAdapter.test.ts` counts physical REST/image attempts, both directions of 429 propagation and deadline extension; `ApiAdmissionController.test.ts` checks queue bounds, priority, cancellation, platform independence and long waits.                                                                 |
| Original account ownership          | VRC/CVR adapter tests cover queued logout, replacement login, stale response publication and unchanged persistence/restore/2FA behavior. Avatar tests cover quarantined sessions, original image leases, cookie-free redirects, queue cancellation and cache replacement.                                 |
| Stop batches on 429                 | Paginator tests cover probe/first/later-page rate limits, useful partial results and no next pass. Concrete adapter tests count physical requests; resolver tests distinguish rate limits from negative-cacheable failures.                                                                               |
| Preserve partial/cached data        | IPC tests retain main authority semantics, expose only a partial marker and sanitize rate errors. Pure and mounted query tests retain omitted current-cache friends. Complete rosters retain replacement behavior.                                                                                        |
| Coalesce refreshes                  | Before the fix, 20 VRC callers made 60 physical calls; 20 CVR callers plus warming made 21. They now share one roster. Both-platform integration tests use 100 events around a held initial/final read, assert one follow-up and its result for all callers, and verify later recovery and no 429 replay. |
| Reconnect restraint                 | Sixteen fake-clock tests cover brief flaps, 60-second healthy reset, seconds/date/fallback waits, repeated rejection, error/close races, extension during credential preparation, long waits, stop and restart. Both existing platform event suites remain green.                                         |
| Real socket resource cleanup        | Both production factories connect to a disposable loopback server returning an unfinished 429 body. The real installed `ws` connection closes and reports only status/Retry-After. No external endpoint is used.                                                                                          |
| Mixed topology                      | `TrafficAdmission.integration.test.ts` composes both real adapters and AvatarCache. VRC's existing bounded action retry and API image wait behind the VRC controller; CVR auth proceeds independently. Physical timestamps preserve pacing, and the CDN receives no cookie.                               |
| Actual Electron error boundary      | A hidden, disposable Electron window uses the real friends IPC handler, preload invocation normalizer and renderer QueryClient against a synthetic RateLimitError. Result: `rate_limited`, one query, one main invocation. No seed/success stamp occurs.                                                  |

## Gates and mutations

Units 1–5 each passed their applicable project gates; the progress ledger records
their test counts, sentinels and local commits. Removing shared image admission,
session leases, batch rate-limit propagation, partial-cache merging, roster
coalescing or sustained-open reset makes the corresponding regression fail.
Each mutation restored the exact source in `finally` before normal verification.

The integrated suite passed **165 files / 2,522 tests**. Fresh-cache lint, formatting, build and diff checks passed with
`A6_PROJECT_GATE_GREEN`. Build includes both TypeScript targets and the entry
chunk assertion. These are local/synthetic results, not live-account or release
verification. The renderer change is cache semantics only; no controls, layout,
wording or design artifacts changed.

## Static analysis disposition

Fallow 2.89.0 ran dead-code and duplicate checks against files changed since the
base, without its analysis cache. Dead-code reports one unused type export,
`IpcEventChannel`, whose identical declaration already exists at the base; no
new unused export/dependency or unresolved import was reported. It remains
unchanged rather than broadening this patch.

The full duplication report includes repeated test fixtures. The production
pass reports eight groups, 244 duplicated lines (0.87%): trust-first IPC guards,
subscriber disposal, separate auth-result fences, corresponding world/group
enrichment paths, wire decoding and existing combined-query folding. Inspected
groups retain their distinct responsibilities; none requires a new shared
boundary for this fix. Shared scheduling and roster ownership already use one
implementation. Duplication output is not treated as a blanket correctness pass.

## Isolated Electron probe provenance

The temporary probe and static-analysis artifacts are saved locally at
`/private/tmp/vrx-api-safety-tfocgrj4`. The probe bundles repository source with
the installed esbuild, uses the installed Electron binary, and creates a fresh
temporary userData and partition. Its only server is bound to loopback. The
installed VRX application, saved accounts and credential stores are untouched.

Commands used after preparing the fixture:

```sh
node /private/tmp/vrx-api-safety-tfocgrj4/build-probe.cjs
./node_modules/.bin/electron /private/tmp/vrx-api-safety-tfocgrj4/main.cjs
```

Observed final sentinel:

```text
A6_ELECTRON_IPC_GREEN {"message":"rate_limited","calls":1,"mainAttempts":1}
```

Source SHA-256:

| Local artifact    | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `ipc-main.ts`     | `561e3030bf33d5202c50edd3dcea335dff41283f63f135e3e6c73945c4801cbf` |
| `ipc-renderer.ts` | `a894b95ae846f34c2a152ef95a0b83db78cc8508b9ccc9f5eeddab16ffc9358e` |
| `build-probe.cjs` | `f49f2e55f8a32822e785c975f18a68148709d1fe2f08daf06eb63d31dddc8e77` |

The first launch was blocked by the sandbox. An elevated synthetic run exposed
a reversed fixture argument order, which was corrected before the successful
run. Neither attempt is counted as passing evidence. Temp artifacts are local
evidence, not packaged application files or a claim of permanent remote storage.

## Review and delivery

General review used fresh Astra at High through an ephemeral read-only CLI
session (v0.153.4, approval never) over base `9dbac8b` through
`46d155fdbf4eb323313887d2b88c15415e021c8f`. Artifact SHA-256:
`3594f4e03b51a208685b52cebe17521512b39a5dc457e40d00562e2e17923283`,
480,817 bytes / 8,536 lines / 61 files. The reviewer verified the artifact
against Git and reported two material findings before PR creation:

- P1: a later IPC caller joining a shared roster supplied a newer location fence
  to old data, overwriting a newer live location. Both real-adapter/IPC
  regressions reproduced this. The correction captures each physical read's
  revision, including warming before IPC, and preserves separate chronological
  seed batches when the follow-up is partial. Reconnect tests cover fresh final
  data, live updates, stale omissions and removal semantics.
- P2: a metadata worker could resume the old batch after a short cooldown while
  another worker had already rejected; early settlement also released pending
  ownership. The correction permanently latches failure, retains ownership until
  all active workers settle and reports resolver failures immediately so a 401
  cannot wait behind another response. World/group regressions cover resumed
  guards, untouched IDs, later auth failure and adapter ownership/invalidation.

These are bounded corrections to publication provenance and metadata pool
lifetime. Admission, session-lease architecture, image transport, pagination,
reconnect and renderer contracts remain under the general anchor; focused
review must validate the exact corrections and their cumulative effects.
External critical reviews and current-head CI remain pending. All Codex review
is same-lineage fresh context, not independent model-family confirmation.
No merge readiness or merge authority is claimed.

### Correction verification

The corrected full suite passed 165 files / 2,532 tests. Lint initially rejected
six unnecessary test assertions; removing them changed no runtime behavior.
The affected 38 tests passed again, followed by lint, format, build and diff
checks (`FOCUSED_PROJECT_GATE_GREEN`). Both metadata latch mutations failed by
dispatching the untouched ID after recovery; exact sources were restored and
the 20 pool tests passed (`FOCUSED_MUTATION_GREEN`). The first mutation command
selected an outdated test name and skipped all tests; it is excluded as evidence.

The initial adapter auth fixture accidentally subscribed a synthetic session
and started a reconnect loop that interfered with later mocks. It now observes
the private emitter without subscribing. The final suite is clean. No real
account credentials were used.

Refreshed Fallow dead-code analysis retains only the unchanged pre-existing
`IpcEventChannel` type. Production duplicate analysis reports nine groups /
311 lines (1.11%); the additional group is the corresponding world/group pool
stop logic, intentionally kept in the existing separately typed fetchers. The
other groups remain the reviewed guards, auth fences, event decoding and query
folding. No new unused export/dependency/import failure was found. Focused
review of these exact corrections is next.

### Focused review result

Fresh Astra at High, CLI v0.153.4, explicit read-only sandbox and approval never,
reviewed `46d155fdbf4eb323313887d2b88c15415e021c8f` through
`24dba5b33a38a911f78b4dda7dd221e4464d5736`. Artifact SHA-256
`e00d96702856f251725f5576bf0600b04d9ef83fd08a92e4123f7d4fdba9dc7e`:
74,748 bytes / 1,066 lines / 19 files, verified byte-identical to Git. Both
original findings are closed; no actionable introduced/exposed finding remains.
Local correctness verdict: SHIP. Merge verdict: PARK pending external reviews,
current-head CI, dependency-audit resolution and owner authority.

The reviewer independently exercised in-memory roster, metadata and physical
attempt probes: both platforms, repeated joiners, partial/complete follow-ups,
rate-limit fallback, account replacement, both failure orders, pending ownership,
no post-cooldown resumption and late auth invalidation. Full project gates and
mutations were inspected as driver evidence rather than rerun by the reviewer.
The general anchor plus this complete cumulative correction review cover the
functional head. Unchanged admission, leases, images, pagination, reconnect and
renderer conclusions remain valid; no broadened design assumption or unbounded
effect required restarting general review. Reports and runtime logs remain in
the temporary artifact directory named above.

This ledger-only update changes no executable or policy behavior; focused
format/consistency and diff checks cover it. Required final-head CI and
substantive CodeRabbit/Greptile coverage of the initial PR head remain required.
The unchanged baseline js-yaml 4.3.1 audit failure is owned by the separate
dependency repair; no package or lockfile change is included here.

### Dependency integration and zero-delay 429 follow-up

The normal branch merge imports the exact merged dependency commit `f783e77`:
one js-yaml lock node, version/resolved/integrity 4.3.1 → 4.3.2. No upstream
application change is present. Installed production electron-updater resolves
4.3.2. High-threshold npm audit passes; only a low advisory remains. An offline
probe uses electron-updater's actual `parseUpdateInfo` and `resolveFiles` for a
valid release document, confirms malformed YAML rejection and ordinary merge-key
parsing, and prints `DEPENDENCY_INTEGRATION_PROBE_GREEN`. No updater or account
network calls are made by the probe.

GitHub Codex finding at `3c5a9cd`:
https://github.com/Imperix1155/VRX/pull/307#discussion_r3973924358.
Applied as a functional correction: Retry-After zero plus zero jitter left queued
batch waiters alive because draining depended on positive remaining cooldown.
Both numeric-zero and immediate-date tests failed before the fix. Every 429 now
rejects existing no-retry waiters, even if fresh work is already eligible; their
abort listeners are removed. Explicit work retains its slot/normal pacing, and
fresh caller-owned requests remain eligible. A physical transport test checks
that queued batch requests never dispatch after the first 429. Prior local and
CodeRabbit coverage remains anchored to earlier heads until focused and required
external review cover this complete integration delta.

Integration gate: 165 files / 2,535 tests passed, followed by fresh-cache lint,
formatting, build and diff checks (`INTEGRATION_PROJECT_GATE_GREEN`). Removing
the unconditional 429 drain makes all three new regressions fail; restoring the
exact source returns them green (`ZERO_DELAY_MUTATION_GREEN`). Focused Fallow
reports zero introduced dead-code issues and zero production clone groups in
files changed since the prior PR head. The cumulative pre-existing findings
remain under the prior reviewed disposition. API shapes and design artifacts
remain unchanged; API policy/catalog, owning contract and changelog describe
zero-delay termination. Focused review of this integrated head is next.

### Resolved-permit and batch-continuation correction

Fresh read-only Astra/High focused review of `3c5a9cd` → `7c69a39` returned
FIX-FIRST. The exact integration artifact SHA-256 is
`4ad632334f388bba68f92c212e35301649bd4367c3d8d3c37ba143609b5810f0`
(15,792 bytes / 291 lines / 10 files). The dependency merge and updater probe
were sound, but a no-retry permit removed from the queue just before a zero-delay
429 could still reach fetch. CodeRabbit's substantive clean review of `7c69a39`
did not invalidate that reproduced race. Prior-head CI was green; it does not
cover the correction below. Greptile has not supplied substantive output for
either published functional head.

The controller now advances a main-only rate-limit revision on every 429.
BaseAdapter checks the operation's captured revision after admission, before
fetch. The same revision fences later VRC roster pages, world/group worker
launches, metadata kicked after a completed roster, and the shared coalescer's
dirty follow-up on both platforms. A successful in-flight result remains usable;
fresh later operations capture the new revision. Existing explicit retries,
session leases and platform pacing remain unchanged.

Eight added regressions cover numeric zero, immediate HTTP dates, positive-wait
control, both metadata pools, online and terminal offline roster pages, and a
dirty follow-up followed by a fresh read. The five relevant files pass 307 tests.
Before fixes, each newly identified continuation was reproduced. A missing
RateLimitError import initially made pagination stop through generic-error
fallback; the typed rate-limit assertion caught it and the import was fixed.

Five separate source mutations remove the resolved-permit guard, metadata
worker guards, paginator guard, post-roster enrichment guard and follow-up
guard. They produce respectively 2, 2, 1, 1 and 1 expected test failures, then
restore exact source (`REVOCATION_MUTATION_GREEN`). The positive-wait control
remains green without the new permit guard. Artifacts: `revocation-mutation.py`
and `revocation-mutation.log` in the existing temporary artifact directory.

Focused Fallow dead-code analysis reports zero issues. Production duplicate
analysis in affected files reports six groups / 200 lines: five are retained
adapter auth/event/metadata patterns, and the new seven-line pair is intentional
identical coalescer wiring in both adapters. Centralizing the operation in
RosterRefresh already owns the behavior; no extra abstraction is warranted for
those constructor callbacks. No new dependency/import issue is reported.

DOX updates the main and platform contracts, callable API catalog, API policy
and changelog. No new API-shape assumption, renderer, visual or interaction
change is introduced; volatility/design artifacts and indexes stay unchanged.
This correction narrows the existing stop-on-429 contract; final focused review
must assess its cumulative behavior with the previous review anchors. No merge
readiness or additional authority is implied.

Correction gate: 165 files / 2,543 tests pass, including the two disposable
localhost socket fixtures rerun under their existing test allowance after the
sandbox denied binding. Fresh-cache lint, format, build and diff checks pass
(`REVOCATION_PROJECT_GATE_GREEN`). The only subsequent edit is this evidence
record; focused format/diff checks cover it. New focused review and required
current-head CI/external review remain pending.
