# Changelog

All notable changes to VRX are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Private notes on friends.** The friend drawer's Notes section is live: write up to 500 characters about any friend (with a live counter) and it saves automatically when you click away. Notes are private to you, stored per account, and keyed to the friend's ID — they survive display-name changes and app restarts. (VRX-72)

### Added

- **The background glow is now yours to set.** Settings → Appearance → Background glow: Muted (the old quieter look), Standard (the new default — the corner auroras reach further across the window), or Vivid (bigger, brighter, with extra organic wisps of color). Applies instantly, works in both themes, and your choice is remembered. (VRX-211)

- **Click a friend to open their details drawer.** A glass panel slides in from the right with the friend's avatar, name, and platform; their status spelled out in words ("Join Me — Open to joins, hop in freely", "Ask Me — Ask before joining", …); where they are (world + instance type, "Hidden" when their status hides it); their VRChat trust rank when known; and a Join button when they're actually joinable. Fully keyboard-accessible: Enter/Space on a row opens it, Esc or clicking outside closes it, and focus returns to the row. (VRX-69)

### Changed

- Cleaner status dots: the little icon inside the avatar's corner status badge is gone — the badge is now a simple colored dot. The status in words now lives in the friend drawer, so the meaning is still never carried by color alone. (VRX-69)

### Fixed

- An offline friend can no longer show a live status color: the avatar ring now follows presence first, so a friend who went offline while VRX still remembered their last status ("Ask Me", "Join Me", …) correctly shows the gray offline ring with no badge. A friend browsing the VRChat website shows the teal Active ring the same way. (Pre-existing latent bug caught in the VRX-69 review round.)
- A failed self-invite no longer hides a logged-out session: if VRChat rejects the call because the session died, the app now flips to the reconnect state immediately instead of showing a generic "invite failed" while still claiming to be connected. (VRX-42)
- A VRChat API outage or schema drift now shows a "can't reach platform" state instead of the login screen or endless loading — a live session is no longer mistaken for a dead one just because its status reply couldn't be read. The app stays in the shell, the account card offers Retry and Sign out, and the friends list still tries to load (recovering by itself when the platform comes back). Works identically for ChilloutVR. (VRX-201)
- ChilloutVR friends now show their profile pictures — CVR's roster serves images from `files.chilloutvr.net`, which the avatar fetcher's host allowlist didn't include, so every CVR avatar was silently rejected. (VRX-62)
- VRChat friends with a profile picture set no longer show the default gray robot: the friend list now prefers the user's profile icon/picture over the avatar thumbnail. (VRX-62)

## [0.9.1] - 2026-07-13

### Added

- Added internal multi-account data groundwork: a durable account registry, account-scoped bounded social storage, and epoch guards that reject stale writes across identity changes. (VRX-24)
- Added ciphertext-bound credential-owner groundwork so main can prove offline which account owns the exact currently stored credential and treats overwritten or mismatched slots as unknown. (VRX-24)

### Fixed

- Credential ownership is now recorded only after the matching ciphertext write succeeds; failed VRChat, VRChat 2FA, and ChilloutVR saves leave the slot owner unknown instead of binding a new account to old ciphertext. Successful restores backfill ownership through the same write-gated path. (VRX-24)
- Relogging into a different account now clears the previous account's friends list immediately instead of briefly showing stale friends. (VRX-24)
- Hardened multi-account isolation: authenticated registry adoption is identity-and-epoch atomic, unsafe account ids are rejected consistently, future store formats remain read-only even with incompatible payloads, logged-out callers cannot enumerate account history, stale same-account writes are fenced, and unchanged auth polls no longer rewrite the registry. (VRX-24)

## [0.9.0] - 2026-07-12

### Added

- Internal identity groundwork now tracks each platform's authenticated account id in main for future favorites and multi-account work, with no UI or persistence changes yet. (VRX-24)
- **You can now join a friend directly from the Friends list.** A joinable friend's instance-type pill is a keyboard-accessible button that launches the correct game; if the join is denied, the pill briefly says it couldn't join and then restores its usual label. Private, offline, and otherwise unavailable locations remain non-interactive. (VRX-166)

### Fixed

