# VRX

> Social VR companion for VRChat + ChilloutVR — like VRCX and CVRX, unified.

VRX is a local desktop Electron app that brings your VRChat and ChilloutVR social lives into one place. Friends list, presence, hot instances, notifications, and more — using live WebSocket presence, with no bots or writes to VRCX or CVRX data.

**Status:** Early development. VRChat and ChilloutVR support direct login,
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
confirmation and permission settings. The
[integration contract](docs/superpowers/plans/2026-09-09-explore-integration-continuation.md)
and [production work receipt](docs/superpowers/plans/2026-09-13-explore-production-block.md)
separate implemented behavior from synthetic, runtime and live-account evidence.

Navigation contains Dashboard, Friends, Explore, and Settings. Activity and
Groups are deferred concepts and do not appear as unfinished tabs.

## Stack

Electron 44 · React 19 · Vite 7 · TypeScript 6.0 strict · electron-vite

Electron 44 requires macOS 13 or later and provides only 64-bit x64 and arm64
binaries. See the [upstream platform changes](https://www.electronjs.org/blog/electron-44-0#breaking-changes).

## Dev Setup

```bash
npm install
npm run dev        # dev mode with HMR
npm run typecheck  # type-check all three processes
npm run lint       # ESLint
npm run format:check # Prettier formatting gate
npm run build      # production build
```

## Build

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
Architecture decisions and agent guidelines live in the `AGENTS.md` files.
Read the root contract and each nearer contract before editing.

VRX's stance on unofficial API use, rate-limit etiquette, and risk is in
[`docs/api-policy.md`](docs/api-policy.md).

## License

MIT — see [LICENSE](LICENSE).
