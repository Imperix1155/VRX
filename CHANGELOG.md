# Changelog

All notable changes to VRX are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