- **A ChilloutVR friend who's online now shows the same green as a VRChat friend who's online.** Previously CVR friends got a slightly different (mintier) ring and a gamepad icon — an internal modeling difference leaking into the UI as an inconsistency. Statuses are now an ordered cross-platform "privacy tier" (Join Me < Online < Ask Me < Do Not Disturb), and a platform without statuses maps its plain online onto the Online tier. (VRX-207, VRX-208)
- **Friend profile pictures actually load now.** The avatar fetcher was rejecting exactly what the real services send: VRChat's image links need your login session and answer with a redirect (both now handled, with the session sent only to VRChat's own API host), and ChilloutVR's pictures live on a host that wasn't on the security allowlist (now added). Failures still fall back to the letter placeholder. (VRX-202)

### Changed

- **Notification toasts read better.** Headers are Title Case and name the event ("Friend Joined a World", "Friends Gathering"), with the specifics in the body ("Ross came online", "Ross joined Suburban Lakehouse 06"). (VRX-204)
- **All notifications now start switched off.** Fresh installs get no friend or hot-instance alerts until you enable them in Settings → Notifications — quiet by default, opt in to what you want. If you've already changed any switch, your choice is kept. (VRX-205)
- **The friends list now names each friend's platform.** The thin colored edge on each friend row grew into a small vertical "VRC" / "CVR" tab on the row's left end — readable even in black and white, so you can tell platforms apart without relying on color (colorblind-safe). Owner-designed in a live mock round. (VRX-206)

## [0.8.0] - 2026-07-11

### Added

- **Both accounts now work the same way.** Settings → Accounts shows a card for VRChat and ChilloutVR, including a real Disconnect button; VRChat keeps its 2FA step. You now stay in VRX while either account is connected — the full login screen appears only when neither is connected. (VRX-191)
- **A platform filter now tells you how to connect.** If you select VRChat or ChilloutVR before that account is connected, Friends and Dashboard show a Connect action that takes you straight to Settings → Accounts instead of a generic load error. (VRX-192)
- **VRX can alert you when a world gets hot.** When enough friends gather in the same instance, you can receive a desktop notification and turn it on or off in Settings → Notifications. Clicking it opens Dashboard; notification toasts now also use the VRX app icon. (VRX-85, VRX-82)
- **Desktop notifications when friends come online or join a world.** "FriendName is now online" / "FriendName joined WorldName" — real transitions only (no spam when the app first connects or reconnects), mass-login bursts are rate-limited, and each alert type has its own switch on the new **Settings → Notifications** page (friend-offline alerts exist but start off — they're noisy). Clicking a notification brings VRX to the front. (VRX-84)
- **Real avatars in the friends list.** Friend profile pictures now load (both platforms) — lazily, only as rows scroll into view, cached for the session, with the letter placeholder staying in place while loading or if an image fails. (VRX-48)

### Fixed

- **A flaky network can no longer briefly block a correct login.** Background session checks that failed due to network hiccups could trip a safety breaker that then rejected a real login attempt for up to a minute. Automatic checks no longer count against that breaker. (VRX-189)

## [0.7.0] - 2026-07-10

### Added

- **You can now search your friends list.** A search box above the sections filters as you type (accent-insensitive — "Chloe" finds "Chloé"), highlights the matching part of each name, and clears instantly with the × or by emptying the box. Press `/` anywhere in the list to jump to it. While you're searching, collapsed sections open up so a match can never hide. (VRX-65)

- **The friends list is now grouped into In-Game / Online / Offline sections** with live counts in each header. Every section can be collapsed (Offline starts collapsed so the people you can actually join lead the list), the headers stay pinned while you scroll, and your collapse choices are remembered across restarts. (VRX-67)
- **ChilloutVR worlds now show their real name and group correctly on the Dashboard.** The app looks up each CVR instance's details, so hot-instance cards use the world's actual name (no more instance tags sneaking in) and friends in different instances of the same world finally merge into one card — matching how VRChat behaves. Also fetches the world image and player count for upcoming features. (VRX-59)

### Changed

- **The top bar's platform switch no longer shifts around.** It now sits anchored to the right edge next to the online counter — which reads "N online" (we dropped the word "friends" — it's assumed) and reserves fixed space so a growing number can't nudge anything. Same position on every view. (VRX-188)
- **The Dashboard hot-instance cards read better at every window size.** They now lay out **two to a row** and fill the width (instead of three cards squished together), collapse to a single column on a narrow window, and a lone hot instance stretches to fill the row. The world name is sized so the tails on letters like "y" and "g" are no longer clipped. (VRX-199)

### Fixed

- **The window and taskbar now read "VRX" instead of "Electron."** (VRX-199)
- **Custom instance tags in a world name are tucked away on the card face** (e.g. "Bono's Movie Night (#teehee)" shows as just "Bono's Movie Night"), the same as the plain instance numbers already were — the full name still shows on hover. (VRX-199)

