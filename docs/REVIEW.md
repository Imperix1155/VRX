# Review and merge

What a change needs before it is merged into `dev`, `beta` or `main`. These
rules are the same whatever agent, model, operating system or local tools you
use; your tools choose how, the evidence below is what counts.

## 1. Review the change that will ship

1. **Write down what you are reviewing**: the request, the base commit, the
   head commit, the changed files and the exact diff. A saved patch with its
   SHA-256 makes a review someone else does reproducible.
2. **Run the checks** in [Development](DEVELOPMENT.md#verification) that fit
   the change. For changes to app JavaScript or TypeScript, also run the
   pinned audit, with `BASE_SHA` set to the PR's base commit:

   ```bash
   npx --yes fallow@3.30.0 audit --changed-since BASE_SHA --no-css
   ```

   It needs Node 22+, downloads the pinned tool if needed and adds no
   dependency. It reports dead code, complexity and duplication; only findings
   your change adds affect its verdict. Pin the base so a branch can't compare
   against itself, read the verdict, and never use `--brief` (it always exits
   zero). If it can't run where you are, say so and look for unused exports
   and duplicated logic with TypeScript, ESLint and reading. Never swap in an
   unpinned tool or add a dependency to satisfy a tool.

3. **Get a fresh-context review** before opening the PR: a separate agent or
   session, or a person, given the request, the contracts that apply, the
   exact diff and the source, but not your conclusions. Your own review can
   prepare a change; it can't replace this one. If none is available, record
   the gap and leave the PR not ready to merge until someone covers it. No
   specific provider, model, paid bot or personal skill is required.

   Scale it to the change. A documentation PR that changes no behavior needs a
   short fresh read plus the format and link checks. Changes to workflow,
   security or release rules are policy changes and need scenario checks.
   Dependency updates still need compatibility, security, tests and a fresh
   review: who opened a PR, or its label, never makes it low risk.

4. **Cover** acceptance, correctness, security, session and lifecycle
   behavior, both platforms, both themes, tests and documentation sync, using
   the [root review rules](../AGENTS.md#code-review-rules).
5. **Check every finding** against the source or a decisive runtime probe. Fix
   real defects; refute the rest with evidence. A score, or how many reviewers
   agree, is not evidence.
6. **Record in the PR** the reviewed revision, what the review covered, the
   findings and what you did about them, test evidence and remaining limits,
   so someone else can judge readiness without the original chat.

## 2. Risk

Most changes follow section 1. A **critical** change has a believable path to
making VRX unusable or putting a user's platform account at risk: VRX fails to
start or update, an essential workflow becomes unreachable, credentials leak,
an action lands on the wrong account, or requests multiply enough to risk a
platform ban. Judge by what can actually happen, not by which file changed.

A critical change needs evidence for those specific outcomes, a plain
explanation to the owner, and the owner's review and permission for that risk
before merging. Add targeted review where a real gap needs it; there is no set
number of extra reviewers. Get missing evidence before repeating reviews.
Reviewers on the same model give fresh context, not independent confirmation.
Security, data-loss and account risks need to be raised with the owner even
when they can't make the whole app unusable.

## 3. Fixes after the review

A review covers the commit it read. A functional fix after that needs a
focused review of the fix, the behavior it touches, its callers, tests and
contracts, with a note on which earlier conclusions still hold. Review all
fixes together so coverage reaches the final head.

Start the full review again when design or security assumptions change, shared
behavior is widely affected, earlier conclusions fail, or you can't bound the
effects. A small line count doesn't prove a small impact.

A non-functional fix (wording, formatting, a link) changes no app, build,
test, release, security, workflow or policy behavior. It needs format, link,
consistency and diff checks and keeps the earlier review. When unsure, treat
it as functional. Required CI must pass on the final head either way.

## 4. Automated reviewers

PR bots are advisory at every risk level. Read their reviews, inline comments,
collapsed summaries, open threads, and which commit each one reviewed. Fix or
refute real findings, even from a bot. A green check alone is not a review.

Missing, running, skipped or rate-limited bot output is unavailable evidence:
don't wait for it and don't re-request it for show. The owner can waive a
missing bot review for a scoped change, but never local review, tests, real
findings or branch protection. Bot and repository settings belong to the
maintainer; never change protection or review settings as part of a change.

## Merge checklist

- The owner has allowed merging this PR, including any risk explained to
  them. An earlier scoped permission still counts; review feedback alone
  grants nothing.
- The exact current head has the local checks, review coverage, resolved
  findings and a green `ci-success`. A timeout, a missing check or a waiver is
  not a pass.
- Merge with a head-matching operation (an expected head SHA) so a changed
  head can't ship on old evidence. If the head changes, check again.
- Keep the PR record and update the linked issue when there is one. Missing
  tracker access is a handoff note, not a blocker.

Never disable branch protection; there is no admin bypass. If a maintainer's
separate instructions allow an exception, check its exact scope and every
remaining requirement, otherwise report the blocker.
