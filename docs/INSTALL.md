# Install and support

VRX is preparing for a Windows-first 1.0. This guide does not announce that 1.0
has shipped. Choose an available version from the official
[GitHub Releases](https://github.com/Imperix1155/VRX/releases) and read its notes.

## Windows

- Use `vrx-VERSION-setup.exe` for an installed app and consent-based updates.
- Use `VRX-VERSION.exe` for portable use. Portable builds do not support the
  in-app updater; download a newer portable executable manually.
- The release workflow currently targets x64. Do not assume native ARM64 support.
- Installer signing and SmartScreen acceptance must be checked on the actual
  release. Do not disable Windows security protections to work around a warning.

### "Windows protected your PC"

VRX releases are not code-signed yet, so Windows SmartScreen may warn the first
time you run a new download. Only continue for a file you downloaded yourself
from the official [GitHub Releases](https://github.com/Imperix1155/VRX/releases)
page:

1. On the blue "Windows protected your PC" screen, select **More info**.
2. Check that the file name matches the release you downloaded
   (for example `vrx-VERSION-setup.exe`).
3. Select **Run anyway**.

If there is no **Run anyway** button, your organization's policy blocks unsigned
apps; ask your administrator instead of changing security settings. Updates
installed from inside VRX do not show this screen again.

Quit VRX before manually replacing it and preserve its existing user data.
Use Settings for available app preferences and update actions. Release notes
are on GitHub and in the packaged changelog; there is no in-app What's New view.

## Update channels

Plain `X.Y.Z` versions use stable updates and exclude prereleases. A deliberately
installed `X.Y.Z-beta.N` build follows the updater's beta/stable channel behavior.
`X.Y.Z-rc.N` follows rc releases, including newer rc version lines; install stable
manually to leave rc. There is no channel-selector UI. Historical plain-version
releases were marked prerelease on GitHub; check each release's label and notes.
Update download/install remains controlled by the existing user settings/actions.

## Other operating systems

Linux AppImage and deb artifacts are experimental. Package checks do not prove
GNOME/KDE launch, credential persistence, or update behavior on every distro.
AppImage updates depend on its runtime environment; deb users should use the
system package installer for manual package upgrades when needed.

Closing the window keeps VRX running in the system tray. Some desktops (for
example GNOME without an AppIndicator extension) show no tray icon, so a closed
VRX seems to vanish. Launch VRX again to bring the same window back; it never
starts a second copy. Quit from the tray menu where a tray is available.

The public workflow does not publish macOS installers. Local development builds
are not notarized under the current configuration and are not a supported public
1.0 distribution. Developer setup is in [Development](DEVELOPMENT.md).

## Report a problem

Use [GitHub Issues](https://github.com/Imperix1155/VRX/issues) for ordinary bugs.
Include VRX version, OS/architecture, installer versus portable format, steps,
and the visible error. Remove account identifiers and private social data from
logs or screenshots; never include passwords, session tokens, or credential
files. Report suspected vulnerabilities privately using [Security](../SECURITY.md).
