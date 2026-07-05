# Changelog

All notable changes to VRX are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- VRX now lives in the **system tray**: closing the window on Windows/Linux minimizes to the tray instead of quitting, double-clicking the tray icon brings VRX back, and the tray menu offers Show/Hide and Quit. macOS keeps its native close behavior. (VRX-112)

- The dashboard's **hot instance threshold is now configurable** (1–10 friends, default 2) — a small −/+ stepper sits right on the Hot Instances header for quick tweaks, with the same setting in Settings → Dashboard. Changes apply instantly and persist across restarts. (VRX-78)

- Settings now **persist across restarts** — the theme and instance-label choices are saved to disk the moment you change them and load back on launch. Older settings files migrate automatically, and a file written by a newer version of VRX is never overwritten by an older one (safe rollbacks). (VRX-184)

- New setting: **Instance labels** (Settings → Appearance) — choose which naming scheme the instance-type pills use: VRChat terms everywhere (the default), ChilloutVR terms everywhere, or each platform's own terms. Applies to the friends list and the dashboard's hot-instance cards. (VRX-183)

- Live presence: VRX now connects to VRChat's real-time event stream (the Pipeline WebSocket) — friends going online/offline, changing worlds, or updating their status appear in the list within seconds, without polling. The connection reconnects automatically with backoff and re-syncs the full list on every (re)connect. (VRX-146)

### Fixed

- When your VRChat two-factor cookie expires (roughly monthly), VRX now asks for just a fresh 2FA code instead of a full username-and-password re-login — the session cookie is still valid, so only the second factor is re-verified. Also fixed a cookie-rebuild bug that could have made the reprompt loop forever. (VRX-173)

### Changed

- Upgraded the app runtime to Electron 43 (Chromium 150, Node 24.17) — no user-visible behavior changes expected; verified against the 43.0 breaking-changes list, the full test suite, and a packaged-app smoke run. (VRX-176)

- Instance-type pills now use one naming scheme across both platforms — the shorter, more widely known VRChat labels ("Friends of Friends" → "Friends+", "Everyone Can Invite" → "Invite+", "Owner Must Invite" → "Invite", "Friends of Members" → "Group+", "Members Only" → "Group"). ChilloutVR's "Offline Instance" keeps its name (it has no VRChat equivalent). A setting to choose the label scheme (VRChat / ChilloutVR / platform-native) is planned. (VRX-182)

### Added

- Instance-type pills in the friends list are now color-coded by openness: green (Public) through orange (Invite) for the friend ladder — the more locked, the warmer — and shades of purple for the group family, so the instance type reads at a glance without reading the label. Private stays neutral but is now clearly readable.

### Fixed

- Friends who are in a private world now always show a "Private" pill, whatever their status — previously only Ask Me / Do Not Disturb friends did, so an "Online" friend in a private instance showed no instance type at all. Friends online on the website/app (not in a world) intentionally show no pill.

- The platform toggle's selection bubble now seats into the track's rounded corners (the track renders at the 20px panel radius; the bubble is 16px to nest concentrically) — in both the top-bar platform filter and the Settings theme control.

## [0.1.1] - 2026-06-27

The first social-features release after the foundation: the friends list got its
real-data redesign.

### Changed

- Redesigned the friends list (design spec §9.1): each friend's avatar now carries a status-colored ring with a status glyph — replacing the separate presence dot and status pill — with the custom status beside the name and the world on the line beneath. The instance type shows as a single pill on the right (reading "Private" when an Ask Me / Do Not Disturb friend's world is hidden), and the platform is carried by the colored left spine.
- Reordered the platform toggle to VRChat | All | ChilloutVR (All in the middle), with text-only `VRC` / `ALL` / `CVR` labels.
- The app now opens on the Dashboard.

### Fixed

- Hot instances now require at least two friends in the same world (a lone friend no longer counts), and the empty state reads "No hot instances currently."
- The platform toggle's selection indicator now aligns exactly to the active segment instead of overhanging the wider labels.

## [0.1.0] - 2026-06-11

First foundation release: the app builds, ships installers, auto-updates, and
logs safely. No end-user social features yet.

### Added

- Electron + React 19 + TypeScript scaffold (electron-vite, three-process architecture).
- Liquid-glass design system and design tokens (Tailwind v4, dark default + light override).
- Structured logging with credential redaction (electron-log).
- Internationalization (i18next + react-i18next): OS-locale detection, English fallback.
- Cross-platform installers (electron-builder): Windows (NSIS + portable), Linux (AppImage + deb).
- Auto-update via electron-updater wired to GitHub Releases.
- Tag-triggered release pipeline (GitHub Actions) that publishes installers and update manifests.
- Supply-chain security in CI: Dependabot, an `npm audit` gate, and CodeQL scanning.
- Automated secret scanning (gitleaks): a CI gate that fails the build if a credential, token, or key is committed, plus a local pre-commit hook wired up by `npm install`. Config and the test-fixture allowlist live in `.gitleaks.toml`.
- Open-source governance: MIT license, contributing/security/code-of-conduct, issue + PR templates.
