# VRX

> Social VR Companion for VRChat and ChilloutVR.

VRX is a desktop app that brings your VRChat and ChilloutVR friends into one
window, so you don't need VRCX and CVRX open side by side. It runs on your own
computer, signs in as you, and shows both platforms with equal weight. Live
presence comes from each platform's own live connection, not from polling.
VRX never writes VRCX or CVRX data. It reads their saved sign-in only when
you press a "Use my sign-in from" button, described below.

## What it does

- **Dashboard**: friends online, friends in game, and hot instances at a
  glance, then the avatar you're wearing, your latest invites, Popular now
  worlds, and Hot Instances. Sections with nothing to show step aside. Move
  or hide any section in Settings → Dashboard.
- **Hot Instances**: every instance where at least two of your friends are
  together (you can change the number), most friends first.
- **Friends**: one list for both platforms, grouped into In-Game, Online, and
  Offline, with search. Friend details show where someone is, their notes, and
  a Join button when you can join them. If VRChat or ChilloutVR is already
  open, Join takes you there in that game instead of starting it again.
- **Activity**: a running list of friends coming online, joining worlds, and
  going offline on both platforms, newest first. It comes from the live
  connection VRX already has, so it adds no requests, and it is kept only
  while VRX is open. Friends set to Ask Me or Do Not Disturb never show a
  world. Filter it by kind, clear it, or turn it off in Settings →
  Appearance.
- **Inbox**: invites, invite requests, and friend requests from both
  platforms that arrive while VRX is open. VRX only shows them; you answer in
  the game. Hide the page in Settings → Appearance if you don't want it.
- **Explore**: popular, new, and recently updated public worlds from both
  platforms, with room details. Open a world and press **Set as home world**
  to make it the world your game starts in.
- **Search**: find people and worlds on both platforms by name. A person opens
  their full profile (bio, pronouns, rank, badges, worlds, and groups), which
  you can also open from a friend's details.
- **Groups**: the groups you belong to on both platforms, with their details.
  View only.
- **Avatars**: the avatars you uploaded on both platforms, the one you are
  wearing now, their details, and a Wear button to switch.
- **Linked profiles**: link a friend's VRChat and ChilloutVR accounts into one
  person by hand. VRX never guesses links from names.
- **Platform filter**: VRC, ALL, or CVR at the top of the window.
- **Notifications**: optional desktop alerts when a friend comes online, joins
  a world, or goes offline, when a hot instance forms, or when you get an
  invite or friend request. All are off until you turn them on in Settings →
  Notifications, where Who alerts you can limit friend alerts to the friends
  you pick. The bell in a friend's details shows whether they can alert you.
  Alerts in VR, also off until you turn it on, shows the same alerts inside
  your headset through XSOverlay, as VRCX and CVRX do.
- **Your look**: Theme (System, Light, or Dark), Background glow (or none),
  your own background picture, and which platform's words the instance labels
  use. Hot Instances and Explore can be
  hidden from the sidebar in Settings → Behavior.
- **Welcome setup**: a new install starts with a short, skippable setup for
  sign-in, pages, the Dashboard, alerts, and the look (including instance
  labels and a background picture). Run it again any time from Settings →
  About.
- **Report a bug**: Settings → About opens a bug report on GitHub with your
  VRX version and system filled in. Nothing from your accounts is added.
- **Tray and updates**: closing the window keeps VRX in the system tray. The
  Windows installer and the Linux AppImage and deb can update from inside VRX;
  the portable Windows build can't.

VRX follows your system language. English and Japanese are included; other
languages show English.

## Unofficial

VRX is an independent app made by fans. It is not made, published, endorsed,
sponsored, supported, or reviewed by the VRChat team or the ChilloutVR team.
This application is not created by or affiliated with VRChat or the VRChat
team in any way. This application is not created by or affiliated with
ChilloutVR or the ChilloutVR team in any way. Please report problems with VRX
on this repository's issues page, not to either platform. Both APIs it uses are
unofficial and can change without notice. The app shows the same text under
Settings → About → Legal.

## Install

