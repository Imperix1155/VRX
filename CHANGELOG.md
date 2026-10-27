# Changelog

All notable changes to VRX are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The Avatars page opens faster. Avatars you already loaded stay ready for
  the rest of the session instead of loading again after a few minutes away,
  big libraries show the first screenful at once and fill in the rest without
  freezing the window, and opening an avatar's details or pressing Refresh no
  longer redraws every card. The worn avatar loads alongside your uploads, and
  Wear works even while a refresh is still running. Nothing extra is sent to
  VRChat or ChilloutVR.

## [1.2.0-dev.3] - 2026-10-27

Dev test build. It has everything in 1.2.0-dev.2 plus the changes below.

### Added

- New Avatars page in the sidebar. It shows the avatars you uploaded on VRChat
  and ChilloutVR, the one you are wearing now on each, and a details panel for
  each avatar with a Wear button to switch to it. Both platforms share one
  page, sorted by name. Avatars load when you open the page or press Refresh,
  and switching is limited to one every 5 seconds per platform. Favorites are
  not included yet. (#464)
- Alerts for picked friends. Settings → Notifications → Who alerts you can be
  set to Picked friends; then only the friends you choose send the online,
  joins-a-world and offline alerts. Pick a friend with Alert me about this
  friend in their details, for VRChat and ChilloutVR alike, and review or
  remove picks with Show. Picks stay on this PC, per account, and nothing is
  sent to either platform. Everyone stays the default. (#466)
- Activity page: friends coming online, joining a world, and going offline on
  VRChat and ChilloutVR, newest first, in one list with each platform named.
  Show picks All, Online, Worlds, or Offline; Clear empties the list; a row
  opens that friend on the Friends page. It is built from the live connection
  VRX already has, so it makes no extra requests, and it stays in memory only
  until VRX closes or you sign out. Friends set to Ask Me or Do Not Disturb
  never show a world or a move. Turn it off in Settings → Notifications →
  Activity page or in the welcome setup; off also stops VRX keeping it. (#467)
- Join uses the game that's already open. When VRChat or ChilloutVR is running,
  Join takes you there in that game instead of starting a second copy, the way
  VRCX and CVRX do. In VRChat it goes straight there on Windows, or sends you
  an invite to accept in the game (always on Linux, or if you pick Send
  invite). The join dialog says which will happen, and the line under Join
  confirms it. Pick Go there, Send invite, or Off in Settings → Behavior →
  When the game is already open. (#468, #471)
- Inbox page: invites, invite requests and friend requests from VRChat and
  ChilloutVR that arrive while VRX is open, in one list that follows the
  platform filter. It only shows them; answer in the game or on the
  platform's site. Hide takes a row out of VRX and sends nothing. The sidebar
  shows how many are new. Turn the page off in Settings → Notifications. (#469)
- Two optional alerts in Settings → Notifications and the welcome setup:
  Invite received and Friend request received. Both are off until you turn
  them on. (#469)

### Changed

- Settings → Notifications puts every alert in one card, with Who alerts you
  on top and the Activity and Inbox page switches in a second card, so the
  page fits the window without scrolling. With Picked friends, the pick counts
  and Show sit under Who alerts you. The welcome setup's alerts step groups
  its alerts the same way. (#469)
- Background picture explains pictures that cannot fill the window: too small
  (under 640 × 360), too tall (like a phone screenshot) or too wide (like a
  long panorama) are refused with the reason. A usable picture that will be
  cropped a lot or may look blurry gets one short note in Settings. (#465)

## [1.2.0-dev.2] - 2026-10-27

Dev test build. It has everything in 1.2.0-dev.1 plus the fix below.

### Fixed

- Checking for updates no longer offers a release older than the one that is
  running. On Beta and Dev, VRX stays on the current build when nothing newer
  is published, including right after a channel change. (#461)

## [1.2.0-dev.1] - 2026-10-26

Dev test build. It has everything in 1.1.1 plus the changes below.

### Added

- Settings → Appearance → Background picture puts a picture of your choice
  behind VRX. Choose any PNG or JPEG; VRX keeps its own resized copy and never
  changes your file. Picture fade (Low, Medium, High) keeps text easy to read,
  and Remove goes back to the normal background. (#458)
- Background glow has an Off choice for a plain background, in Settings →
  Appearance and in the welcome setup. (#458)

### Changed

- Lint runs on ESLint 10. React component rules come from `@eslint-react`,
  because `eslint-plugin-react` does not load on ESLint 10.
- Typecheck uses the TypeScript 7 compiler. Lint and the design-token scanner
  still import the TypeScript 6 API, because TypeScript 7 does not ship that API.
- The desktop app is built with Vite 8. Vite 8 does not ship esbuild, so the
  esbuild override is gone.

## [1.1.0] - 2026-10-26

### Added

- Settings → About → Automatic updates can follow Stable, Beta, or Dev. Stable
  stays the default and does not install pre-release builds. Beta and Dev also
  follow a newer stable release. Switching the channel cancels a download that
  is still in progress. (#442)

### Security

- Packaging and native-build tools use the patched `undici` releases for a
  high-severity denial-of-service advisory. `@electron/get` is pinned to
  `undici` 7.30.1 and `node-gyp` to `undici` 6.29.1. (#442)
- `http-cache-semantics` is updated to 4.3.0, which is outside the high-severity
  advisory through 4.2.0. The temporary audit exception for that advisory is
  removed. (#453)

### Changed

- GitHub CodeQL actions are updated from 4.39.0 to 4.39.1. (#444)

## [1.0.0] - 2026-10-23

VRX 1.0 is the first full release: one window for your VRChat and ChilloutVR
friends, so you don't need VRCX and CVRX open side by side. It is 1.0.0-beta.5
plus a shorter notice, a new Legal section, and one onboarding line (below).
Coming from 0.23.0, the [changelog](https://github.com/Imperix1155/VRX/blob/main/CHANGELOG.md)
lists every change from the betas in detail.

**Highlights**

- **Both platforms, side by side.** Friends, presence, and instances from
  VRChat and ChilloutVR, with equal weight and live updates from each
  platform's own live connection.
- **Dashboard and Hot Instances.** Friends online and in game at a glance,
  instances where your friends gather, and Popular now worlds. You choose the
  section order.
- **Friends and linked profiles.** One list with search and friend details
  (where they are, notes, and Join). You can link a friend's two accounts into
  one person by hand.
- **Explore.** Popular public worlds from both platforms, with room details.
- **A short welcome setup.** Sign in, pick your pages and look, and turn on the
  alerts you want. Every step can be skipped, and you can run it again from
  Settings → About.
- **Sign in your way.** Sign in with your password, or reuse a sign-in already
  saved on this PC by VRCX or ChilloutVR. Saved sessions use your system's
  secure storage when it is available.
- **Gentle on the platforms.** VRX checks in no more often than VRCX and CVRX
  do: a full friend re-sync once an hour, with live updates in between.
- **Polish everywhere.** Readable text in light and dark themes, screen reader
  support, English and Japanese, a tray icon, and in-app updates.

**Known limits**

- VRX isn't code-signed yet. Windows may show "Windows protected your PC" the
  first time; choose More info → Run anyway. The install guide explains it.
- Windows 10 or newer (64-bit) and x64 Linux only. There are no macOS builds.
- Linux builds are less tested than Windows. The AppImage needs `libfuse2`
  (`libfuse2t64` on newer Ubuntu), and some desktops (such as GNOME) need an
  extension to show the tray icon.
- The portable Windows build doesn't update itself. Use the installer for
  in-app updates.
- VRX is unofficial. Both platforms' APIs are unofficial and can change
  without notice, which can break a feature until VRX is updated.

### Added

- Settings → About → Legal, closed until you open it: who makes VRX (and who
  doesn't), where to report a problem, each platform's terms, privacy, and the
  license.

### Changed

- The unofficial-app notice is now one line: VRX is not affiliated with the
  VRChat team nor the ChilloutVR team.
- The welcome setup mentions that you can link a friend's VRChat and ChilloutVR
  accounts.

## [1.0.0-beta.5] - 2026-10-23

### Changed

- The welcome setup says less. The welcome screen is one line plus a one-line
  unofficial-app notice, the sign-in note is one line, and the longer details
  (the full notice and how sign-ins are stored) sit behind Show more. The
  Dashboard and Alerts steps have shorter intros too.
- Explore filtered to a platform you aren't signed in to shows the same
  Connect card with Go to Accounts as the Dashboard. With All selected, a
  platform you aren't signed in to no longer adds a line to Explore or Popular
  now.
- Room lists show region names (US East, Europe, Japan…) instead of codes, and
  people counts use your language's number format.
- A linked friend in two joinable places now shows each place's access, such as
  Public, in words next to its platform tag, not only as color on the
  "2 locations" button.
- "Sign out" is the name for signing out everywhere in Accounts; the connected
  card no longer says "Disconnect".
- Clearer wording: an empty friends list says "No friends yet", the Hot
  Instances help says the Dashboard shows the top instance from each platform
  when both have one (otherwise the top two), and Japanese uses one spelling of
  the app's subtitle.
- Small text such as the unofficial-app notice, setup labels and step count,
  the notes counter, the app version and loading lines is easier to read.
  Instance labels and Join have more contrast in light mode, error messages
  are brighter in dark mode, and the VRChat and ChilloutVR words on the
  sign-in tabs and friend rows read equally well.
- Long friend names wrap to a second line in friend details instead of being
  cut off, and hovering the name shows it in full.
- Japanese text no longer breaks in the middle of a word.
- The "settings could not be saved" notice is a slim one-line strip with a
  warning sign, so it takes far less room.
- The install guide covers Linux setup, uninstalling, and where VRX keeps its
  data.

### Fixed

- On Windows, one click on the VRX tray icon now opens the window. When the
  window is minimized, the tray menu offers Show VRX instead of Hide VRX.
- If VRX can't start, or hits a serious error and has to close, it now shows a
  short message instead of disappearing without a word.
- If part of VRX is ended from outside (for example in Task Manager), VRX now
  offers to reload the window instead of leaving it blank.
- If VRX's saved sign-in file gets damaged, VRX clears it so you can sign in
  again, instead of every sign-in failing.
- A brief file lock at startup can no longer reset your settings.
- VRX reconnects right away after your PC wakes from sleep, so friends' status
  doesn't freeze while VRX still says it's live.
- A few VRChat worlds or groups that can't be loaded no longer make VRChat look
  disconnected for a minute.
- When your VRChat sign-in expires, VRX now notices as soon as the live
  connection tries to reconnect and asks you to sign in again, instead of
  retrying quietly until the next full re-sync.
- A VRChat friend whose profile is missing its trust information no longer
  disappears from your friends list.
- A VRChat sign-in that needs a new code is no longer invisible while
  ChilloutVR stays signed in: a short notice says so with a Go to Accounts
  button, and the connection tooltip says "Needs code" instead of "Signed out".
- Explore room details no longer say they are refreshing when nothing is. Older
  results say "Showing saved results." next to Refresh, and rooms you could
  join ask you to refresh first instead of saying "Unavailable".
- A friend who moved or went offline before you joined now gets "No longer
  joinable" instead of being told to check the game and connection.
- Identities says why Link an account is unavailable instead of hiding the
  reason in a tooltip.
- Screen readers no longer announce every change to the online count or the
  note counter, and more buttons say what they do: world cards and room Join
  buttons describe their people count and room, join review notices are read
  aloud, focus returns to the code field after a wrong sign-in code, and the
  VRX logo and Hot Instance friend chips are named once.
- The VRX window is now 900×670 inside its title bar and borders, so Settings
  and sign-in fit without scrolling at the default size. The window can't be
  shrunk below that either.
- Searching friends with no matches shows only the "No friends match" line,
  without three empty section headers under it.
- The pinned section header in the friends list no longer lets a thin strip
  of the rows scrolling past show above it.

### Security

- Security hardening.

## [1.0.0-beta.4] - 2026-10-22

### Added

- The welcome setup's Look step also asks which instance labels to use
  (VRChat, Per platform or ChilloutVR). Skipping setup keeps VRChat labels.

### Changed

- Settings → Appearance is just the look now (Theme, Background glow,
  Instance labels). The Hot Instances page and Explore page switches moved to
  Settings → Behavior, and Run setup again moved to Settings → About. Saved
  choices don't change.
- The login screen now opens on the platform you last signed in to, instead of
  always opening on VRChat. First run still starts on VRChat.
- Friends background re-sync now defaults to once an hour, the same pace VRCX
  uses for its full friend list, instead of every 5 minutes. Live updates still
  arrive instantly; the re-sync is only a safety net. Settings → Behavior has a
  new 1h choice, and anyone on the old 5-minute default moves to it (you can
  still pick 5m).
- VRX no longer re-checks your VRChat sign-in each time you switch between
  Friends, Hot Instances and Dashboard. Sign-in, sign-out and an expired
  session still update it right away.
- The unofficial-app notice now uses the exact disclaimer ChilloutVR's terms ask
  third-party apps to show, with a matching sentence for VRChat. It names only
  the platforms, not the companies behind them.
- Security hardening, including an updated app runtime.
- VRX uses less memory, CPU and graphics work. Friend pictures are kept as
  small copies sized for the round avatars instead of full-size profile icons,
  a live update for one friend no longer redraws every visible row, and solid
  panels skip a background blur that was never visible. Nothing looks
  different, and VRX makes no extra requests to VRChat or ChilloutVR.
- VRX does less background disk work. It saves its offline copy of your
  friends and worlds at most once a minute (and always when it closes), only
  rewrites its settings file when something in it changed, and pauses the
  game-status check in the top bar while the window is hidden.
- The live dot next to the online count now pulses only while VRX is the
  focused window. When you're in a game it holds still, so VRX stops redrawing
  itself 60 times a second in the background.

### Fixed

- The login screen scrolls when it doesn't fit the window, so the bottom of
  the card (the notices, an error message) is no longer cut off in a short
  window or in Japanese.
- The welcome setup no longer says Explore shows "new" worlds; it shows the
  worlds that are popular right now.
- The welcome setup's summary lists pages with Japanese punctuation in Japanese,
  and its "Instance labels" row no longer breaks the label onto two lines.
- Friend names listed on Hot Instances cards and in the join dialog use
  Japanese punctuation in Japanese.
- The join dialog's "Don't ask again" option and the Hot Instances help now
  name the exact Settings section to change them in (Behavior, Notifications).

## [1.0.0-beta.3] - 2026-10-20

### Added

- A welcome setup greets new installs. It walks through signing in to VRChat
  and ChilloutVR side by side, then which pages to show, what the Dashboard
  shows, desktop alerts, and the look, with each choice applied right away.
  Skip setup is on every screen before the summary. Settings → Appearance has
  Run setup again.
- Settings → Appearance can hide the Hot Instances and Explore pages from the
  sidebar. Their Dashboard sections and alerts keep their own switches.
- "Use my sign-in from VRCX" and "Use my sign-in from ChilloutVR" sit under
  each sign-in form (login screen, Settings → Accounts, welcome setup). They
  reuse a sign-in VRCX, CVRX or the game already saved on this PC, so you don't
  have to type your password. VRX only looks when you press the button and
  never changes those files; the platform checks the sign-in before VRX saves
  it. Signing in with your password stays the main way.

### Changed

- VRX opens faster: the window appears about a fifth sooner (about 0.47s
  instead of 0.59s in a test run), and the app's screen code is about half its
  previous size. The update check now starts a few seconds after launch.
- The friend list sorts much faster with many friends (about 2ms instead of
  40-70ms for 1,000 friends), so live status changes and tab switches feel
  smoother. Saved friends are also rewritten to disk less often.
- VRChat's Popular now list loads earlier after opening the app. It now waits
  in line with the friend list and world names instead of behind every
  picture. VRX still sends at most one VRChat request per second.
- The "Link an account" picker opens and searches quickly even with thousands
  of friends, because it only draws the rows near what you can see. Live
  status changes also do less work checking linked-profile names.
- VRChat friend and world pictures, and the names of the worlds and groups
  friends are in, show right away when you open VRX. VRX now remembers what it
  already loaded (pictures for up to 14 days, names for a day) instead of
  asking VRChat for each one again, one per second, on every launch. Signing
  out of VRChat deletes them.
- Replaced the default Electron app icon with a VRX monogram: a blue V, silver
  R, and orange X at equal size in a smoked-glass case, with colored rails and
  softened chamfers. Windows, Linux, macOS, and tray assets now share that
  design, with dedicated small-size lettering.
- Settings has a new About tab holding automatic updates, the installed version
  and the logs folder, so Behavior fits the default window without scrolling.
  The category tabs sit on their own row under the title.
- The window frame, title bar and menus now follow the Theme setting, and the
  window no longer flashes white while resizing or reloading.
- Dashboard cards lay out the same whichever section is on top: picture cards
  two across, compact bars stacked. Explore's compact bars match.
- The VRC and CVR words in the top bar, Accounts and sign-in tabs are equally
  readable in both themes, and status words in friend details are easier to
  read in dark mode. Hints and error messages that must be read use the
  stronger secondary text color.
- The installed app no longer carries the project's developer documents,
  contributor tooling, and old planning notes, which never had a use inside it.

### Removed

- The ChilloutVR popup at startup ("Allow VRX to find and use an existing
  ChilloutVR session?") and the External ChilloutVR session setting in
  Accounts. The new button replaces both, so VRX never reads other apps' files
  unless you ask.

### Fixed

- On beta and rc builds, the sidebar's update button no longer covers the end of
  the version number. The version moves to its own line while the button shows.
- Clicking a hot-instance notification opens the Hot Instances page instead of
  the Dashboard.
- An open Popular now world sheet on the Dashboard no longer closes by itself
  when your friends finish loading.
- Explore says worlds haven't loaded yet (and to use Refresh) instead of showing
  an empty page, and a failed game launch from a world sheet says so plainly.
- ChilloutVR friends who are online in an instance no longer flicker to offline
  (losing their Join button) when a friends-list refresh lands just after their
  live status.
- A damaged settings file is set aside as `settings.corrupt-<time>.json` so VRX
  can save settings again, instead of resetting them on every launch.
- People upgrading from beta.1 or older who had turned Hot Instances off no
  longer start getting hot-instance alerts.
- The friends list says "Loading..." rather than "No friends online" while a
  new friends list is still loading, for example right after switching
  accounts.
- VRChat friends who come online on the website now update right away.
- A saved VRChat sign-in that needs a 2FA code now has a Sign out button in
  Settings → Accounts.
- Friend notes, person notes, and linked profiles save even when Windows or
  Linux reports no internet connection.
- Profile placeholders show a whole emoji or styled first letter instead of a
  broken character.
- Searching friends with a leading or trailing space finds and highlights the
  same people as the trimmed search.
- Windows and Linux builds no longer show Electron's default File/Edit/View menu
  bar. Ctrl+Q still quits VRX, which matters on Linux desktops without a tray
  icon.
- Logs replace your home folder path with `~`, so a shared log doesn't show your
  computer account name.
- In light theme the VRX logo and other text on glass no longer look washed out,
  and the Hot Instance sheet's world name is readable over bright pictures.
- The Explore room sheet's close button no longer sits on top of the picture.
- The join dialog no longer shows a stray "·" before the people count, and
  English uses "1 friend" and "1 hot instance" instead of "1 friends".
- With Hot Instances first and none found, the Popular now heading no longer
  touches the empty-state card.
- Settings → Accounts asks ChilloutVR for an email address, the same as the
  sign-in screen, instead of "Username or email".
- A linked person's two accounts now appear in the same order everywhere (the
  friend details chips, the "2 locations" tooltip, the destination chooser,
  and the link dialogs), instead of the order the link was made in.
- When VRChat's 2FA code expires while VRX is running, VRX asks for a new code
  instead of showing a friends list that won't load.
- If VRX starts offline or while VRChat or ChilloutVR is down, it keeps checking
  once a minute and loads your friends when the platform is reachable again,
  instead of staying broken until you press Retry.
- Switching pages opens the new page at the top instead of partway down.
- Turning on Automatic updates while an update is offered starts the download
  right away instead of hours later.
- A failed Join on a Hot Instance card or sheet shows its message under the
  button instead of covering it.
- A linked person's Join choices say "Joining is disabled in Settings" when
  joining is off, instead of being greyed out with no reason.
- A few closed rooms or removed worlds in Explore no longer stop the friends
  list from refreshing for a minute.
- One private world or group no longer stops world and group names loading for
  other friends, and private ChilloutVR instances are not re-requested on every
  status update.
- ChilloutVR sign-in no longer depends on reply fields VRX doesn't use, so a
  small ChilloutVR change can't block every sign-in.
- Japanese uses the same name for Popular now in Settings and on the Dashboard.
- When a hot instance stops being hot while its Join confirmation is open, focus
  stays in the confirmation instead of jumping behind it.
- On a multi-monitor setup, VRX's minimum window size follows the screen the
  window is on, so it always fits on a smaller second screen.
- The tray's Show brings VRX back even after the window was closed or
  minimized.
- A ChilloutVR friend who went offline before the first friends list loaded no
  longer shows as online.
- A routine ChilloutVR sign-in refresh no longer clears Explore and open panels
  as if you had switched accounts.
- Switching away from Explore or Popular now while it is still loading no longer
  leaves it saying "Worlds haven't loaded yet" with a Refresh button that does
  nothing. An open world sheet also picks up its rooms again when you come
  back, and no longer closes by itself after a few minutes.
- The message shown if VRX fails to start is in Japanese on Japanese systems.
- A ChilloutVR friends list over 5,000 friends no longer stops the saved
  friends list loading on start for both platforms.
- Rejoining the same instance in VRChat no longer repeats its hot-instance
  alert.
- VRChat friends marked as confirmed trolls show as Nuisance, like probable
  trolls already did.
- Signing in and signing out work even while Windows or Linux reports that
  the PC is offline, instead of waiting forever.
- When VRChat needs a fresh two-factor code, the friends list says to connect
  VRChat in Accounts instead of "No friends online".
- The two-factor code box gets keyboard focus when it opens, and Back returns
  focus to the username box.
- Verify can't be pressed while a saved VRChat session waiting for a code is
  signing out.
- Clicking a hot-instance alert for a platform the top-bar filter hides
  switches the filter to All, so the gathering is on the page. On Windows, an
  alert that moved to the notification centre still opens it.
- On a test build, Settings → About's releases link lists test builds instead
  of the latest full release. The install guide says the .deb updates in-app.
- If the settings file was ever damaged, VRX no longer shows the welcome setup
  again as if it were a new install.
- Refresh, Retry, Join and Clear search keep keyboard focus after being
  pressed, and Clear search puts focus back in the search box.
- Searching friends in Japanese matches by letter, so full-width, half-width
  and voiced kana forms find the same names.
- An offline VRChat friend never shows an old custom status.
- An empty friends list no longer flashes "Loading…" every time it refreshes.
- In a linked profile, switching to one account and back keeps keyboard focus
  in the profile panel. An offline friend's profile panel no longer shows an
  old custom status.
- A VRChat two-factor code pasted with spaces (like "123 456") is accepted.
- "Use my sign-in from VRCX" says to quit VRCX first. VRX can't read VRCX's
  saved sign-in while VRCX is running, even from the tray.
- Signing in keeps keyboard focus after a failed attempt, both for the
  password form and the "Use my sign-in" button. World and group names show
  right away after signing in that way.
- Typing a shared note back to its saved text while the previous edit was
  still saving now saves that text too.
- A failed update download can be retried straight away from the sidebar or
  Settings → About, instead of the update button disappearing.
- Check for updates and the Identities controls keep keyboard focus while
  they work.
- Clicking a hot-instance alert opens Hot Instances even when that page is
  hidden from the sidebar.
- A routine ChilloutVR sign-in refresh no longer makes the next friend note
  save fail with Retry.

## [1.0.0-beta.2] - 2026-10-19

### Added

- A new Hot Instances page in the sidebar lists every hot instance, most
  friends first. The Dashboard's Hot Instances section has a See all button
  that opens it.
- Settings → Dashboard has a Section order choice to put Hot Instances above
  Popular now (Popular now stays first by default). The top section uses
  picture cards; the bottom one uses compact bars with the world picture behind
  them, still tinted in the platform's color.
- The sign-in screen and Settings → Accounts now say that VRX is an unofficial
  app, not affiliated with or endorsed by VRChat or Alpha Blend Interactive
  (ChilloutVR).
- The install guide explains the Windows "Windows protected your PC" warning
  for unsigned builds, and what to do on Linux desktops without a tray icon.

### Changed

- The Dashboard shows two cards per section: the top one from each platform
  when both have one, otherwise the top two.
- The hot instance alert now lives in Settings → Notifications and works on its
  own. Turning off Hot Instances in Settings → Dashboard only hides the
  Dashboard section; the page and alerts stay available. The hot instance
  threshold is now its own row in Settings → Dashboard.
- Avatar images kept in memory are now capped at about 48 MB per cache (one in
  the background process, one in the window), so long sessions with many large
  avatars can't grow memory without limit.
- Updated Electron from 44.5.1 to 44.7.0.

### Removed

- VRX no longer keeps a separate credential-owner file next to saved sign-ins.
  It was never read. An existing file is deleted the next time VRX starts.

### Fixed

- "Friend came online" alerts now fire for friends who were offline when VRX
  started. Before, a friend's first sign-in each session was skipped on both
  platforms.
- Coming back to the same VRChat instance after a world reload no longer sends a
  second "joined a world" alert.
- The join dialog no longer shows a friend's new world when they switch to Ask Me
  or Do Not Disturb while the dialog is open.
- A friend who is on the website, in the app, or offline no longer shows an old
  world and access pill in the friends list.
- VRChat friends who are traveling between worlds no longer show up as being in a
  public world called "traveling" or "private".
- A friend you just added on VRChat now shows their real status and world instead
  of always appearing as "on the website".
- A VRChat friend who changed status while the list was loading no longer appears
  twice, and the friend list no longer drops someone because of it.
- A few private ChilloutVR rooms, or a short Wi-Fi drop on VRChat, no longer stop
  the friend list from loading for a minute afterwards.
- Unlinking or editing a linked profile no longer fails with "review expired"
  just because the friend changed their name.
- A failed join from a friend's side panel keeps its message on screen even after
  the friend stops being joinable.
- A refused Explore room join now says why (for example, joining is switched off
  in Settings) instead of always suggesting a refresh.
- The connection indicator in the top bar now changes shape as well as color
  (dot, ring, square), and the "2 locations" button names both access types in
  its tooltip, so neither relies on color alone.
- If ChilloutVR sends an unreadable friend list when VRX connects, VRX now
  reconnects (at most twice) to get a fresh one instead of showing every
  ChilloutVR friend as offline.
- After a reconnect, a ChilloutVR friend whose entry in the presence update is
  garbled stays online instead of dropping to offline.
- An avatar that failed to load (for example during a brief network hiccup)
  now tries again while it stays on screen, instead of keeping the placeholder
  until the list is reopened.
- When one platform's friends fail to load or refresh, the Friends list now says
  so (for example "ChilloutVR friends could not refresh") and offers a Retry for
  just that platform, instead of silently showing a partial or outdated list.
- When one VRChat request comes back as signed out, VRX now checks your sign-in
  before acting like you switched accounts. It no longer asks VRChat for the
  friend list again right away, and if your sign-in turns out to be fine, a note
  you were still typing is kept.
- ChilloutVR no longer signs you out when it refuses one thing you don't have
  access to (such as a private instance). VRX now checks your sign-in first and
  only signs you out if ChilloutVR rejects that too. A few of those refusals in a
  row also no longer pause all ChilloutVR requests for a minute.
- Signing out of ChilloutVR now stays signed out. Before, if you had allowed
  session import, the next launch quietly signed you back in with the game's
  or CVRX's session, which could be a different account.
- If the system keychain is locked when VRX starts, VRX no longer replaces your
  saved ChilloutVR sign-in with an imported one. Your saved sign-in works again
  the next time VRX starts with the keychain unlocked.

### Security

- The app window's content security policy no longer allows inline styles, so
  injected style markup can't take effect.
- When VRChat asks you to re-enter your two-factor code, VRX now stops all
  account activity in the background (friend updates, image requests) until the
  code is verified, instead of only blocking the window.

## [1.0.0-beta.1] - 2026-10-12

### Added

- Settings → Behavior has an Open logs folder button for bug reports. The log no
  longer records its own full file path, which included the OS account name.
- Japanese systems now get Japanese text in the ChilloutVR session-import prompt,
  window recovery dialogs, desktop friend notifications and the tray menu.

### Changed

- Updated the Electron runtime to 44.5.1.

### Fixed

- Only VRX's own window can talk to the app's background process; other local
  files opened in an installed build are refused.
- Updater check, download and install failures now show a message in Settings
  instead of failing silently. The window also declares its language for screen
  readers.
- A settings change still takes effect (for example, notifications) when the
  settings file can't be read, instead of the app keeping the old behavior.
- Reconnect roster freshness: a newer VRChat follow-up roster now supersedes older live deltas, while partial results and events received after that read retain their correct order. This also covers older native IPC pushes delivered after the roster response. Partial rosters preserve earlier freshness for friends and absences they did not refresh, so delayed updates are not lost.

- Stop flashing a "Settings have unsaved changes" banner on every settings change.
  The notice now appears only if a save is still pending after about two seconds
  (failed saves still show immediately with Retry), and only once, app-wide.

- Reduce time spent validating large linked-profile lists.

- Show roster failures when the other platform is signed out, and restrict Friends
  refresh to enabled platforms so recovery does not bypass the sign-in gate.

- Preserve loaded preferences when settings normalization cannot be saved, and retain
  the unsaved snapshot for retry instead of replacing choices with defaults.
- Retry failed account-history writes without publishing uncommitted account entries.
- Keep newer live friend updates when an older VRChat roster response finishes,
  including cancelled/replaced queries, without publishing an intermediate stale roster.
- Treat missing VRChat presence buckets as unavailable data instead of marking
  every friend offline.

- Avoid a duplicate VRChat presence-bucket request immediately after successful
  session validation when fresh, account-bound bucket data is already available.
- Stable installations no longer opt into prerelease updates; beta and rc builds
  retain their existing updater channel behavior.
- Built local previews can use IPC from their exact renderer entry without a
  development server.
- Release tags select stable, beta, or rc metadata and artifact validation;
  generated coverage and test reports are excluded from application packages.
- Require explicit, remembered consent before discovering or importing external
  ChilloutVR sessions. Add a revocable Accounts preference and preserve direct
  sign-in and valid existing VRX sessions.
- Mask Ask Me/DND world names in desktop friend alerts, including cached world
  metadata, while preserving online alerts and default-off notification settings.
- Explain OS-backed session encryption and the weaker per-installation local
  encryption fallback in sign-in copy and the user documentation.
- Preserve newly typed VRX names when an earlier platform-name reset completes.
- Match Greek Sigma consistently in friend search and preserve original Hangul
  spelling when highlighting decomposed matches.
- Offer an explicit local-read retry when linked profiles cannot load or reload.
- Keep actionable join failures readable until another attempt or account boundary;
  friend rows wrap feedback below their controls without covering Join.

- Keep failed settings saves visibly unsaved with explicit retry and retain the latest pending snapshot for another disk flush (VRX-271).
- Commit account notes to memory only after storage succeeds, preventing rejected edits from leaking into later reads or unrelated writes.
- Keep healthy platform sessions usable while the other starts, and expose failed initial auth checks with retry instead of a signed-out form.
- Recover healthy tabs after a panel failure and prevent duplicate renderer recovery dialogs.

## [0.23.0] - 2026-09-24

### Fixed

- Keep the platform filter in the same position across social tabs. Move the
  Dashboard’s compact Settings shortcut below its content. (VRX-285)

### Added

- A quiet circular question-mark button beside the Hot Instances selector
  explains how instances qualify and what the threshold controls. (VRX-285)

## [0.22.0] - 2026-09-23

### Added

- Dashboard settings with independent Popular now and Hot Instances controls and a Dashboard shortcut. Hot Instances off hides its Dashboard content and suppresses its alerts while retaining the saved notification preference and threshold.

### Changed

- Settings uses compact individual cards and labeled On/Off glass controls. Hot Instances and Joining expand their dependent settings with smooth height changes, keyboard-safe collapse, and reduced-motion support. Existing preferences and Explore remain available.

- Remove the unfinished Activity and Groups tabs from navigation. Dashboard,
  Friends, Explore, and Settings remain available; the removed concepts are
  deferred for a future design decision. (VRX-281)

### Fixed

- Sign-in can stay remembered when an OS credential wallet is disabled or
  unavailable. VRX prefers OS protection and otherwise encrypts the session with
  a local installation key automatically. Local protection is weaker: copying
  both the key and session files allows session recovery. Existing OS-protected
  sessions and logout remain supported. (VRX-282)

- Restore VRChat profile pictures from the current friend and live-event image
  fields. Recognized full-size file URLs use thumbnails; older responses keep
  their existing image fallback order. (VRX-283)

## [0.21.0] - 2026-09-17

### Added

- Explore public worlds in VRChat and ChilloutVR from the sidebar or Dashboard.
  The mixed grid shares cached results, keeps the platform filter and 2/4/6
  world choice between launches, and opens room details without covering the
  sidebar. Refreshes have bounded work and keep the last good results when a
  platform is unavailable. Room Join uses the existing confirmation, mode and
  permission settings; stale or unavailable targets cannot launch. Manual room
  refresh renews expired references without dismissing the selected world. (VRX-270)

- Manually link a friend's VRChat and ChilloutVR identities from the friend
  drawer. Combined profiles support a custom name, preferred platform, optional
  merged picture and a shared private note separate from both account notes.
  Replacement and unlink confirmations show the exact affected pairs and shared
  notes before requiring acknowledgement. Links stay local and account-scoped.
  Unsaved shared-note drafts block destructive changes until resolved; automatic
  names retain the latest verified preferred-account name for unavailable states.
  Saved links remain readable if that automatic name refresh cannot be written.
  Replacement disables when its retained account is unavailable, and unnamed
  account drawers keep a localized accessible name.
  (VRX-143)
- Linked roster rows show both visible worlds and offer a destination chooser
  before the existing Join flow. Live presence changes keep an interacted row
  in place for up to five seconds while unsafe destinations disable immediately.
  Drawer world images use single or diagonal platform outlines; rule context
  remains in the Join flow and trust information sits quietly below Notes.
  Destination labels and failed-join feedback follow the selected account.
  Account changes discard stale join feedback, including one-click joins.
  Temporary connection errors preserve linked rows, open profiles and people counts
  while the account session remains valid.
  (VRX-143)

### Changed

- Rebuilt the contributor design guide with real component examples, local
  sample data, and dark/light comparisons. The synchronized agent design
  contract points to production components and tokens. (VRX-273)

- Updated the Electron runtime to 44.3.0. Upstream now requires macOS 13 or later
  and provides only 64-bit x64 and arm64 binaries.

### Fixed

- Explore artwork waits for platform reactivation when returning to the app, preventing a temporary inactive state from permanently hiding images (VRX-278).

- Dashboard Popular now and Explore show one “Worlds loading…” message while
  any selected platform initially loads, keeping available cards visible and
  routine background refresh quiet. (VRX-277)

- Information cards and panels keep their own colors over the aurora in both
  themes. Platform tints, neutral highlights and decorative glass remain. (VRX-276)
- Visible Explore and Dashboard artwork can recover after a temporary image
  admission delay, within the existing request limits. Hidden or replaced
  selections stop recovery; unavailable artwork keeps its placeholder. (VRX-275)

- Dashboard Popular now headings use the same subdued color and normal weight
  as Hot Instances in both themes. (VRX-272)
- Explore and Dashboard world cards fill equal columns, use a shared People
  count, and stay quiet during routine background refreshes. Explore has one
  page heading. (VRX-272)
- Room sheets use readable frosted glass and keep Close visible while scrolling.
  Restored the compiled glass blur used by Friends drawers and other glass
  panels in Electron 44. (VRX-272)

- Brief socket connections no longer reset reconnect backoff. Rejected upgrades
  honor server cooldowns across the affected platform's API traffic. (VRX-218)

- Concurrent friend refreshes and CVR name warming share one request per session.
  Reconnect and roster-event bursts coalesce into one follow-up refresh. (VRX-218)

- Friend refreshes and background metadata stop when the platform rate-limits
  them. Partial refreshes retain omitted cached friends, and repeated refresh
  triggers cannot bypass the cooldown. Queued and active batches stop launching
  further work even when another request's 429 supplies an immediate retry time. (VRX-218)

- Logout, account switching and newer login attempts cancel obsolete queued
  requests. Images retain their original account lease, and stale responses
  cannot repopulate the replacement session's cache. (VRX-218)

- API-backed images and normal API requests now share each platform's pacing
  and cooldown. A rate-limit response holds affected API traffic across both
  paths, and CDN images respect their own host cooldowns. Other platforms stay
  independent. (VRX-218)

- Linked friends retain a neutral Private instance pill when their in-game
  location is unavailable, without enabling Join. Known non-joinable instances
  retain their existing labels. The initial Identities dialog now says Close
  instead of Done. (VRX-143)

## [0.19.2] - 2026-09-04

### Fixed

- Update failures now show fixed, localized retry guidance instead of raw updater exceptions. The renderer receives only check/network, download/write, or staged-install categories, while third-party updater payloads are discarded. On macOS, Restart stays disabled until the current native Squirrel stage is proven ready; stale signals cannot mark a retry ready, and an unconfirmed stage returns to retry after five minutes. (VRX-268)
- Private-note saves no longer fail silently. If a save is rejected, the friend drawer keeps the newest draft visible, explains that it remains only on this device and will be lost if VRX closes, and offers an explicit Retry. Until the note bridge supplies a current save revision, the editor stays read-only instead of accepting text it cannot save; a failed initial load explains the problem and offers its own Retry. (VRX-269)

- VRX no longer reports a successful VRChat or ChilloutVR sign-in until it has
  saved the encrypted session. This fixes Linux sessions that worked until quit
  when the OS credential store was unavailable. If secure storage fails, VRX
  clears the new session and explains how to unlock or configure the OS
  credential store before retrying. A completed VRChat 2FA attempt that cannot
  be saved now clears its one-time code and returns to full sign-in. Concurrent
  session checks and sign-ins can no longer replace, cancel, or misidentify the
  newer account; the latest requested VRChat sign-in owns persistence even if
  an earlier request was already waiting on its response, and a rejected latest
  sign-in cannot leave that earlier account stored or active. A verified VRChat
  2FA result also now requires a validated
  account owner before it can persist; an unavailable owner removes the
  tentative and prior stored session rather than allowing an unowned restart.
  Validated restored VRChat and ChilloutVR sessions likewise stay disconnected
  unless their owner binding can be saved. Credential replacement and removal
  now write a non-secret invalidation marker first, preventing an older account
  from returning after restart even if later cleanup deletion fails. Starting a
  replacement VRChat sign-in that reaches 2FA also revokes the prior stored
  account before showing the code prompt, so quitting mid-switch cannot revive
  that account; a failed revocation ends the attempt safely. Once a fresh
  VRChat session is durably saved, ordinary status refreshes validate it without
  rewriting the same credential, so a later transient secure-store outage does
  not erase an established sign-in.
  Restored VRChat cookies stay quarantined from avatar, authenticated REST, and
  live pipeline consumers until their validated owner backfill is durably
  saved; waiting live subscriptions start only after that succeeds. Restored
  ChilloutVR sessions likewise cannot reach friends, instance details, or the
  live pipeline until ACCESS_KEY validation and durable owner binding succeed.
  Tentative
  VRChat cookies also remain unavailable to status, roster,
  self-invite, background metadata, and avatar calls until owner validation and
  encrypted persistence settle. Old roster pages and queued metadata work also
  stop at an account boundary instead of continuing with the newer durable
  account's cookie, and cached world/group metadata is cleared and write-fenced
  so access-controlled details cannot carry between accounts. Late metadata
  completions also cannot erase a replacement account's in-flight marker or
  overwrite a newer same-world cache result. A 2FA prompt is
  rejected if its direct-login
  response did not issue the replacement cookie needed to verify that account.
  Terminal failures clear submitted passwords and codes and synchronously settle
  local auth state, including a malformed response after VRChat replaces its
  session cookie, so remounting a login tab or account card cannot revive a
  stale code prompt, and the retry explanation remains visible while that state
  settles. If a restored VRChat session starts requiring 2FA while the
  ChilloutVR tab is selected, VRX brings the VRChat code prompt forward only
  after any non-terminal active submit; a terminal ChilloutVR failure keeps its
  error visible and leaves the prompt pending until a later non-terminal retry
  settles. Re-selecting ChilloutVR cannot dismiss that error or release the
  pending prompt. (VRX-34)

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
