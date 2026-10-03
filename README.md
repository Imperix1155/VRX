# VRX

> Social VR companion for VRChat + ChilloutVR — like VRCX and CVRX, unified.

VRX is a local desktop Electron app that brings your VRChat and ChilloutVR social lives into one place. Friends list, presence, hot instances, notifications, and more — using live WebSocket presence, with no bots or writes to VRCX or CVRX data.

**Status:** Preparing for a Windows-first 1.0; 1.0 is not yet declared shipped. VRChat and ChilloutVR support direct login,
session restore, live friends and the hot-instance dashboard. Local manual
identity linking adds combined profiles, separate shared/account notes and an
explicit destination chooser. The app also includes theming and auto-update.
API traffic shares per-platform pacing and cooldowns; session changes cancel
obsolete requests. Existing slow recovery/manual roster reads coalesce, while
WebSockets remain the live presence path. See the API policy for the limits of
these safeguards.

Explore adds public-world discovery to the sidebar and Dashboard. Both views
share a session cache, with bounded visible-view refreshes and room details.
The platform filter and 2/4/6 world choice persist; Join uses the existing
confirmation and permission settings. Current behavior is documented in the
[design contract](docs/DESIGN.md) and [API catalog](docs/INTERNAL-API.md).

Navigation contains Dashboard, Friends, Explore, and Settings. Activity and
Groups are deferred concepts and do not appear as unfinished tabs.

## Install and support

Windows is the primary 1.0 target; use the NSIS installer for automatic update
support or the portable executable for manual updates. Linux AppImage/deb builds
are experimental. macOS builds are for local development and are not published
by the release workflow. See [Install and support](docs/INSTALL.md) for choosing
an artifact, update channels, limitations, and reporting problems.

## Sessions and privacy

VRX signs in to each platform on your behalf. Saved sessions use Electron
`safeStorage` with OS-backed encryption when available. If that is unavailable
or fails, VRX uses authenticated local encryption with a random per-installation
key in private app files. This fallback is weaker: access to both that key and
the encrypted data permits session recovery. Passwords are not saved.

With no valid saved VRX ChilloutVR session, VRX asks before discovering or
copying a session from local ChilloutVR game profiles or CVRX files. Direct
sign-in is the default choice. Settings → Accounts → External ChilloutVR session
lets you choose Never, Ask, or Allow; changes apply on the next app launch.
Existing VRX sessions are unaffected. Source files are never changed. If the
choice cannot be saved, no external session is read and VRX explains the failure.

Desktop friend notifications default off. When enabled, Ask Me/DND locations
remain hidden even when a cached world name or parseable location is available;
online notifications and generic world-entry notifications remain available.

## Stack

Electron 44 · React 19 · Vite 7 · TypeScript 6.0 strict · electron-vite

Electron 44 requires macOS 13 or later and provides only 64-bit x64 and arm64
binaries. See the [upstream platform changes](https://www.electronjs.org/blog/electron-44-0#breaking-changes).

## Development setup

Use Node.js **22.22.2 or a later 22.x patch** with npm. `.nvmrc` selects the
supported line; with nvm, run `nvm install` and `nvm use` first.

```bash
npm ci
npm run dev
```

Read [Development](docs/DEVELOPMENT.md) for prerequisites and verification,
[Review](docs/REVIEW.md) for PR readiness, and [Releasing](docs/RELEASING.md)
for versioning and publication. These procedures work without personal agent
skills or a Linear integration. Device permissions and agent-specific tools
remain part of your local setup.

## Build

Run the [development gate](docs/DEVELOPMENT.md#verification) first, then choose
the packaging command for your operating system:

```bash
npm run build:win    # Windows (NSIS installer + portable)
npm run build:mac    # macOS (DMG)
npm run build:linux  # Linux (AppImage + deb)
```

## Docs

[`docs/design.html`](docs/design.html) is the human visual guide. Run
`npm run guide:dev`, then open `http://127.0.0.1:4173/design.html`. Its examples
import real renderer components, tokens, fonts, and translations with synthetic
local data. `glass.html` runs those same scenes independently. Both themes,
glow levels, and representative states can be inspected without an account.
Account, game-launch, and updater actions never reach Electron.

`npm run guide:build` typechecks and builds the guide into `dist/design-guide`.
`npm run guide:preview` serves that build at
`http://127.0.0.1:4174/design.html`. These module-based entries need the preview
server; opening the source HTML directly from disk is not supported.

[`docs/DESIGN.md`](docs/DESIGN.md) is the agent-native design contract. The app's internal callable surface
(every IPC channel, live event, hook, store, parser, and constant) is catalogued
in [`docs/INTERNAL-API.md`](docs/INTERNAL-API.md) — check it before building.
Current directory contracts live in the `AGENTS.md` files. Historical plans
under `docs/superpowers/` are records, not setup or workflow prerequisites.
Read the root contract and each nearer contract before editing.

VRX's stance on unofficial API use, rate-limit etiquette, and risk is in
[`docs/api-policy.md`](docs/api-policy.md).

## License

MIT — see [LICENSE](LICENSE).
