# Review and merge

These requirements apply whatever agent, model, operating system, or local
skills you use. Your tools can choose how to do the work; the evidence and
safety requirements stay the same.

## Review the change that will ship

1. Record the requirements, base commit, review head, changed files, and the
   exact diff. A saved patch with its SHA-256 makes a delegated review
   reproducible.
2. Run the applicable [development checks](DEVELOPMENT.md#verification). For
   application JavaScript or TypeScript changes, also run the pinned audit
   `npx --yes fallow@3.30.0 audit --changed-since BASE_SHA --no-css`, with
   `BASE_SHA` replaced by the recorded PR base commit. It needs Node 22+,
   downloads the pinned tool if needed, and adds no project dependency. It
   checks dead code, complexity, and duplication; by default only findings
   your change introduces affect its verdict. Pin the base explicitly so a
   branch's upstream can't make it compare against itself. Read the verdict
   and findings, and don't use `--brief`, which always exits zero. If the tool
   can't run where you are, say so and check changed code for unused exports
   and duplicated logic with TypeScript, ESLint, and reading. Never use an
   unpinned tool or change dependencies just to satisfy a tool name.
3. Get a fresh-context general review before opening the PR: a separate agent
   or session, or a human, given the requirements, the applicable contracts,
   the exact diff, and the source, without your conclusions. Self-review can
   prepare a change but can't replace that review; if none is available,
   record the gap and leave merge readiness pending until a separate reviewer
   covers it. No specific provider, model, paid bot, or personal skill is
   required. Scale the review to the change: a purely non-functional
   documentation PR needs a brief fresh read plus the format and link checks,
   not an application review. Changes to workflow, security, or release rules
   are policy changes and need scenario checks. Dependency updates still need
   compatibility, security, tests, and a fresh review; who opened a PR, or its
   label, never makes it low risk.
4. Cover acceptance, correctness, security, session and lifecycle behavior,
   tests, and documentation sync, using the
   [root review rules](../AGENTS.md#code-review-rules). Policy-only changes
   need scenarios that exercise the new wording, not app tests written for
   prose.
5. Check each finding against the source or a decisive runtime probe. Fix
   real defects, or refute findings with evidence. A score or a count of
   reviewers who agree is not evidence. Report a missing review honestly.
6. Record in the PR the reviewed revision, what the review covered, findings
   and what you did about them, test evidence, and remaining limits, so
   another contributor can judge readiness without the original chat or a
   private skill.

## Risk

Ordinary changes follow the process above. A critical change has a credible
path to making VRX unusable or putting a user's platform account at risk: for
example startup or update failure, an essential workflow becoming
unreachable, exposed credentials, an action on the wrong account, or request
amplification that risks a platform ban. Judge by reachable consequences, not
by which file changed.

Critical changes need evidence and probes for those specific consequences,
explicit disclosure to the owner, and the owner's review and permission for
that risk before merging. Add targeted review where a concrete gap needs it;
there is no fixed number of extra reviewers. Get missing evidence before
repeating reviews. Reviewers on the same model give fresh context, not an
independent model's confirmation, and neither their agreement nor a missing
review bot waives these requirements. Security, irreversible-data, and
account risks need disclosure even when they can't make the whole app
unusable.

## Corrections and final-head coverage

The general review covers the change at the commit it reviewed. A functional
fix after that needs a focused review of the exact correction, the behavior it
affects, its callers, tests, and contracts, with a note on which earlier
conclusions still hold. Review all corrections together so coverage reaches
the actual final head.

Restart the general review when design or security assumptions change, shared
behavior is broadly affected, earlier conclusions fail, or the effects can't
be bounded. A small line count doesn't prove a small impact.

A verified non-functional correction changes no application, build, test,
release, security, workflow, or policy behavior. It needs focused format,
link, consistency, and diff checks, and keeps the existing general review.
Mixed or uncertain corrections follow the functional process. Required CI must
still pass on the final head.

## Automated feedback

PR bots are advisory at every risk level. Read the substantive reviews, inline
comments, collapsed summaries, unresolved threads, and which commit each one
actually reviewed. Resolve or refute real findings, even from an advisory bot.
A bare green check is not a review.

Missing, running, skipped, rate-limited, or quota-exhausted bot output needs
no waiting and no ceremonial re-request; report it as unavailable. The owner
can waive absent bot review for a scoped change at any risk level, but that
never waives local review, tests, real findings, or branch protection. Bot and
account configuration belongs to the maintainer's setup; never change
repository protection or review settings as part of ordinary delivery.

## Merge checklist

- The owner has explicitly allowed merging this PR, including any disclosed
  material risk. An earlier scoped permission still counts; review feedback
  alone grants nothing.
- The exact current head has the required local checks, review coverage,
  resolved real findings, and green required CI. Check the actual protection
  settings: a tool timeout, a missing check, or an advisory waiver is not a
  passing required check.
- Merge with a head-matching operation so a changed head can't ship on old
  evidence. Re-check if the head changes.
- Keep the PR record, and update the linked issue when there is one and you
  can reach it. Missing optional tracker access is a handoff note, not a merge
  blocker.

Never disable branch protection. This repository grants no admin bypass. If
an authorized maintainer's separate instructions allow an exception, check its
exact scope and every remaining requirement; otherwise report the blocker.
