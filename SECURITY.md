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

## Development-only HTTP cache patch

`http-cache-semantics` is pulled in by the packaging tool only:

`app-builder-lib@26.17.0 → @electron/get@3.1.0 → got@11.8.6 → cacheable-request@7.0.4 → http-cache-semantics@4.3.0`.

It is a development dependency and is not part of the installed app.

[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
(high) says a shared HTTP cache could serve one user's cached response to
another. The published range is `<=4.2.0`. The lockfile resolves 4.3.0, which
is outside that range, so `npm audit` does not report it. There is no audit
exception for it.

4.3.0 does not change that reuse behavior. Its release changes `Vary`
matching and returns the cached status on a hit. `npm ci` still runs
[`scripts/patch-http-cache.mjs`](scripts/patch-http-cache.mjs), which patches
the locked 4.3.0 library so security-related reuse rules can't be overridden
by `max-stale`, `stale-while-revalidate`, or `stale-if-error`. Builds verify
the patch first. The downloader's HTTP cache is also off by default.

Remove the patch when an upstream release changes that behavior and
[`scripts/http-cache-security.test.mjs`](scripts/http-cache-security.test.mjs)
passes without it. If this package ever reaches the installed app, review
that path before dropping the patch.

### Dependency overrides

`package.json` `overrides` pins a dependency when the parent package has not
shipped the fixed release yet. Remove a pin when the parent does.

- **`undici` 7.30.1 under `@electron/get`, and 6.29.1 under `node-gyp`:**
  [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)
  (high) is fixed in those versions. `@electron/get` 5.0.0 still requests
  `undici` ^7.24.4 and resolves 7.30.0; npm counts that copy as production
  because `electron` satisfies the `@electron-toolkit/utils` peer dependency.
  `node-gyp` 12.4.0 still resolves `undici` 6.29.0, which is development-only.
  jsdom already uses `undici` 8.12.3, outside the advisory range. Remove the
  pins when those parents depend on a patched release themselves.
- **`minimatch` 11.0.1 everywhere, and `glob` 14.0.2 under `@electron/asar`
  4.3.1:** [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  (moderate) covers every `minimatch` below 11.0.1, and
  [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
  (moderate) covers `glob` 9.0.0 through 14.0.1. The lockfile had `minimatch`
  3.1.5, 5.1.9, 9.0.9, and 10.2.5, plus `glob` 13.0.6 under `@electron/asar`
  4.3.1. The `glob` pin is limited to that asar release. The `"."` entry keeps
  the direct `@electron/asar` spec at `^4.3.1`; npm rejects a versioned
  override of a direct dependency when the spec changes. `glob` 7.2.3 stays
  because it is outside the glob advisory, and a global `glob` pin would
  replace the callback API that `@electron/asar` 3.4.1 and `rimraf` 2 still
  call. That remaining `glob` 7.2.3 now resolves `minimatch` 11.0.1. A
  leading-`**` pattern such as `**/*.md` throws in `glob` 7's walker;
  packaging does not call that walker. It matches unpack patterns with
  `Minimatch` and writes the archive through `createPackageFromStreams`.
  These packages are build and lint tools, not the running app. Remove the
  pins when every parent requests a patched release itself.

The policy fails the audit on any high or critical advisory, including
production findings, and on a malformed report. No advisory is excluded.
No branch protection or release approval is waived.
