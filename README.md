# VRX

> Social VR Companion for VRChat and ChilloutVR.

VRX is a desktop app that brings your VRChat and ChilloutVR friends into one
window, so you don't need VRCX and CVRX open side by side. It runs on your own
computer, signs in as you, and gives both platforms the same space, layout and
weight. Live presence comes from each platform's own live connection, not from
polling.

VRX never writes VRCX or CVRX data. It reads their saved sign-in only when you
press a "Use my sign-in from" button (see [Sessions and privacy](#sessions-and-privacy)).

## What it does

Pages, top to bottom in the sidebar:

- **Dashboard**: friends online, friends in game and hot instances at a glance,
  then the avatar you're wearing, your latest invites, Popular now worlds and
  Hot Instances. Sections with nothing to show step aside. Move or hide any
  section in Settings → Dashboard.
- **Hot Instances**: every instance where at least two of your friends are
  together (you can change the number), most friends first.
- **Friends**: one list for both platforms, grouped into Favorites, In-Game,
  Online and Offline, with search and an **Order** control (Name, Recent, World
  or Joinable). Favorites lists the starred friends who are in a game right
  now. Friend details show where someone is, their notes, and a Join button
  when you can join them. If VRChat or ChilloutVR is already open, Join takes
  you there in that game instead of starting it again.
- **Activity**: friends coming online, joining worlds and going offline on
  both platforms, newest first. It comes from the live connection VRX already
  has, so it adds no requests, and it is kept only while VRX is open.
- **Inbox**: invites, invite requests and friend requests from both platforms
  that arrive while VRX is open. Accept or decline friend requests right there;
  invites you answer in the game.
- **Explore**: Popular now, New, Recently updated and Favorites worlds from
  both platforms, with room details. Open a world to star it or to press
  **Set as home world**.
- **Search**: find people and worlds on both platforms by name. A person opens
  their full profile (bio, pronouns, rank, badges, worlds and groups). Someone
  who isn't your friend yet has an **Add friend** button; every profile ends
  with a quiet **Unfriend or block** button.
- **Groups**: the groups you belong to on both platforms, as banner cards with
  their details. View only.
- **Avatars**: the avatars you uploaded on both platforms, the one you're
  wearing now, their details, and a **Wear** button to switch.

Across the app:

- **Favorites**: the star in a friend's details or a world's sheet. It keeps a
  VRX favorite and, if you want, also adds the friend or world to one of your
  VRChat favorite groups or ChilloutVR categories. Turn the account part off
  in Settings → Behavior.
- **Notes**: a friend's note is saved to your VRChat or ChilloutVR account as
  well as in VRX, so it matches the game. Turn that off in Settings → Behavior.
- **Linked profiles**: link a friend's VRChat and ChilloutVR accounts into one
  person by hand. VRX never guesses links from names.
- **Your profile**: edit your bio and pronouns on both platforms, and your
  VRChat status and status text, from Settings → Accounts → Edit profile.
- **Platform filter**: VRC, ALL or CVR at the top of the window, with each
  platform's live player count.
- **Notifications**: optional desktop alerts when a friend comes online, joins
  a world or goes offline, when a hot instance forms, or when you get an invite
  or friend request. All are off until you turn them on in Settings →
  Notifications, where you can limit friend alerts to friends you pick.
  **Alerts in VR** shows the same alerts inside your headset through
  XSOverlay.
- **Your look**: Theme (System, Light or Dark), Background glow, your own
  background picture, and which platform's words the instance labels use.
  Settings → Appearance → Sidebar pages hides pages you don't use.
- **Welcome setup**: a new install starts with a short setup you can skip at
  any step. Run it again from Settings → About.
- **Report a bug**: Settings → About opens a GitHub bug report with your VRX
  version and system filled in. Nothing from your accounts is added.
- **Tray and updates**: closing the window keeps VRX in the system tray. The
  Windows installer and the Linux AppImage and deb update from inside VRX; the
  portable Windows build doesn't.

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

VRX tries to be a polite client: it aims to ask each platform for no more than VRCX
and CVRX do, spaces out its requests, and never retries a change you made.
[API policy](docs/api-policy.md) has the details.

## Install

Download the
[latest release](https://github.com/Imperix1155/VRX/releases/latest) from
GitHub. Test builds are marked **Pre-release** on the
[Releases](https://github.com/Imperix1155/VRX/releases) page.

- **Windows**: the installer (`vrx-VERSION-setup.exe`) updates itself; the
  portable `VRX-VERSION.exe` you update by hand.
- **Linux**: AppImage and deb packages, both with in-app updates. They are
  tested less than Windows.
- **macOS**: no published builds. A Mac can run a local development build.

VRX isn't code-signed yet, so Windows may show a "Windows protected your PC"
screen the first time. [Install and support](docs/INSTALL.md) explains that
screen, Linux setup, update channels, the tray, uninstalling, and how to report
a problem.

## Sessions and privacy

- VRX signs in to each platform on your behalf and never saves your password.
- Saved sessions are encrypted with your operating system's secure storage
  when it is available. Otherwise VRX uses a weaker local key kept in its
  private app files.
- Signing in with your password is the main way in. Under each sign-in form,
  "Use my sign-in from VRCX" (VRChat) and "Use my sign-in from ChilloutVR" (the
  game's saved sign-in or CVRX) can reuse a sign-in already saved on this PC.
  VRX looks only when you press the button, never at startup, and never changes
  those files. The platform checks the sign-in before VRX saves it.
- VRX changes your accounts only when you press something: a note, a favorite,
  a friend request answer, Add friend, Unfriend or block, your profile, your
  home world or the avatar you wear.
- To show VRChat friends' pictures and worlds right away, VRX keeps a copy of
  the pictures it loaded from VRChat (for up to 14 days) and of world and group
  names (for up to a day) in its private app files. Signing out of VRChat in
  VRX deletes them.
- Friends set to Ask Me or Do Not Disturb keep their location hidden
  everywhere in VRX, notifications included.
- VRX has no telemetry or analytics. It talks to VRChat, ChilloutVR and GitHub
  (for updates) only. With Alerts in VR on, it also hands each alert to
  XSOverlay on your own computer; that never leaves the PC.

## For developers

Electron 44 · React 19 · Vite 8 · TypeScript 7 strict · Tailwind CSS 4 ·
Zustand · TanStack Query · i18next

Use Node.js **22.22.2 or a later 22.x patch** (`.nvmrc` selects it), then:

```bash
npm ci
npm run dev
```

Before a pull request, run the gate:

```bash
npm run lint && npm run format:check && npm test && npm run build
```

Branch from `dev` and open pull requests into `dev`; `main` holds released
code. Packaging, the design guide and every other command are in
[Development](docs/DEVELOPMENT.md).

### Documentation map

| Read this                                                                  | For                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`AGENTS.md`](AGENTS.md) and each nearer `AGENTS.md`                       | The rules every change follows. Read them before editing.          |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                                       | How to propose a change.                                           |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)                               | Setup, commands, tests, packaging, the design guide.               |
| [`docs/REVIEW.md`](docs/REVIEW.md)                                         | What a pull request needs before it is merged.                     |
| [`docs/RELEASING.md`](docs/RELEASING.md)                                   | Versions, dev and stable builds, publishing.                       |
| [`docs/DESIGN.md`](docs/DESIGN.md)                                         | The full design language: rules, tokens, materials, recipes.       |
| [`docs/design.html`](docs/design.html)                                     | The visual guide: real components, real CSS (`npm run guide:dev`). |
| [`docs/INTERNAL-API.md`](docs/INTERNAL-API.md)                             | Every IPC channel, event, hook, store, parser and constant.        |
| [`docs/api-policy.md`](docs/api-policy.md)                                 | How VRX uses the unofficial APIs: pacing, limits, writes, risk.    |
| [`docs/api-volatility.md`](docs/api-volatility.md)                         | What is known and uncertain about each platform's API.             |
| [`docs/architecture/multi-account.md`](docs/architecture/multi-account.md) | How per-account data is stored.                                    |
| [`docs/APP-ICON.md`](docs/APP-ICON.md)                                     | The app icon's sources and exports.                                |
| [`docs/INSTALL.md`](docs/INSTALL.md)                                       | Install, update and support, for people using VRX.                 |
| [`SECURITY.md`](SECURITY.md)                                               | How to report a security problem.                                  |

## License

MIT. See [LICENSE](LICENSE).
