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

General review, external critical reviews and current-head CI are pending.
The general review must record its immutable base/head/diff hash, actual routing,
findings and disposition here. Any Codex review is same-lineage fresh context,
not independent model-family confirmation. No merge readiness is claimed.
