# Security policy

## Supported versions

Only the latest stable release and the current `main` branch receive security
fixes. Fixes reach `dev` builds too.

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
  your installation, kept in VRX's private app files. That fallback is weaker
  than the operating system's storage. VRX never uses Electron's `basic_text` mode and never saves
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
- **Repository.** CI scans every push and pull request for committed secrets
  (gitleaks) and for high or critical dependency advisories, and CodeQL scans
  `main` weekly and on every pull request into it.

No local encryption can protect a session from malware that runs as you or
from someone who can read your files.

## Development-only HTTP cache patch

The packaging tool pulls in `http-cache-semantics` through
`app-builder-lib → @electron/get → got → cacheable-request`. It is a
development dependency and is not part of the installed app.

As security hardening, `npm ci` runs
[`scripts/patch-http-cache.mjs`](scripts/patch-http-cache.mjs), which patches
the locked version of that library, and every build verifies the patch first.
An unexpected library version or source fails closed and needs a reviewed
update. Remove the patch when an upstream release makes it unnecessary and
[`scripts/http-cache-security.test.mjs`](scripts/http-cache-security.test.mjs)
passes without it. If this package ever reaches the installed app, review that
path before dropping the patch.

## Dependency overrides

`package.json` `overrides` pins a dependency to a hardened release when its
parent package hasn't moved to that release yet. Each pin stays only until
every parent asks for a fixed release itself; then remove it.

- **`undici`** under `@electron/get` and `node-gyp`.
- **`minimatch`** everywhere, and **`glob`** for the affected range only. A
  global `glob` pin would break the callback API that `@electron/asar` 3 and
  `rimraf` 2 still use, so older `glob` 7 stays. These are build and lint
  tools, and the packaging path VRX uses doesn't call the patterns that newer
  `minimatch` rejects. Check packaging still works when you change them.

## Audit policy

[`scripts/audit-policy.mjs`](scripts/audit-policy.mjs) fails CI on any high or
critical advisory, including production findings, and on a malformed audit
report. No advisory is excluded, and no branch protection or release approval
is waived. An exception is allowed only for a development-only advisory with
no fixed release; [Development](docs/DEVELOPMENT.md#dependency-and-security-changes)
has the rule.
