# Security policy

## Supported versions

Only the latest release and the current `main` branch receive security fixes.

| Version                   | Supported |
| ------------------------- | --------- |
| Latest release and `main` | ✅        |
| Older releases            | ❌        |

## Report a vulnerability

Please report security problems privately, not in a public issue:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Describe the problem and how to reproduce it.

This opens a private thread with the maintainer. Expect an acknowledgement
within 5 days, an initial assessment soon after, and updates while a fix is
prepared. You'll be credited unless you prefer not to be.

## Scope

VRX runs on your own computer and signs in to VRChat and ChilloutVR as you.
How VRX stores sessions, handles data from those platforms, talks to them, and
updates itself is in scope. Problems in VRChat or ChilloutVR themselves are
out of scope; report those to the platforms.

## How VRX protects you

- **Sessions.** Saved sessions are encrypted with Electron `safeStorage`, which
  uses your operating system's secure storage. If that is unavailable or fails,
  VRX encrypts them with authenticated encryption and a random key created for
  your installation, kept in VRX's private app files. That fallback is weaker:
  anyone who can read both the key and the encrypted session can reuse the
  session. VRX never uses Electron's `basic_text` mode and never saves
  passwords. Signing out deletes the saved session.
- **Isolation.** The app window runs with `contextIsolation`, `sandbox`, and
  no Node integration. The page can reach the main process only through a
  fixed list of VRX channels. Every channel checks that the request comes from
  VRX's own window, then applies a per-channel request budget. Session tokens
  never reach the page.
- **Links and content.** VRX opens only allowlisted web addresses in your
  browser, blocks navigation away from the app, and ships a Content Security
  Policy without `unsafe-inline`.
- **Logs.** Passwords, tokens, and cookies are removed before anything is
  written to the log file, and your home folder path is replaced with `~`.
- **Other apps' data.** VRX never writes to VRCX, ChilloutVR or CVRX files. It
  reads the sign-in VRCX, ChilloutVR or CVRX saved on this PC only when you
  press "Use my sign-in from VRCX" or "Use my sign-in from ChilloutVR", and the
  platform checks that sign-in before VRX saves it.
- **Saved pictures and names.** VRX keeps VRChat pictures (up to 14 days) and
  world and group names (up to a day) in its private app files so they show
  at once on the next launch. Signing out of VRChat in VRX deletes them.
- **Updates.** Updates come only from this repository's GitHub Releases and
  never install without your consent.
- **Repository.** CI scans every pull request and every push to `main` for
  committed secrets (gitleaks) and for high or critical dependency advisories,
  and CodeQL scans the code weekly and on every pull request.

No local encryption can protect a session from malware that runs as you or
from someone who can read your files.

## Temporary dependency exception

One development-only advisory is temporarily accepted.
[`scripts/audit-policy.mjs`](scripts/audit-policy.mjs) enforces it in CI, and
this section is the record of the owner's approval.

- **Advisory:** [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
  (high) in `http-cache-semantics` 4.2.0. A shared HTTP cache could serve one
  user's cached response to another.
- **Where it comes from:** the packaging tool only:
  `app-builder-lib@26.17.0 → @electron/get@3.1.0 → got@11.8.6 → cacheable-request@7.0.4 → http-cache-semantics@4.2.0`.
  It is a development dependency and is not part of the installed app. The
  production audit is clean.
- **Mitigation:** `npm ci` runs
  [`scripts/patch-http-cache.mjs`](scripts/patch-http-cache.mjs), which patches
  the locked library so security-related reuse rules can't be overridden by
  `max-stale`, `stale-while-revalidate`, or `stale-if-error`. Builds verify the
  patch first. The downloader's HTTP cache is also off by default.
- **Why no upgrade:** `http-cache-semantics` 4.3.0 does not fix this advisory
  (it changed only `Vary` matching), and the compatible packaging tool still
  pulls 4.2.0. npm's advisory range predates 4.3.0, so a clean audit after
  upgrading would be a false result.
- **Approval:** approved by the owner (Imperix1155) on 2026-10-03, extended
  after upstream reviews on 2026-10-09 and 2026-10-19. Tracking:
  [PR #345](https://github.com/Imperix1155/VRX/pull/345).
- **Expiry:** review by **2027-01-30**. CI stops accepting the exception at
  **2027-01-31 00:00 UTC**. A further extension needs a new owner decision.
- **Removal:** remove the exception as soon as a compatible fixed release
  removes this chain, or at once if the package ever reaches the installed app.
- **Rechecked 2026-10-22** (Vigil report): still no fix. The advisory lists no
  patched version, `npm audit fix` offers no non-breaking path, the newest
  packaging tool on the 26.x line still uses `@electron/get` 3 → `got` 11, and
  an override to 4.3.0 would only silence the audit (see above).

### Dependency overrides

`package.json` `overrides` holds one development-only pin. Remove it when
Vite ships that version itself.

- **`esbuild` ^0.28.2 under `vite`:** keeps Vite's build tool current until
  Vite ships the same version. Vite 7.3.7 accepts `^0.27.0 || ^0.28.0`. The
  Vite 8 upgrade (PR #379) makes this override unnecessary.

The policy fails the audit on any other high or critical advisory, any
production high or critical advisory, a changed version or dependency path,
a critical severity, expiry, or a malformed report. No other advisory is
excluded. No exception applies to production findings, and no branch
protection or release approval is waived.
