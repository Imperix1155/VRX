# Review and merge

These requirements apply regardless of agent, model, operating system, or local
skill library. Local review tools can choose how to perform the work, but the
repository's evidence and safety requirements remain the same.

## Review the change that will ship

1. Record the requirements, base commit, review head, changed files, and exact
   diff. A saved patch with a SHA-256 makes delegated review reproducible.
2. Run the applicable [development checks](DEVELOPMENT.md#verification).
   For application JavaScript/TypeScript changes, use the pinned command
   `npx --yes fallow@3.30.0 audit --changed-since BASE_SHA --no-css`, replacing
   `BASE_SHA` with the recorded PR base commit. This uses Node 22+ and downloads
   the pinned tool if needed; it does not add a project dependency. The audit
   checks dead code, complexity, and duplication, with only introduced findings
   affecting its verdict by default. Pin the base explicitly so a feature
   branch's upstream cannot make the audit compare against itself. Inspect the
   verdict and findings; do not use `--brief`, which always exits zero.
   If the tool cannot run under the local environment's access policy, report
   the limitation and use TypeScript, ESLint, and targeted inspection of changed
   code for unused exports and duplicated logic. Do not use an unpinned tool or
   change dependencies merely to satisfy a tool name.
3. Obtain a fresh-context general review before opening the PR. Give a reviewer
   the requirements, applicable contracts, exact diff, and source, without the
   builder's conclusions. Use a separate agent/session or human reviewer. If
   unavailable, self-review can prepare the change but cannot replace the
   required fresh-context coverage. Record that gap and leave merge readiness
   pending until a separate session or human supplies the review. No specific
   provider, model, paid bot, or personal skill is required. Scale that review
   to the change: a purely nonfunctional documentation PR needs a brief fresh
   read and the documented format/link checks, not an application review.
   Instructions that change workflow, security, or release behavior are policy
   changes and need scenario checks. Dependency updates retain compatibility,
   security, applicable tests, and fresh review; the PR author or label alone
   never makes a change low risk.
4. Cover acceptance, correctness, security, lifecycle/session behavior, tests,
   and documentation sync. Use [root review rules](../AGENTS.md#code-review-rules).
   Policy-only changes need scenarios exercising the new instructions, not
   app tests manufactured for prose.
5. Verify findings against source or a decisive runtime probe. Fix material
   defects or refute findings with evidence. A score or agreement count is not
   evidence. Report missing review honestly.
6. Record the review revision, coverage, findings and dispositions, test
   evidence, and remaining limits in the PR. Keep enough evidence for another
   contributor to understand readiness without the original chat or private skill.

## Risk

Ordinary changes use the process above. Critical changes have a credible path
to making VRX unusable or endangering a user's platform account. Examples include
startup/update failure, inaccessible essential workflows, exposed credentials,
wrong-account actions, or request amplification that risks a platform ban.
Classify reachable consequences, not the name of the changed file.

Critical changes need evidence and probes for those specific consequences,
explicit disclosure to the owner, and owner review/authority covering the risk
before merge. Add targeted review where a concrete gap requires it; there is
no fixed extra-reviewer count. Obtain missing evidence before repeating reviews.
Same-model reviewers give fresh context, not independent model confirmation.
Neither their agreement nor an unavailable review bot waives these requirements.
Security, irreversible-data, and account risks still need disclosure even when
they do not make the whole app unusable.

## Corrections and final-head coverage

The general review anchors the change at its reviewed commit. A functional fix
needs focused review of the exact correction, affected behavior, callers, tests,
and contracts. Explain which earlier conclusions remain valid. Review the
cumulative corrections so coverage reaches the actual final head.

Restart general review when assumptions about design or security change, shared
behavior is broadly affected, earlier conclusions fail, or effects cannot be
bounded. Small line counts do not prove small impact.

A verified nonfunctional correction changes no application, build, test,
release, security, workflow, or policy behavior. Use focused format, link,
consistency, and diff checks for it, retaining the existing general review.
Mixed or uncertain corrections follow the functional process. Required CI must
still pass on the final head.

## Automated feedback

PR bots are advisory at every risk level. Inspect substantive available reviews,
inline comments, collapsed summaries, unresolved threads, and the commit they
actually reviewed. Resolve or refute material findings even from an advisory bot.
Do not treat a bare green check as substantive review.

Missing, running, skipped, rate-limited, or quota-exhausted bot output alone
requires no wait or ceremonial review request. Disclose it as unavailable.
A scoped owner waiver of absent bot review applies at every risk level, but
cannot waive local review, tests, material findings, or actual branch protection.
Bot/account configuration belongs to the maintainer's local setup. Do not change
repository protection or review settings as part of ordinary delivery.

## Merge checklist

- Explicit owner merge authority covers this PR and any disclosed material risk.
  An earlier scoped grant remains valid; review feedback alone grants nothing.
- The exact current head has required local checks, review coverage, resolved
  material findings, and required CI green. Inspect current protection settings;
  a tool timeout, absent check, or advisory waiver is not a passing required check.
- Use a head-matching merge operation to prevent a changed head shipping under
  stale evidence. Recheck if the head changes.
- Preserve the PR record and update a linked issue when one exists and access is
  available. Missing optional tracker access is a handoff item, not a merge gate.

Do not disable branch protections. This repository grants no admin bypass.
If an authorized maintainer's separate instructions permit an exception, verify
its exact scope and all remaining requirements; otherwise report the blocker.
