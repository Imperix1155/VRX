# Install and support

Download VRX only from its official GitHub page:
[get the latest release](https://github.com/Imperix1155/VRX/releases/latest).
Each release has notes describing what changed. Beta and release-candidate
test builds are on the [Releases](https://github.com/Imperix1155/VRX/releases)
page, marked **Pre-release**.

## Choose a download

| System  | File                          | Updates                            |
| ------- | ----------------------------- | ---------------------------------- |
| Windows | `vrx-VERSION-setup.exe`       | In-app updates                     |
| Windows | `VRX-VERSION.exe` (portable)  | Download each new version yourself |
| Linux   | `vrx-VERSION-x86_64.AppImage` | In-app updates                     |
| Linux   | `vrx_VERSION_amd64.deb`       | In-app updates                     |

VRX needs 64-bit Windows 10 or later, or 64-bit x86 (x64) Linux. There is no
native ARM build. Linux packages are checked automatically when they are built
but are less tested than Windows on real desktops. No macOS builds are
published.

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

## Linux

- **AppImage**: make the file executable before you open it. Run
  `chmod +x vrx-VERSION-x86_64.AppImage`, or open the file's Properties in your
  file manager and allow it to run as a program. AppImages need FUSE 2: if it
  doesn't start, install `libfuse2` (`libfuse2t64` on Ubuntu 24.04 and later),
  or use the deb instead.
- **deb**: install it with `sudo apt install ./vrx_VERSION_amd64.deb`. In-app
  updates ask for your administrator password before they install.

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

## Uninstall and remove data

- **Windows installer**: open Settings → Apps, find VRX, and choose
  Uninstall. For the portable build, delete the file.
- **deb**: run `sudo apt remove vrx`.
- **AppImage**: delete the file.

Updating or uninstalling keeps your settings and saved sign-ins, so they come
back if you install VRX again. To remove saved sign-ins, sign out of each platform in
Settings → Accounts before you uninstall. To remove everything VRX keeps,
delete these folders after uninstalling:

- **Windows**: `%APPDATA%\vrx` (settings, sign-ins, cached pictures and logs)
  and `%LOCALAPPDATA%\vrx-updater` (downloaded updates).
- **Linux**: `~/.config/vrx` (settings, sign-ins and cached pictures),
  `~/.config/VRX` (logs) and `~/.cache/vrx-updater` (downloaded updates).

## Report a problem

Open a [GitHub issue](https://github.com/Imperix1155/VRX/issues) with:

- the VRX version (shown at the bottom of the sidebar),
- your system and which download you used,
- what you did, what you expected, and what happened, including any message
  on screen.

Settings → About → **Open logs folder** shows VRX's log file. VRX removes
passwords and session tokens from its logs and replaces your home folder path
with `~`, but read the log before sharing it and remove friend names or account
details you don't want public. Never share passwords, session tokens, or
credential files.

Report security problems privately, as described in [Security](../SECURITY.md).
