# Explore phase-A review coverage

## General anchor

- Base: `9dbac8b569efb27e03ef06882d96b89d8a45c969`.
- Reviewed head: `f65faf17fda6937f9fcd537859884aeaebfe470a`.
- Exact diff SHA-256:
  `f0214c65b195748632f00baa2cc2642f8c4de3df40c6187a4a1604c2bad94b66`.
- Artifact: 299,255 bytes, 5,678 lines, 34 files. Reviewer verified it against
  the commit range and confirmed affected working files matched.
- Fresh Codex CLI review: runtime reported Astra, high reasoning, approval
  never and enforced read-only sandbox. Process exited 0. This is same-lineage
  fresh context, not independent model confirmation.
- Tier T1: new code is not reached by existing production modules; no account
  or transport path was added. The review confirmed scope alignment and
  intentional phase-B deferral, with five correctness findings below.

## Findings and correction scope

| Finding                                            | Correction                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unknown VRC access treated as complete enumeration | Distinguish strict known non-public access from unknown/malformed IDs. Unknown qualification yields partial coverage/null count; fixtures cover both. Mutation bypass fails, source restored, 13 parser tests pass. |
| Incomplete empty sheet claimed no rooms            | Require complete coverage for definitive empty copy; incomplete coverage has localized copy and a focused test.                                                                                                     |
| Dashboard preview lacked source state              | Inject scoped platform snapshots and reuse loading/error/stale/unavailable presentation, including no-card states; a focused test covers each.                                                                      |
| Sheet platform identified only by color            | Add the established PlatformPill and platform-qualified accessible name; the test checks visible text inside the sheet as well as its accessible name.                                                              |
| Home/End moved one step instead of to bounds       | Preserve valid requested totals and map only intermediate 3/5 values; the focused test checks both bounds.                                                                                                          |

These are functional corrections confined to new phase-A code. They do not
change production integration, count meaning, access permissions or the approved
design. Focused fresh review must cover the corrected parser and UI behavior;
the general review's untouched shared ranking, isolation and handoff findings
remain applicable. Reassess the cumulative delta before publication.

## Evidence and current limit

The general anchor passed all 2,497 tests, uncached lint, formatting, both
typechecks and production build. Fallow reported eight existing dead-code
findings outside Explore and six new duplication groups with explicit
dispositions in the block ledger. Five earlier guard mutations and the later
unknown-access mutation failed as expected and were restored.

The corrected code passes all 2,503 tests (66 focused Explore/parser/ranking/locale
tests), uncached lint, formatting, both typechecks, build and diff whitespace.
Sentinel: `EXPLORE_CORRECTION_GATE_GREEN`. Four UI correction mutations each fail
one targeted test; exact source was restored and all 29 UI/locale tests pass.
Sentinel: `EXPLORE_REVIEW_MUTATIONS_GREEN`. Fallow remains at eight existing
dead-code findings and 551 duplication groups; no additional findings or groups
were introduced by these corrections.

Focused review and PR CI are pending. Browser/Electron appearance has not been
witnessed; no capture or live-account run is authorized.
Current verdict: corrections implemented, focused review pending before a draft
checkpoint with the visual and phase-B limitations retained. No merge grant exists.
