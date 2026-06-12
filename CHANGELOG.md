# Changelog

All notable changes to VRX are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet — changes land here and move to a version section when released._

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
- Open-source governance: MIT license, contributing/security/code-of-conduct, issue + PR templates.
