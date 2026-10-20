# Install and support

Download VRX only from the official
[GitHub Releases](https://github.com/Imperix1155/VRX/releases) page. Each
release has notes describing what changed. Releases marked **Pre-release** are
beta or release-candidate test builds.

## Choose a download

| System  | File                          | Updates                                                   |
| ------- | ----------------------------- | --------------------------------------------------------- |
| Windows | `vrx-VERSION-setup.exe`       | In-app updates                                            |
| Windows | `VRX-VERSION.exe` (portable)  | Download each new version yourself                        |
| Linux   | `vrx-VERSION-x86_64.AppImage` | In-app updates                                            |
| Linux   | `vrx_VERSION_amd64.deb`       | Install each new package with your system's package tools |

Releases are built for 64-bit x86 (x64) only. There is no native ARM build.
Linux packages are checked automatically when they are built but are less
tested than Windows on real desktops. No macOS builds are published.

## Windows: "Windows protected your PC"

VRX isn't code-signed yet, so Windows SmartScreen may warn you the first time
you run a new download. Only continue for a file you downloaded yourself from
the official [GitHub Releases](https://github.com/Imperix1155/VRX/releases)
page:

1. On the blue "Windows protected your PC" screen, select **More info**.
2. Check that the file name matches the release you downloaded (for example
   `vrx-VERSION-setup.exe`).
3. Select **Run anyway**.

If there is no **Run anyway** button, your organization's policy blocks
unsigned apps. Ask your administrator instead of changing security settings.

## Updates

VRX checks for updates when it starts and every few hours while it runs. When
one is available, an **Update** button appears at the bottom of the sidebar,
and Settings → About shows the same choice. Nothing downloads or installs
until you say so, unless you turn on **Automatic updates**. Automatic updates
download in the background and install when VRX closes.

The portable Windows build can't update itself. Settings → About links to
the releases page instead.

Which updates you get depends on the version you installed:

- A normal version (for example `1.2.0`) gets normal releases only, never test
  builds.
- A beta (for example `1.2.0-beta.1`) gets newer betas and normal releases.
- A release candidate (for example `1.2.0-rc.1`) gets newer release candidates
  only. To leave that track, install a normal release yourself.

There is no setting to switch tracks. Release notes are on GitHub; VRX has no
in-app "What's new" screen.

## Running VRX

- Closing the window on Windows or Linux keeps VRX running in the system tray.
  Use the tray icon to show or hide the window, or **Quit** to close VRX. You
  can also press Ctrl+Q while the window is focused to quit.
- Some Linux desktops (for example GNOME without an AppIndicator extension)
  show no tray icon, so a closed VRX seems to vanish. Start VRX again and the
  same window comes back; VRX never runs twice. Press Ctrl+Q in the window to
  quit.
- Your settings and saved sign-ins stay when you update or reinstall. To remove
  saved sign-ins, sign out of each platform in Settings → Accounts before you
  uninstall.

## Report a problem

Open a [GitHub issue](https://github.com/Imperix1155/VRX/issues) with:

- the VRX version (shown at the bottom of the sidebar),
- your system and which download you used,
- what you did, what you expected, and what happened, including any message
  on screen.

Settings → About → **Open logs folder** shows VRX's log file. VRX removes
passwords and session tokens from its logs, but read the log before sharing
it and remove friend names or account details you don't want public. Never
share passwords, session tokens, or credential files.

Report security problems privately, as described in [Security](../SECURITY.md).
