# Changelog

All notable changes to VRX are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.19.1] - 2026-08-27

### Fixed

- ChilloutVR Members Only and Offline Instance rule-context pills now show **Private space**. Every recognized platform-valid instance type with successfully read openness now resolves to Public or Private; group membership and join settings do not affect the result. The `opennessUnknown` integrity flag overrides the type mapping, so **Unknown** remains only for degraded, unexpected, impossible, or conflicting data. (VRX-245)
- Windows prerelease packaging now recognizes platform-native ASAR paths when verifying bundled fonts, so a valid font-provenance check no longer stops installer creation. (VRX-32)

## [0.19.0] - 2026-08-25

### Added

- VRX can reuse an existing ChilloutVR session from the game's auto-login profile or CVRX's credential store. It reads those files only when VRX has no usable stored CVR session, rejects malformed, unsafe, or ambiguous credentials and unsafe Electron path roots, encrypts the selected username and access key before use, and validates the key through the existing one-shot CVR re-authentication path before the live socket can use it. Missing sources still fall through to direct sign-in. (VRX-56)
- Linux packages now carry launcher search metadata, a stable desktop identity, and the VRX icon explicitly. AppImage filenames include the architecture, and electron-builder generates their update metadata for electron-updater 2.16 or newer. (VRX-101)
- Settings → Behavior now includes an **Allow joining friends** switch. It defaults to ON; turning it off makes the main process reject every Join action before resolving a friend or constructing a launch URL, while VRChat self-invites and ordinary web links remain available. (VRX-39)
- The friends list now renders only the visible row window, stays responsive with large rosters, and supports Up/Down arrow navigation through one roving friend-details opener. Section headers remain sticky, virtual rows announce their logical list position, only visible section and Join buttons enter the Tab order, focus follows the sticky header when a focused section scrolls away, and the list keeps its scroll position when live friend data refreshes. (VRX-63)

### Changed

- Join confirmations, friend details, and hot-instance details now show moderation context separately from instance access: Rose **Public space**, Ice **Private space**, or neutral **Unknown**. Join confirmation's More-info text explains that public and private spaces use different moderation approaches without behavior examples. Hot-instance details fall back to **Unknown** if member data disagrees, instead of letting friend arrival order choose the moderation context. (VRX-245)
- VRX now bundles Latin and supported-symbol coverage for its Inter UI face and VT323 accent face as local WOFF2 files. Japanese and other unsupported scripts still use the operating system's fallback fonts. The standalone design references now use the bundled files instead of Google Fonts. (VRX-32)

### Hardening

- Renderer-created windows and off-origin frame navigations remain blocked and now log only their scheme and host. Dropping local files or HTML into VRX can no longer replace the app document. (VRX-30)

### Fixed

- Direct sign-in now rejects control characters before a request is made, while retaining valid Unicode input exactly as entered. VRChat and ChilloutVR also reject non-printable platform-issued session values before they can be used in headers or saved. (VRX-38)
- ChilloutVR world and group details no longer blink away when their five-minute background cache refreshes. (VRX-265)

## [0.18.1] - 2026-08-14

### Fixed

- Friends-list, drawer, dashboard-card, hot-instance-sheet, and dialog pills now say "Unknown" instead of asserting "Invite" when ChilloutVR reports a privacy value VRX can't read. (VRX-244)

## [0.18.0] - 2026-08-13

### Added

- ChilloutVR group instances now show the hosting group's name and image in the hot-instance sheet — same card as VRChat. (VRX-263)

### Removed