Download the
[latest release](https://github.com/Imperix1155/VRX/releases/latest) from
GitHub. Test builds are marked **Pre-release** on the
[Releases](https://github.com/Imperix1155/VRX/releases) page.

- **Windows**: use the installer (`vrx-VERSION-setup.exe`) to get in-app
  updates, or the portable `VRX-VERSION.exe`, which you update by hand.
- **Linux**: AppImage and deb packages, both with in-app updates. They are
  less tested than Windows.
- **macOS**: no published builds. A Mac can run a local development build.

VRX isn't code-signed yet, so Windows may show a "Windows protected your PC"
screen the first time. [Install and support](docs/INSTALL.md) explains that
screen, Linux setup, update channels, the tray, uninstalling, and how to
report a problem.

## Sessions and privacy

- VRX signs in to each platform on your behalf and never saves your password.
- Saved sessions are encrypted with your operating system's secure storage
  when it is available. Otherwise VRX uses a weaker local key kept in its
  private app files: anyone who can read both that key and the encrypted
  session could reuse the session.
- Signing in with your password is the main way in. Under each sign-in form,
  "Use my sign-in from VRCX" (VRChat) and "Use my sign-in from ChilloutVR"
  (the game's saved sign-in or CVRX) can reuse a sign-in already saved on this
  PC. VRX looks only when you press the button, never at startup, and never
  changes those files. The platform checks the sign-in before VRX saves it.
- To show VRChat friends' pictures and worlds right away, VRX keeps a copy of
  the pictures it loaded from VRChat (for up to 14 days) and of world and group
  names (for up to a day) in its private app files. Signing out of VRChat in
  VRX deletes them.
- Friends set to Ask Me or Do Not Disturb keep their location hidden
  everywhere in VRX, notifications included.
- VRX has no telemetry or analytics. It talks to VRChat, ChilloutVR, and
  GitHub (for updates) only. With Alerts in VR on, it also hands each alert
  to XSOverlay on your own computer; that never leaves the PC.

## For developers

### Stack

Electron 44 · React 19 · Vite 8 · TypeScript 7 strict · electron-vite 6

`npm run typecheck` runs the TypeScript 7 compiler (`tsc`). Lint and the
design-token scanner import the TypeScript 6 API from the `typescript`
package, because TypeScript 7 does not ship that API. The side-by-side
packages are `typescript` (`@typescript/typescript6`, binary `tsc6`) and
`@typescript/native` (TypeScript 7, binary `tsc`).

### Setup

Use Node.js **22.22.2 or a later 22.x patch** with npm. `.nvmrc` selects the
supported line; with nvm, run `nvm install` and `nvm use` first.

```bash
npm ci
npm run dev
```

[Development](docs/DEVELOPMENT.md) covers prerequisites and verification,
[Review](docs/REVIEW.md) covers PR readiness, and
[Releasing](docs/RELEASING.md) covers versioning and publishing. None of these
need personal agent skills or a Linear integration.

### Build

Run the [development gate](docs/DEVELOPMENT.md#verification) first, then the
packaging command for your operating system:

```bash
npm run build:win    # Windows (NSIS installer + portable)
npm run build:linux  # Linux (AppImage + deb)
npm run build:mac    # macOS (DMG, local builds only)
```

Electron 44 needs macOS 13 or later and ships only 64-bit x64 and arm64
binaries. See the [upstream platform changes](https://www.electronjs.org/blog/electron-44-0#breaking-changes).

The app icon's SVG masters, platform exports, and regeneration commands are in
[App icon](docs/APP-ICON.md).

### Docs

- [`AGENTS.md`](AGENTS.md) is the contributor contract. Read it and each nearer
  `AGENTS.md` before editing.
- [`docs/DESIGN.md`](docs/DESIGN.md) holds the design rules.
  [`docs/design.html`](docs/design.html) is the visual guide: run
  `npm run guide:dev`, then open `http://127.0.0.1:4173/design.html`. It uses
  the real app components with made-up sample data, in both themes, and never
  signs in, launches a game, or runs the updater. `glass.html` shows the same
  scenes one at a time. `npm run guide:build` and `npm run guide:preview`
  build and serve it at `http://127.0.0.1:4174/design.html`. Opening the HTML
  files straight from disk doesn't work.
- [`docs/INTERNAL-API.md`](docs/INTERNAL-API.md) catalogues every IPC channel,
  live event, hook, store, parser, and constant. Check it before adding one.
- [`docs/api-policy.md`](docs/api-policy.md) covers how VRX uses the unofficial
  APIs: rate limits, etiquette, and risk.
  [`docs/api-volatility.md`](docs/api-volatility.md) records what is known and
  uncertain about each platform's API.

## License

MIT. See [LICENSE](LICENSE).
