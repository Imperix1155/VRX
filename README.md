# VRX

> Social VR companion for VRChat + ChilloutVR — like VRCX and CVRX, unified.

VRX is a local desktop Electron app that brings your VRChat and ChilloutVR social lives into one place. Friends list, presence, hot instances, notifications, and more — without polling, without bots, without touching VRCX or CVRX data.

**Status:** Early development (M1 Foundation complete). Not yet usable.

## Stack

Electron 39 · React 19 · Vite 7 · TypeScript 5.9 strict · electron-vite

## Dev Setup

```bash
npm install
npm run dev        # dev mode with HMR
npm run typecheck  # type-check all three processes
npm run lint       # ESLint
npm run build      # production build
```

## Build

```bash
npm run build:win    # Windows (NSIS installer)
npm run build:mac    # macOS (DMG)
npm run build:linux  # Linux (AppImage + deb)
```

## Docs

The design system lives in [`docs/`](docs/) — `DESIGN.md` (spec) plus the rendered
`design.html` and `glass.html` references. Architecture decisions and agent
guidelines live in `CLAUDE.md` and the `AGENTS.md` files.
For AI agents: read `CLAUDE.md` first.

VRX's stance on unofficial API use, rate-limit etiquette, and risk is in
[`docs/api-policy.md`](docs/api-policy.md).

## License

MIT — see [LICENSE](LICENSE).