## [0.6.0] - 2026-07-09

### Changed

- **The Dashboard's "hot instance" cards got a cleaner, more consistent redesign.** Each card now leads with the **world name** (bigger, up top), shows the **instance type** as the same pill you already see on the Friends tab (so they match everywhere), lists **who's actually there** by name (the first few, then "+N more") instead of a bare count, and tucks the platform into a quiet label in the corner — the card's color already tells you VRChat vs ChilloutVR. The old "C"/"V" box and the long instance-ID number on the card face are gone (the number moves to a details view later). Reads clearer at a glance. (VRX-198)

### Fixed

- **Neither account shows "Connected" after the session quietly expires.** If your ChilloutVR or VRChat session died while the app was open, Settings → Accounts kept saying you were connected — showing a stale friends list with no way to reconnect. Now the app notices the moment a request is rejected, drops the stale roster, and flips the account back to a sign-in prompt. (VRX-195, VRX-197)
- **The friends list no longer says "no friends" when a platform actually failed to load.** With the filter on ALL, if one platform errored while the other had nobody online, you'd see a misleading empty list instead of an error. It now surfaces the failure so you know to retry. (VRX-196)

## [0.5.0] - 2026-07-08

### Fixed

- **Your ChilloutVR friends now load, show correct presence, and stay accurate.** The first real ChilloutVR session surfaced several places where our code assumed the wrong shape for CVR's (undocumented) API, so the friends list either failed to load or showed everyone offline. All fixed: the list loads (a `null` status field no longer breaks the whole fetch); friends show the right **online / in-game** state and their **world names**; presence updates live as friends move between worlds instead of flipping everyone offline; and instance types (**Public / Friends / Group / Invite**) read correctly. Presence also no longer gets stuck showing a stale "in-game" while the live connection is down. (CVR live-data hardening)

### Added

- **Friends are now sorted online-first.** The list orders in-game friends at the top, then online, then offline — alphabetically within each group — so you're not scrolling past offline friends to find who's around. Applies to both platforms.

- **The platform filter now works — everywhere.** The VRC / ALL / CVR slider in the top bar is now a global filter across every social view: VRC shows only VRChat, CVR shows only ChilloutVR, ALL shows both. It filters the **friends list** (your ChilloutVR friends now appear — ALL lists VRChat first, then ChilloutVR), the **Dashboard** stat cards and hot instances, and the **online count**. Before, the slider was cosmetic and the friends list only ever showed VRChat. The selection is remembered as you move between views; Settings is the only place it doesn't apply (it's app settings, not social data). (VRX-66)

## [0.4.2] - 2026-07-07

### Fixed

- **ChilloutVR login no longer falsely reports "cannot connect."** A safety mechanism that backs off after repeated request failures could get tripped by background activity on startup and then block your login for up to a minute — even with the right password and healthy servers. A deliberate login now clears that backoff first, so it always reaches ChilloutVR. (VRX-190)

## [0.4.1] - 2026-07-07

### Fixed

- **ChilloutVR login now sticks.** Connecting your CVR account stayed connected only until you left the Accounts page — navigating away and back asked you to log in again. VRX was re-checking your session by fully re-logging-in on every screen change, which ChilloutVR rejected. It now trusts your session once you're in and only re-checks when something actually fails. (VRX-190)

## [0.4.0] - 2026-07-06

### Added

- **Connect your ChilloutVR account.** Settings → Accounts now has a ChilloutVR sign-in. Once connected, your CVR friends and their live presence show up alongside VRChat, and the session is remembered across restarts — stored encrypted, and your password is never saved. (VRX-37 / VRX-57 / VRX-58 / VRX-174)

## [0.3.0] - 2026-07-05

### Changed

- Settings is now organized into **category pages** (Appearance, Dashboard) — one page at a time, no scrolling, ready to grow as more settings arrive. The category selector lives in the **top bar**, replacing the platform filter while you're in Settings (it has no meaning there). The theme control is reordered to **Dark | System | Light** with System in the middle. (VRX-186)
- The instance-labels selector is reordered to **VRChat | Per-platform | ChilloutVR** — every selector now follows the same design rule: the neutral/combined option sits in the center, matching the platform filter and the theme control.
- The hot-instance threshold stepper's **− / + buttons are now circles**, seated concentrically in the pill like every other control, and the value keeps a **fixed three-digit-wide cell** — the control never changes shape as the number moves. (VRX-187)

## [0.2.0] - 2026-07-05

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
