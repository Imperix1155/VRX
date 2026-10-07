# Security Policy

## Supported versions

VRX is in early development. Only the latest release and the current `main` branch receive fixes.

| Version               | Supported |
| --------------------- | --------- |
| `main` (latest)       | ✅        |
| Older tagged releases | ❌        |

## Reporting an issue

Please report any security concern privately rather than in a public issue.

Use **GitHub's private reporting**:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the concern and how to reproduce it.

This creates a private thread visible only to you and the maintainer.

## What to expect

- Acknowledgement within 5 days.
- An initial assessment shortly after.
- Updates as a fix is prepared; you'll be credited unless you prefer otherwise.

## Scope

VRX runs locally and signs in as the user on their own machine. Concerns about how VRX stores credentials or handles data from the VRChat and ChilloutVR APIs are in scope.

Issues in VRChat or ChilloutVR themselves are out of scope — please report those to their respective vendors.

## Application safeguards

Project-owned renderer-to-main IPC validates the sender in a trust-first registration shell before touching timer-free, per-channel sliding-window state, then validates it again inside every domain handler as defense in depth. The counters and warning suppression live for the main-process lifetime, so reloads and replacement windows share each channel's budget; denials do not include `retryAfterMs`. Untrusted frames cannot consume that state. The logger uses electron-log's main-only Node surface, and central IPC wiring removes electron-store's unused renderer bootstrap listener, leaving only the enumerated VRX channels. Budgets are fixed safety ceilings; repeated dual-platform retry/reconnect cycles can exhaust `get-friends` headroom before its window expires.

## Temporary dependency audit exception

The repository now applies an exact-source local patch to the locked 4.2.0
library during postinstall and verifies it before builds. It prevents security
reuse prohibitions from being overridden by max-stale, stale-while-revalidate,
or stale-if-error, including restored cache policies. Ordinary stale caching,
explicit upstream public/immutable cookie opt-ins, and private caches retain
their existing semantics. The version and advisory remain visible; this is not
an upstream release fix or advisory suppression. The exception and expiry below
are unchanged. An upstream replacement still needs behavioral verification;
4.3.0 must not be assumed fixed merely because advisory metadata omits it.

This build-tool cache flaw is distinct from local session theft. The later
pre-release security scan must cover OS-backed encryption and fallback key/file
permissions, logs and diagnostics, renderer/preload/IPC credential boundaries,
account switching, logout and persisted-cache cleanup, asynchronous work after
session changes, and updater/package integrity. No local encryption scheme
guarantees protection against a compromised OS or a process able to read both
the fallback key and encrypted session files. That wider scan is separate work.

Owner: repository maintainer Imperix1155. Tracking: [PR #345](https://github.com/Imperix1155/VRX/pull/345).
Approved by the owner on 2026-10-03 after disclosure; review by **2026-10-10**.
The gate automatically stops accepting this exception at **2026-10-11 00:00 UTC**.
Any extension requires a new explicit owner decision and review.

Only [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
at its current high severity is temporarily accepted for the locked, dev-only
`node_modules/http-cache-semantics` version `4.2.0`. The build-tool chain is
`app-builder-lib@26.17.0 → @electron/get@3.1.0 → got@11.8.6 → cacheable-request@7.0.4 → http-cache-semantics@4.2.0`.
As checked on 2026-10-03, upstream lists no patched version; the compatible
builder 26.17.0 still uses the affected downloader major. A builder 27 alpha or
npm's proposed builder downgrade is not a compatible stable security patch.

The defect can disclose another user's cached response in a shared HTTP cache.
This exception accepts the remaining development-tool dependency risk; it does
not substitute for verifying the local patch. The downloader's Got HTTP cache is
disabled by default; Electron's downloaded-artifact disk cache is separate.
The current production audit contains no findings, and this dependency does not
ship in the application. Do not enable shared HTTP caching or introduce runtime
use under this exception.

`scripts/audit-policy.mjs` checks both full and production audit reports and the
lockfile: changed version/path, missing dev-only proof, production exposure,
critical severity, expiry, malformed reports, and other high/critical advisories
fail. The existing esbuild advisory exception (GHSA-g7r4-m6w7-qqqr, VRX-152) is
unchanged for the full report; no exception applies to production high/critical
findings. Remove the cache exception as soon as a compatible patched dependency
or stable builder removes this chain, or immediately if its exposure changes.
The maintainer must check upstream and remove it by the review date rather than
silently renew it. No branch-protection or release approval is waived.