- The one-time `CVR-GROUP-PROBE` diagnostic log line — its question is answered (ChilloutVR's instance details carry the hosting group), so the probe is retired. (VRX-262/VRX-263)

## [0.17.1] - 2026-08-13

### Changed

- Internal diagnostic: when a ChilloutVR group-type instance is resolved, VRX logs a one-time `CVR-GROUP-PROBE` line containing only the response's field NAMES (never values) — one live capture settles whether CVR's API identifies the hosting group, which decides if the group card can ever work on CVR. (VRX-262)

## [0.17.0] - 2026-08-12

### Added

- Group instances now show their real group name and icon in the hot-instance sheet. VRChat group metadata is resolved in the background through a bounded TTL cache and patched live as friends move between group instances; the parser extracts `groupId` from `~group(grp_x)` and leaves `groupName`/`groupImageUrl` for enrichment. CVR continues to report no group identity explicitly. (VRX-260)

### Fixed

- The hot-instance sheet's platform stripe now stays inside the panel's rounded corners instead of spanning the window. (vrx-259)

### Changed

- The hot-instance sheet no longer covers the sidebar, gives the world banner more room, carries the instance-type and platform pills on the banner, and moves the openness note next to the friends list. (vrx-259)

## [0.16.0] - 2026-08-11

### Added

- Click anywhere on a hot-instance card to open its detail sheet — world banner, every friend in the instance, instance ID, group, a Join button, and a quiet openness line. (VRX-250)
- The friend panel now shows the current world's image, the instance ID, and a quiet openness line for friends in visible instances — hidden locations stay hidden. (VRX-251)

### Changed

- The sidebar update button now sits on the footer's grid — its top and bottom edges align with the VRX wordmark and version lines instead of floating between them (owner ruling from the 0.15.1 update test). (VRX-255)

### Fixed

- The friends list no longer regresses to 'Unknown World' right after launch — world names already on screen survive the first refresh while the resolver warms up. (VRX-258)

- A crash inside one live-event consumer no longer stops the event from reaching the UI — each consumer is isolated and the renderer broadcast always runs. (VRX-248)
- Friends moving to a world VRX has already seen no longer flash "Unknown World" until a manual refresh — live events now carry the cached world name, and unknown worlds are fetched immediately through the normal rate-limited lane. (VRX-254)
- Reconciling the VRChat friends list no longer re-fetches a world that failed within the last 60 seconds; the negative-cache window is now respected during roster refreshes. (VRX-254)

## [0.15.1] - 2026-08-08

### Fixed

- The friends cache's 24-hour limit now measures the age of the roster data itself, not the last time the file was written — a days-old roster can no longer restore as fresh just because an unrelated event re-saved the cache. (VRX-253)

## [0.15.0] - 2026-08-08

### Added

- **Consent-based auto-updates (VRX-113).** VRX now surfaces update state in Settings → Behavior and the sidebar footer instead of downloading silently. A new `Automatic updates` toggle defaults to OFF (settings v7). When toggled ON, VRX will auto-download available updates; a consented download applies when VRX next closes, and **Restart to update** applies it immediately. Nothing downloads or installs without your download consent. The sidebar footer shows a collapsed update button that expands on hover/focus; state (update available, downloading, ready to install) is carried by glyph + label, with neutral control styling.
- **Friends now appear immediately from the last successful cache when VRX launches.** The cache is validated before use and rechecked in the background; a signed-out or 2FA-blocked platform is cleared instead of painting stale presence, and switching one platform's account no longer blanks or deletes the other platform's roster, and a temporary outage or rate-limit during the background recheck leaves the last good roster cached for the next launch. (VRX-155)

### Fixed

- A platform the user never signed into no longer gets a fabricated empty friends roster written to disk just because auth settled while another platform was loading. (VRX-155)
- Logging out now persists the emptied roster synchronously, so quitting right after disconnect no longer restores the previous account's friends on the next launch. (VRX-155)
- Transient update-check failures and post-download install failures no longer replace an existing update-available state with a generic error; the update stays visible with a sanitized error note, and absolute filesystem paths are stripped from the message. (VRX-113)

### Changed

- **The sidebar's active-item indicator now echoes the global platform filter.** When the filter is set to VRChat or ChilloutVR, the left spine turns solid platform blue or orange; "All" keeps the existing blue→orange gradient. Position still means "active page" — color is a reinforcing cue, not the sole signal. (VRX-172)

## [0.14.0] - 2026-08-03

### Hardening

- Added regression guards for external-window URL allowlisting and hardcoded local paths in source. (VRX-33, VRX-99)

### Changed

- **Renderer-to-main IPC is now bounded per action.** Every project-owned request channel has a fixed, process-lifetime sliding-window ceiling (including capacity for three full 200-friend avatar paints), while a runaway renderer loop is contained without log storms. Expected action denials stay structured and background query failures preserve cached data. Budgets do not reset on renderer reload, denials do not carry `retryAfterMs`, and repeated dual-platform retry/reconnect cycles can exhaust the current `get-friends` ceiling; those sizing/recovery changes are deferred. (VRX-28)
- **Join confirmation dialog polish (VRX-245).** The dialog is now heavier frosted glass so the busy background behind it reads as a soft glow instead of garbled text. The platform stripe at the top is clipped cleanly into the panel's corner radius. The openness line is quieter (no tier color, dim text) and uses an open/closed vocabulary axis, while the instance type itself appears as the familiar colored pill under the platform pill. Group instances still get their accurate detail inside the "More info" expander.
- **Socket handshake construction is now directly unit-tested.** The already-bounded VRChat and ChilloutVR opening handshakes were extracted into dedicated socket factories without changing their approximately 15-second network timeout behavior.

### Fixed

- **A partial friend sync no longer removes friends it did not receive.** If VRChat loses a page or either platform skips a malformed record, VRX keeps previously known friends and still applies the valid entries it received. A slower, older complete sync cannot remove friends fenced as stale by a newer partial reconnect sync.
- **Live VRChat profile updates are no longer lost while the first friend list is loading.** A status or display-name change received after loading starts is merged into the REST profile when it arrives, without displacing a newer live location, trusting location fields from the profile event, or making a pre-reconnect location fresh.
- **A temporary VRChat presence-probe failure no longer makes every friend look offline.** VRX keeps the last known roster and presence until a reliable snapshot arrives.
- **Join confirmation now stays live with the friend's current instance (VRX-239 / VRX-241).** If a friend's instance changes while the dialog is open, VRX shows a drift notice and asks you to review the new target instead of launching the old one. The renderer and main process compare the expected instance identity before any launch, so the dialog never describes one instance and launches another.
- **Join confirmation focus no longer jumps when the friend's target changes mid-flight.** A `target-changed` response from main used to reset focus to the Cancel button while the user was reading the drift notice; focus now stays where the user put it. The focus trap also excludes disabled, hidden, and `aria-disabled` controls and anchors on the dialog panel during an in-flight launch so focus can never escape to the background. (VRX-239 / VRX-241)
- **Cache updates arriving during the join-instance IPC can no longer strand the dialog.** When main returns `target-changed`, the renderer immediately re-reads the cache; if it already contains a healthy, different target, the dialog enters Review right away instead of waiting for a further update that may never come. (VRX-239 / VRX-241)
- **Identity boundary, auth-invalidated, and unmount now clear the dialog even mid-launch.** A session/invalidation generation fences in-flight completions so a late `target-changed` response after the boundary cannot reconstruct the previous account's pending dialog state. (VRX-239 / VRX-241)
- **Unhealthy query state now wins over drift.** A failed background query that retained stale friend data used to let both an unavailable notice and a drift notice render, exposing Review in a non-joinable state; state precedence is now exclusive, and acknowledgment also requires a healthy query. (VRX-239 / VRX-241)
- **Non-joinable friends (Ask Me / Do Not Disturb / offline) cannot open the confirmation gate anymore — they show an honest "not joinable" blip at the click site instead.** (VRX-239 / VRX-241)
- **IPC throttling and settings persistence are hardened at their process boundaries.** Sender trust is checked before any rate-limit state changes. electron-log now uses its main-only surface, electron-store's unused renderer bootstrap listener is removed during central IPC wiring, and a literal registration audit pins the remaining 15 invoke channels plus `renderer-hydrated`. The preload converts Electron's wrapped invoke rejection into `Error('rate_limited')`; queries stop retrying that normalized denial, while settings startup recognizes it and makes two fixed 250ms/500ms retries (which may still expire before the process-lifetime budget recovers). Settings snapshots now reach main immediately, where disk writes coalesce for 250ms and flush synchronously on `before-quit`. Join limits explain “Too many attempts — try again shortly” instead of showing the generic failure. (VRX-28)
- **The window can no longer be resized smaller than it works at.** VRX had no minimum window size, so shrinking it could squeeze Settings' tallest page below its content height and force it to scroll — breaking the "control surfaces never scroll" rule. The window now refuses to shrink below its own shipped default (900×670), clamped to the display's work area so small or DPI-scaled screens keep a fully visible, resizable window. (VRX-243)

## [0.13.0] - 2026-08-02

### Added

- **A formatting gate.** `npm run format:check` (Prettier, no auto-fix) now runs in CI alongside lint and type-check, so a formatting regression in source or locale files fails the build instead of slipping through silently. (VRX-236)
- **Join straight from a hot-instance card.** When several friends are in the same instance, the instance pill on that Dashboard card is now a Join button — same confirmation dialog as every other Join in the app. If nobody there is joinable, the card stays read-only. (VRX-237)
- **VRX now asks before it launches a game.** Clicking Join opens a confirmation that names the instance type, says in plain words whether strangers can get in ("Effectively public — people you don't know can get in"), shows which of your friends are already there, and — on ChilloutVR — lets you pick VR or desktop for that launch. VRChat picks its own mode from its launch settings, and the dialog says so rather than offering a switch that does nothing. Group instances describe group access accurately instead of borrowing friends-and-invites wording. Prefer the old one-click behavior? The dialog's "Don't ask again" footnote turns it off, and Settings → Behavior turns it back on (along with a Join in: Always ask / VR / Desktop preference). (VRX-210)

### Changed

- **Settings has a Behavior category now.** The old "Dashboard" settings page is renamed **Behavior**, and it now groups everything about how VRX acts: the hot-instance threshold, "Friend details open from", "Friends background re-sync", and the join preferences (Confirm before joining / Join in) that were temporarily parked there. Appearance keeps Theme, Background glow, and Instance labels. All settings keep their saved values. (VRX-231)

### Fixed

- **Unknown ChilloutVR privacy is no longer mislabeled private.** If CVR sends a privacy value VRX does not recognize, the join confirmation now says "Openness unknown — treat it as public." and its headline stays neutral ("Join this instance?") instead of naming the type the parser safely degraded to. Recognized Invite instances keep their existing effectively-private wording. (VRX-240)
- **Hot instances no longer claim friends are together when they aren't.** The Dashboard used to call a world "hot" when enough friends were anywhere in that world — so two friends in _different_ instances of the same world looked like they were hanging out together when they couldn't even see each other. Now a card (and the "friends gathering" notification) only appears when friends are in the exact same instance, and the wording says exactly that. (VRX-237)
- **Friends who hide their location stay hidden from hot instances too.** If a friend sets Ask Me or Do Not Disturb, they no longer count toward a hot instance and never appear on its card or notification — their location stays as private there as the friends list already kept it. (VRX-237)
- **Launching VRX twice no longer opens a second copy of the app.** Starting VRX while it's already running now brings the existing window to the front instead — including restoring it from the tray or from minimized. Duplicate copies used to stack without limit, each one opening its own connections to VRChat and ChilloutVR behind the scenes. (VRX-230)

## [0.12.0] - 2026-07-29

### Added

- **ChilloutVR players can finally sign in.** The sign-in screen now has two tabs — VRChat and ChilloutVR — sharing one form, so a CVR-only player is no longer locked out of the app entirely. The card retints to match the platform you pick, and switching tabs always gives you a fresh form (your password never carries across, and password managers keep the two accounts separate). (VRX-217)
- **Open a friend's card by clicking anywhere on their row.** The details panel now opens from the whole friend card, not just the profile picture — and clicking a different friend's card switches the panel in place. The Join button always wins over opening. Prefer the old behavior? Settings → Appearance → "Open details with: Profile picture only". (VRX-228)
- **The status dot in the top bar is real now.** Green means every signed-in platform's live connection is up, amber means reconnecting, red means one is down — it used to be decoration that always pulsed green. Join failures caused by a not-yet-ready live connection also say so now, instead of a generic "Join failed". (VRX-223)
- **A proper "Connecting…" screen on launch** instead of a blank window while the app checks your sessions on a slow network. (VRX-223)

### Changed

- **Joining two different friends back-to-back works now** — the 3-second join cooldown is per-friend instead of app-wide, and if you do hit it, the message says so. (VRX-223)
- **Politer to the platforms' servers** (account-safety hardening): rate-limit waits can no longer be skipped by a rare retry timing race; profile-picture fetches to VRChat's API host are paced like every other API call; background refreshes are slightly randomized so many copies of VRX don't sync up. None of this changes what you see — it protects your account. (VRX-218)
- **About 150 lines of dead code removed** and internal simplification of the sign-in forms and the friend-note editor — same behavior, much less machinery. (VRX-221)

## [0.11.1] - 2026-07-28

### Fixed

- **Email-code sign-in works now.** If your VRChat account gets its 2FA codes by email, sign-in always failed at the code step — the app was sending your code to VRChat's recovery-code endpoint instead of the email-code one, so a correct code was always rejected. Authenticator-app codes were never affected. (VRX-229 — thanks to our first external tester for catching it.)

## [0.11.0] - 2026-07-27

### Added

- **The friend card is properly frosted now.** The pop-out friend card used to be so transparent that the list behind it read straight through the panel — text on text. It now has a real frosted-glass backing (both themes): what's behind reads as a soft glow, never as words. (VRX-226)

### Changed

- **Your friends appear instantly when the app opens.** The friend list used to wait for every world name to be looked up — up to 40+ seconds staring at "Loading friends" on a big list. Rows now appear immediately and world names fill in quietly, one per second, as lookups complete. Joining works during that window too. (VRX-214)
- **Signing in and joining no longer wait in line behind background work.** Actions you trigger — sign-in, 2FA, self-invite — now take the very next request slot instead of queueing behind background lookups (which could stall them ~40 seconds with zero feedback). The gentle 1-request-per-second pace the platforms expect is fully unchanged. (VRX-216)

### Fixed

- **The release pipeline can no longer publish an empty release.** The v0.10.0 cut published a release with zero installers while the real files sat on a hidden draft (recovered by hand). The pipeline now has exactly one release creator, publishes by ID, verifies every expected installer by name before going live, and fails loudly instead of shipping anything partial. Publishing is once-per-tag by design now. (VRX-224)

## [0.10.1] - 2026-07-23

### Changed

- **Faster and lighter under the hood** (from the full codebase review): the friends list no longer redoes its filtering and grouping work on every little update — typing in search and live presence changes feel snappier on big friend lists; presence bookkeeping got a faster lookup path; and the app stops making a hidden sign-in status check every time you flip between tabs.
- **The app now tells VRChat and ChilloutVR which version it really is.** It was introducing itself as version 0.1.0 forever; now the version in every request always matches the release, so platform operators can attribute our traffic correctly. A test makes sure it can never drift again.
- **A dead network connection now gives up in seconds, not minutes.** If the live-updates connection hangs while connecting (strict firewalls, captive portals), the app now cuts it off after ~15 seconds and retries on its normal schedule, instead of waiting out a minutes-long system timeout with presence frozen.

### Fixed

- **An expired ChilloutVR sign-in no longer hides behind "instance is private".** If your CVR access key expires, the app used to keep showing the account as connected while quietly failing — now the Accounts card flips to reconnect right away, exactly like VRChat does. (VRX-215)
- **Favouriting a friend will stick.** Groundwork for the upcoming favourites feature: live presence updates used to silently reset per-friend local data (favourites, groups, cross-platform links) every time that friend moved worlds — fixed before the feature ships, so it can never be bitten by it.

- **The friend details card now floats over the list on the right, where it was always meant to be.** In 0.10.0 it wrongly rendered inline at the very bottom of the friends list, yanked your scroll position down to it when opened, and left an empty card ghost at the list's end — a CSS conflict between the glass material and the panel's positioning that only showed up in the real app. The list no longer moves at all when you open or close the card. (VRX-225)

### Changed

- **The friend card opens from the profile picture now, not the whole row** — clicking a friend's avatar opens their card; clicking anywhere else on the row does nothing (the Join pill still joins). No more accidental card-opens from stray clicks. Keyboard users: Tab to the avatar and press Enter/Space, same as before.
- **The list stays alive while the card is open.** The background dimming is much lighter, and you can still scroll, hover, and use the list behind the card — clicking another friend's picture switches the card to them in place. Close it with ✕, Esc, or a click anywhere else. (VRX-225)

## [0.10.0] - 2026-07-22

### Added

- **You can now set how often the friends list does its full re-sync.** Settings → General → Re-sync cadence: every 5 minutes (default), 10, 30, or manual-only. Real-time updates still arrive instantly over the live connection — this only controls the background safety-net that catches anything missed while disconnected. Manual-only also stays quiet after leaving and returning to a social view. (VRX-77)

- **Private notes on friends.** The friend drawer's Notes section is live: write up to 500 characters about any friend (with a live counter) and it saves automatically when you click away. Notes are private to you, stored per account, and keyed to the friend's ID — they survive display-name changes and app restarts. (VRX-72)

- **The background glow is now yours to set.** Settings → Appearance → Background glow: Muted (the old quieter look), Standard (the new default — the corner auroras reach further across the window), or Vivid (bigger, brighter, with extra organic wisps of color). Applies instantly, works in both themes, and your choice is remembered. (VRX-211)

- **Click a friend to open their details drawer.** A glass panel slides in from the right with the friend's avatar, name, and platform; their status spelled out in words ("Join Me — Open to joins, hop in freely", "Ask Me — Ask before joining", …); where they are (world + instance type, "Hidden" when their status hides it); their VRChat trust rank when known; and a Join button when they're actually joinable. Fully keyboard-accessible: Enter/Space on a row opens it, Esc or clicking outside closes it, and focus returns to the row. (VRX-69)

### Changed

- Sign-in failures now show one consistent message ("Sign-in failed. Check your details and connection, then try again.") instead of hinting at what specifically went wrong — deliberately generic so a failed attempt reveals nothing about the account. The 2FA step still knows when to re-prompt. (VRX-36)

- Cleaner status dots: the little icon inside the avatar's corner status badge is gone — the badge is now a simple colored dot. The status in words now lives in the friend drawer, so the meaning is still never carried by color alone. (VRX-69)

### Fixed

- No more wrong-look flash at startup: if you saved the Light theme or a different background glow, the app now applies your choices before showing anything, instead of flashing the dark/default look for a moment while your settings load. (VRX-212)
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
