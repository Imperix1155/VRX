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

Design system, architecture decisions, and agent guidelines live in `docs/` (coming in VRX-122).
For AI agents: read `CLAUDE.md` first.

## License

MIT — see LICENSE (coming in VRX-122).
