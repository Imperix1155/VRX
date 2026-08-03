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
