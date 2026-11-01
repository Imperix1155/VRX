# VRX design contract

The rules for changing what VRX looks like and how it behaves. The renderer
components and [`main.css`](../src/renderer/src/assets/main.css) are the
implementation, and they are the source of truth for current behavior. This
document records the decisions that code must keep. The human visual guide is
[`design.html`](design.html), and [`glass.html`](glass.html) shows its scenes
one at a time. Both render the production components, CSS, fonts, and
translations through [`guide/`](guide/AGENTS.md) with sample data.

If the code and this document disagree, investigate before changing either.
A known defect is never a design rule, and an old example is never an
approved redesign. Read the root and nearer `AGENTS.md` files before editing.

Section numbers stay stable because code comments cite them (for example
"DESIGN.md §5").

## Locked for 1.0

These decisions are settled. Changing one needs the owner's explicit approval.

1. **Equal platforms.** VRChat and ChilloutVR get the same treatment, visual
   weight, wording weight, and features wherever both platforms support them.
   That includes the app icon: the V and X are the same size (§1).
2. **Brand colors.** VRChat is blue (`--vrc`) and ChilloutVR is orange
   (`--cvr`), following each platform's brand. The combined "All" view uses
   the blue-to-orange blend.
3. **Color always means something, and never alone.** Every color cue sits in
   a consistent place with a non-color cue nearby: a word, glyph, shape, or
   label. Examples: platform pills and tabs carry the platform name; instance
   pills are words; the connection indicator pairs color with shape (§8).
4. **The one color-only exception.** In the friends list, the avatar ring and
   its corner dot show presence and status by color alone, to keep rows
   clean. The row's accessible label names the state, and the friend details
   panel shows the written status (§5).
5. **Missing is red, stale is dim.** A source that never loaded uses the
   error color (`--error`). A source showing older data uses `--text-dim`
   (§9.4).
6. **Background never tints information.** The aurora may color decorative
   chrome such as the sidebar, but never a card or panel that carries
   information (§3).
7. **Dashboard layout.** Under the numbers the Dashboard has four sections:
   Wearing now (the worn avatar per signed-in platform), Latest invites (the
   newest invite per platform), Popular now and Hot Instances, in that order
   by default. Settings → Dashboard → Sections moves each one up or down and
   turns it on or off, all on by default; off only hides the Dashboard
   section (§8, §9.1). Wearing now and Latest invites share one glance row
   while they sit next to each other. Of Popular now and Hot Instances, the
   first uses picture cards and the second uses bars with the world picture
   behind them. Each shows two cards: the top one per platform when both
   have one, otherwise the top two. Hide empty sections, on by default,
   lets a section with nothing to show step aside so the others take its
   space, and the first section actually shown gets the picture cards.
8. **Hot Instances page.** The sidebar has a Hot Instances page listing every
   hot instance, most friends first. It shows by default and can be hidden in
   Settings → Behavior (§8). While it shows, the Dashboard section's "See
   all" button opens it (§9.1).
9. **Privacy first.** Friends set to Ask Me or Do Not Disturb never reveal
   their world or instance anywhere, including notifications (§5).
10. **Liquid glass.** Glass is the material, with a blue top-left and orange
    bottom-right aurora, restrained scanlines, and retro type accents. Theme
    defaults to System (§0, §3, §4).
11. **Simple by default, more on demand.** Each screen shows only what most
    people need, in as few words as possible. Longer explanations, fine print
    and power-user options sit behind a Show more or ? control, in Settings, or
    in About, where people who go looking find them. Required notices stay
    reachable, never dropped (§9.4).

## §0 Direction and authority

VRX is a dense desktop companion. Equivalent concepts on the two platforms use
the same presentation and terminology. A feature one platform doesn't have
stays absent for that platform; never fake it.

Dark is the stylesheet baseline. Light mode uses the same components,
hierarchy, interactions, and meaning, with token overrides. The stored Theme
preference defaults to System, which follows the operating system. Don't
confuse the dark baseline with the default preference.

Visible wording, layout, and interaction changes need the owner's approval
unless an approved issue already specifies the outcome. Documentation work
never authorizes redesigning the app.

## §1 Identity

Inside the app, use the horizontal VRX wordmark with the subtitle "Social VR
Companion". The wordmark is VT323 with the platform colors on V and X and the
neutral bridge color on R. Page titles name the active view. When a platform
logo is needed, use the platform's official asset; never draw a substitute.

The launcher icon is the VRX monogram in one row: a blue V, a silver R, and an
orange X at the same size, in a smoked-glass case with colored rails, straight
diagonal cuts, and softly rounded chamfers. The case and letter colors don't
change with the theme or desktop background. `build/icon.svg` is the master;
the 16 px and 24 px SVGs keep dedicated small-size lettering with equal V and
X, an open R, and a clear gap between letters. Regenerate every export with
`npm run icons:generate` and check with `npm run icons:check`.
[App icon](APP-ICON.md) owns the files, sizes, and verification.

Sources: [`Sidebar.tsx`](../src/renderer/src/components/Sidebar.tsx),
[`LoginScreen.tsx`](../src/renderer/src/components/LoginScreen.tsx),
[`viewTitles.ts`](../src/renderer/src/utils/viewTitles.ts).

## §2 Tokens and themes

[`main.css`](../src/renderer/src/assets/main.css) owns every token value, font
face, spacing step, radius, material class, background effect, and light
override. Never copy its values into another table or stylesheet. Use the
existing semantic variables and the Tailwind scale; add a shared token only
for an approved need that existing ones can't meet.

- Text: `--text`, `--text-dim`, `--text-faint`. Don't use faint text for
  anything a person must read: notices, fine print, labels, counters, versions
  and loading lines use `--text-dim`. Faint is left for the wordmark subtitle,
  the Dashboard section headings (§7), placeholders, disabled controls, and
  technical identifiers such as the Hot Instance ID.
- Errors: `--error` for missing data and failures.
- Platforms: `--vrc`, `--cvr`, and their companion and ghost tokens.
- Friend state: `--ingame`, `--active`, `--offline`; VRChat status: `--st-*`;
  each with text companions.
- Instance access: `--op-*`. Policy space: `--policy-*`.
- Colored pills: `--pill-tint` and `--pill-edge` (and their Strong pair) set
  how much of a pill's hue fills and edges it, so each theme can tune them.
- Controls: `--control-fill`, `--control-fill-hover`, borders, and focus.
- Material: `--glass-*`, scrim, shine, shadow, and radius tokens.

Light is not dark inverted. Cards are white on a canvas a step darker, so
they read as raised. Brand colors stay at full strength for fills, rings,
edges and the glow, and words in a brand color use a deeper companion that
clears 4.5:1 on white and on the platform tints. Every small platform label
(the friends-list rail, platform pills, the short badge on a picture) takes
the `--plat-*-badge-*` and `--plat-*-rail-*` tokens: solid platform color with
white words in light, so blue and orange show at a glance down a list, and
quiet outlines in dark, where the word and edge already glow. The dark
friends-list rail is the one firmer outline: it sits on a row already washed
in its own hue, so it takes a stronger tint, edge and word
(`--plat-*-rail-text`), and it keeps a 3px gap from the row's platform bar so
the two never touch. The ChilloutVR
badge fill is one step deeper than the raw orange so its white word clears
4.5:1.

Themed colors stay runtime CSS variables; a build must never bake light and
dark values into a fixed palette.
[`applyTheme`](../src/renderer/src/hooks/useApplyTheme.ts) sets
`data-theme="light"` on the root for light and removes it for dark.

## §3 Material and overlays

Information panels over the canvas use `.glass glass-information`. Add
`.glass-frosted` for a sheet or drawer and `.glass-frosted-heavy` for a true
confirmation modal. The information modifier puts an opaque neutral backing
under the existing gradients; decorative chrome may keep translucent `.glass`.
The sheen lights the pane behind its content, never over text or logos.

Information-bearing cards and panels keep their intended colors no matter
what the background does. That covers statistics, Popular now, Explore, Hot
Instances, and every other informational surface. Blue or orange background
light must never tint them, especially platform-specific ones. Neutral sheen
and highlights may vary, and intentional platform styling stays.

`--glass-information` is the backing in both themes. Tint classes set
`background-image`, never a `background` shorthand that would clear the
backing. The Friends list uses the same backing without a `.glass` frame, and
hand-styled room sheets use the token directly. Pictures, semantic colors,
geometry, and platform gradients stay unchanged.

Keep these classes in `@layer components` so utility positioning still wins
for fixed overlays. Frost modifiers follow `.glass`, and `.glass-information`
follows the frost modifiers so its backing wins without clearing the
gradient. In compiled CSS, `-webkit-backdrop-filter` comes before the standard
`backdrop-filter`. Check the computed result, not just source order.

Use the existing overlay components instead of building a new scrim or focus
pattern. A non-modal sheet never claims `aria-modal` or traps focus. A true
modal keeps keyboard focus inside, even when its actions are disabled.

Sources: [`main.css`](../src/renderer/src/assets/main.css),
[`FriendDrawer.tsx`](../src/renderer/src/components/FriendDrawer.tsx),
[`ExploreWorldSheet.tsx`](../src/renderer/src/components/ExploreWorldSheet.tsx),
[`JoinConfirmDialog.tsx`](../src/renderer/src/components/JoinConfirmDialog.tsx).

## §4 Canvas and glow

The document body draws the aurora and scanlines with pseudo-elements: blue
top-left and orange bottom-right in both themes. Background glow and a glass
pane's tint are separate controls; changing the glow never changes the colors
of informational surfaces.

Use [`applyGlow`](../src/renderer/src/hooks/useApplyGlow.ts) with the Off,
Muted, Standard, and Vivid settings. Standard, the default, has no `data-glow`
attribute; Off keeps the plain base canvas. In light mode Standard is
deliberately stronger than Muted. The exact values live in `main.css`. Reduced
motion keeps the same static composition.

The user may put their own picture behind the app (Settings → Appearance →
Background picture). [`AppBackdrop`](../src/renderer/src/components/AppBackdrop.tsx)
draws it as a fixed, decorative layer under the aurora, and
`data-app-background` on `<html>` drops the aurora's opaque floor so any glow
the user keeps sits over the picture. A fade layer in the theme's base colour
(Low, Medium, High; Medium by default) keeps words over the picture readable.
Light uses a lighter fade so a picture never turns milky white; words set
straight on the canvas there (`.canvas-text`: page titles, the online count,
section headings) sit on a small crisp card-color backing with near-solid
ink, so a dark picture cannot swallow them, and small buttons beside them
(`.canvas-control`) take a white backing too. Words never get a glow or halo:
on a light theme it reads as fuzzy text.
Information-bearing cards and panels keep their own solid backing, so a
picture never changes their colours or meaning; translucent chrome such as the
sidebar shows it blurred.

## §5 Presence, status, and privacy

Presence state and VRChat status are separate inputs. State is
`in-game | active | offline`; VRChat status is
`join-me | online | ask-me | dnd`. VRChat's upstream status string `active`
becomes Online; it is not the presence state `active`, which means online
outside the game. ChilloutVR has no status, custom status, or trust rank;
never fabricate them.

[`ringFor`](../src/renderer/src/utils/statusRing.ts) decides the avatar ring:

- Active and offline friends use their presence color.
- In-game VRChat friends use their status color.
- In-game friends without a status, including every ChilloutVR friend, use
  Online.
- Row avatars have a plain corner dot and an accessible label naming the
  state. Drawer avatars have no dot; the drawer shows the written status.

This is the deliberate color-only exception in "Locked for 1.0". Don't add a
row status pill, and don't read raw presence from ring color alone. Platform
identity stays readable as text (the VRC or CVR tab or platform pill) as well
as tint, and a linked person's rail says VRX.

**Privacy.** Ask Me and Do Not Disturb hide the world and instance. Active and
offline friends never show a stale cached instance. Rows, the drawer, Hot
Instances, notifications, and actions all use the shared hidden-location and
membership checks in [`hotInstanceKey.ts`](../src/shared/hotInstanceKey.ts).
Never put a hidden identifier in gesture metadata.
An invite is the one place a world name can appear for any sender: the sender
chose to share it by inviting, so the Inbox shows the world the invite names,
never a location read from presence (§9.6).

**Joining** is a separate decision, made by
[`isFriendJoinable`](../src/shared/joinability.ts) and the existing Join
flow. There is no Ask-to-join action. "Always ask" in Settings → Behavior →
Join in chooses a ChilloutVR launch mode; it doesn't request an invitation.
When the game is already open, Join uses it instead of starting a second
copy, the same way on both platforms: the join dialog shows one quiet note in
place of the mode picker or launch note ("VRChat is open, so Join takes you
there in the game.", "ChilloutVR is open, …"), and afterwards the status line
under Join says "Sent to your open game" or, for a VRChat invite, "Invite
sent. Accept it in VRChat." for 8 seconds.

**Trust.** Names stay neutral. When VRChat provides a trust rank, it appears
as quiet 12 px plain text below Notes in the drawer; a combined linked
profile can use its VRChat member's rank. There is no row trust pill, trust
toggle, or ChilloutVR equivalent.

## §6 Instance labels and policy

### §6.1 Access labels

`InstanceInfo.type` stays platform-true: eight VRChat types and nine
ChilloutVR types, including the ChilloutVR Offline Instance. Every access pill
goes through [`instancePillFor`](../src/renderer/src/utils/instancePill.ts)
and renders [`InstancePill`](../src/renderer/src/components/InstancePill.tsx).

Settings → Appearance → Instance labels picks the wording: VRChat (the
default on both platforms), Per platform, or ChilloutVR, in that order. The
label maps live in
[`instanceTypeLabels.ts`](../src/renderer/src/utils/instanceTypeLabels.ts);
never copy a map into a component or derive a label from a color.

Pills are words, with the shared height, radius, and tier colors. Group
labels stay in full. Friend-family tiers use the green-to-orange palette and
group-family tiers use purple. `opennessUnknown: true` shows a neutral Unknown
under every scheme. Hidden in-game locations can show a neutral Private. The
Offline Instance is neutral under every scheme. These neutral states share one
look but keep their own words. No pill appears for an active or offline
friend's old location.

### §6.2 Policy space

Policy space is separate from access. Use
[`policySpaceFor`](../src/renderer/src/utils/instancePolicySpace.ts) and
[`PolicySpacePill`](../src/renderer/src/components/PolicySpacePill.tsx):
Public space is rose, Private space is ice, and Unknown is neutral. Never
infer access, membership, or join permission from this moderation label.
Keep its platform-specific explanation in the translation files.

The guide shows the model's values; it doesn't prove every ChilloutVR wire
form. Read [API volatility](api-volatility.md) before changing a mapping, and
never invent a raw value for the Offline Instance.

## §7 Typography

Inter is the face for names, headings, labels, controls, body text, status,
and help. VT323 accents the VRX mark, section kickers, and prominent
statistics. Technical identifiers may use a readable monospace; the Hot
Instance ID uses `ui-monospace`, not VT323.

Dashboard section headings use `--text-faint` at weight 400 in both themes.
Hot Instances keeps its 18 px uppercase kicker; Popular now keeps its 20 px
heading and tracking. Both stay semantic `h2` elements, and page headings stay
as they are.

Fonts load from the licensed local WOFF2 files through `main.css`, with their
provenance and license files kept. Never load remote fonts, add another
display face, use negative letter spacing, or scale type with the viewport.

Japanese text wraps at phrase boundaries, never mid-word: `main.css` sets
`word-break: auto-phrase` on `body:lang(ja)` only, so English and other
languages keep normal breaking. Don't add per-component copies.

## §8 Shell and controls

Use [`AppShell`](../src/renderer/src/components/AppShell.tsx),
[`Sidebar`](../src/renderer/src/components/Sidebar.tsx), and
[`TopBar`](../src/renderer/src/components/TopBar.tsx). The sidebar stays
fixed and the main content scrolls. The default and minimum page size is
900×670, measured inside the window frame (the title bar and borders are
added around it); on a smaller screen the minimum shrinks so the app stays
usable.
Don't design a mobile layout from a narrow documentation viewport.

**Navigation**, in order: Dashboard, Hot Instances, Friends, Activity, Inbox,
Explore, Settings. Hot Instances and Explore can be hidden in Settings →
Behavior, Activity and Inbox in Settings → Appearance, and all four in the
welcome setup; a hidden page leaves the sidebar and its links, while its
Dashboard section and alerts keep their own switches. A hidden page that is
open, or that a hot-instance alert asks for, falls back to the Dashboard.
Groups is not a planned page and never appears as a placeholder.

**Top bar.** It holds the page's single heading; panels below it, the
Friends list included, keep their section headings for screen readers only.
Its platform filter reads
VRC / ALL / CVR and filters the current social view; the sidebar's active
marker echoes it. The filter stays in the same horizontal position on
Dashboard, Hot Instances, Friends, and Explore, even when a scrollbar appears;
nothing else may take its place. The connection indicator pairs color with
shape: a dot is live, a hollow ring is reconnecting, a square is down, and
its label names each platform. The live dot pulses only while VRX has focus;
an endless animation would keep the window redrawing behind a game. On Linux
it stays steady: some Linux desktops draw the pulse's redraw a pixel off, which
shifted the background picture around the filter. Settings replaces the filter with
its category control, on its own row under the title, so the counts stay on
the title row as on every other page.

**Top bar counts** (owner, 2026-11-01) sit right of the filter as one
right-aligned block: "13 friends" with the connection indicator, and under it
how many people play each shown platform ("VRC 48,213 CVR 1,876", each number
beside its platform word). Both follow the platform filter; a platform with no
answer drops out. Hovering or focusing the block opens a small glass panel
that spells out friends online, each platform's connection, the full platform
names and where the numbers come from; Escape or leaving closes it. Settings →
Dashboard → Player counts turns the player numbers off.

**Segmented controls.** Use
[`SegmentedControl`](../src/renderer/src/components/SegmentedControl.tsx) and
[`useSegmentedBubble`](../src/renderer/src/hooks/useSegmentedBubble.ts): a
glass track with an inset bubble that measures the active label. Radio groups
have one tab stop, arrow-key movement, and visible focus. A combined or
neutral option sits between the two platform options. On/off settings use
visible On and Off labels with the same sliding control and keyboard
behavior. Reduced motion is respected.

**Settings** has six categories, each its own page with no scrolling at the
default window size: Appearance, Dashboard, Behavior, Notifications,
Accounts, and About. Each setting sits on a compact neutral card.

- Appearance: Theme, Background glow, Background picture (Choose picture;
  once set, a thumbnail, Change picture, Remove, and Picture fade in the same
  card), and Instance labels. A picture too small, too tall or too wide to
  fill the landscape window is refused with a plain reason; a usable one that
  will be cropped hard or look soft gets one short warning line in the card.
  Last, one pages card: Activity page and Inbox page (both on by default).
  They sit here, not with the other page switches, so Behavior and
  Notifications fit without scrolling. Hiding either keeps its alerts;
  Activity off also stops VRX keeping activity and forgets what it kept.
- Dashboard: Hide empty sections, then Wearing now, Latest invites, Section
  order, Popular now, Hot Instances, and Hot instance threshold, as separate
  rows in Dashboard order.
- Behavior: Hot Instances page and Explore page (one card), Friend details
  open from (whole card or avatar only), Friends background re-sync, and
  Allow joining friends, which contains Confirm before joining, Join in, and
  When the game is already open (Go there, Send invite, or Off; Send invite
  changes only VRChat, since ChilloutVR has one way). Off keeps the saved
  VRChat choice for when it is turned back on.
  Turning a parent off collapses its card with a 220 ms height transition
  (instant under reduced motion). Hidden children are inert and hidden from
  assistive technology, focus returns to the parent control when needed, and
  their saved choices survive.
- Notifications: one alerts card. Who alerts you (Everyone or Picked
  friends; with Picked friends its explanation becomes each platform's pick
  count and a Show link, which lists picks VRChat first with a Remove for
  each), then Friend comes online, Friend joins a world and Friend goes
  offline, then, below a divider, the alerts picks never limit: Hot instance,
  Invite received (invites and invite requests) and Friend request received.
  Each alert is independent and off by default. While Picked friends is on,
  the bell in the friend details panel holds Alert me about this friend; a
  linked person is one pick. Below it, Alerts in VR (off by default) shows
  the alerts switched on above in the headset through XSOverlay, the overlay
  VRCX and CVRX both use, with the same words for both platforms. On opens
  Time on screen (Short, Medium or Long) with a Send a test link after its
  explanation; for a few seconds after a test, the explanation becomes a short
  sent or failed line beside the link.
- Accounts: the VRChat and ChilloutVR account cards side by side, then the
  unofficial-app line.
- About: the app's own upkeep. Automatic updates, with Stable, Beta, and Dev
  in that same card beside the on/off control and the check button, plus the
  installed version, Welcome setup (Run setup again), Found a bug? (Report a
  bug opens GitHub's bug report form in the browser), Open logs folder, and
  Legal.

Saving is reported once, in the shell, failures first. A failed save shows an
alert at once, keeps the latest edits, offers Retry, and stays until a save
succeeds. Shell notices are compact one-row strips with the action beside the
text; the failure leads with a warning glyph as its non-color cue. A normal save is silent; a notice appears only if the latest change
is still unsaved about two seconds later, and the timer restarts on every
change. If the first sign-in check fails, VRX shows a platform-specific
recovery message with Retry, never a signed-out form. A saved VRChat session
that needs a fresh sign-in code shows a one-line notice with Go to Accounts,
and the connection label says Needs code. A healthy platform can
show the app while the other is still pending. A panel failure stays inside
its tab.

**Dashboard switches.** Popular now off hides only its Dashboard section;
Explore stays. Hot Instances off removes its Dashboard statistic, heading,
threshold, cards, and details, and the remaining friend statistics fill two
equal columns. It never hides the Hot Instances page and never affects the
Hot instance notification. Wearing now and Latest invites off hide only
their glance section; the Avatars and Inbox pages and invite alerts stay.
These switches sit in one Sections card with each section's move up and
move down buttons; a button at the top or bottom stays focusable but does
nothing, and each move is announced to screen readers. A
compact "Settings" button below the Dashboard content opens Settings →
Dashboard, even when every section is off.

**Hide empty sections** (owner, 2026-10-27; on by default) makes the
Dashboard fit what it has: Latest invites with nothing waiting, a platform
that reported no worn avatar, and Hot Instances with nothing hot step aside
(Popular now already does). The Hot instances statistic stays, so "0" still
explains the missing section; the threshold stays in Settings → Dashboard
and on the Hot Instances page. A lone glance section takes the whole row and
puts its two platform rows side by side. Off shows each section's empty
state, and card style follows the section order only.

**Updater.** The update control is the sidebar footer button. When there is
nothing to do it is absent; available, downloading, and downloaded each have
their own action and label. The collapsed icon never shrinks, its hidden label
has zero width, and hover or focus may reveal the label without clipping the
icon. While the button shows, the footer text stays clear of it, and a long
pre-release version moves to its own line. The guide's updater actions do
nothing.

## §9 Component behavior

### §9.1 Friends, Dashboard, and Hot Instances

The Friends list uses virtual rows and sticky, collapsible In-Game, Online,
and Offline sections; Offline starts collapsed. Above them, a Favorites
section (owner, 2026-11-01) holds the starred friends who are on now, In-Game
first, and shows only while it has someone in it. A starred friend who is
offline stays under Offline. Every starred row carries a small filled star
after the name in `--favorite` yellow (yellow, not amber, so it reads apart
from ChilloutVR orange), and the row's accessible name says favorite. A pinned section header sits
at the scroll area's top edge, with no strip of rows above it. Search shows
matches without changing saved collapse settings; when nothing matches, only
the no-results line shows, without empty section headers. Roving focus moves between avatars, and
off-screen rows stay out of the Tab order. Compact rows are at least 60 px
and are re-measured as join feedback appears or clears.

Join failures wrap below the row's controls, stay until another attempt or an
account change, and say what to do next. Retry uses the same Join control
with its confirmation, busy state, and main-process checks. Joins never retry
automatically.

The avatar opens friend details. By default the whole card opens them too,
except the Join control and text selection; the "Avatar only" choice in
Settings → Behavior → Friend details open from keeps the row body inert.
The instance pill's Join stays a separate control with the normal
confirmation and denial behavior.

Dashboard statistic cards are one set (owner, 2026-11-01): each card has the
same layout, a VT323 number in `--text` and its label in `--text-dim`, with no
icons (the owner turned down corner icons). Numbers take no presence color:
Friends online counts active and in-game friends together, and the label
already names each number.

Dashboard statistics count accounts. Hot instances group by the exact
platform instance, never just the world name or ID, and need at least the
threshold number of visible in-game friends (2 by default, 1 to 10). The
threshold stepper sits beside a quiet "?" button that toggles an explanation
of grouping, visible friends, the platform filter, ranking, and the
threshold; it starts closed and exposes its state to assistive technology.

The glance row holds Wearing now and Latest invites while they are
neighbours in the section order; apart, each gets its own full-width row.
Its two sections sit side by side when the
area is at least 520 px wide, one above the other below that; a lone section
fills the row, with its two platform rows side by side. Each is a heading with a quiet button (Avatars, or See all N
for the Inbox) over one glass list, and every row is the same height: a
picture, the name, and the platform as a word (PlatformPill), so VRChat and
ChilloutVR read alike. Wearing now has one row per signed-in platform in the
filter: the 4:3 avatar picture and name, or a one-line loading, not-reported,
or failed state with Try again. A row opens the Avatars page. Latest invites
shows the newest invite or invite request per platform, VRChat's first, in
the Inbox row's words and age; a row opens the Inbox, and with the Inbox page
hidden the rows are plain text. With nothing waiting it shows one quiet line,
or, with Hide empty sections on, steps aside.

Each Dashboard section shows two cards, chosen as in "Locked for 1.0". The
second section's bars show the world picture behind a same-color scrim with
the platform tint on top, so the platform color still reads at a glance;
pills over a picture get a small backing in the card color. Card grids follow
the card style, not the section order: picture cards sit two across when the
area is at least 440 px wide (as in Explore), and bars two across from 620 px.
On wide windows picture grids (Explore, Popular now, world results, Hot
Instances) add a column each time a column would pass about 730 px: three
from 1,480 px, four from 2,200 px, up to eight. A picture card never stretches
far past its picture, so an ultrawide, a TV or a fullscreen 1080p window shows
more cards instead of blurry ones. To avoid half-empty rows, Explore's
Popular now rounds "Worlds shown" up to whole rows, and a Dashboard section
with picture cards shows one full row (one card per platform first), both
only as far as there are cards to show; bars stay two across. The rule lives
in `main.css` (`.picture-grid`, `.hot-grid--picture`), mirrored for counts by
`pictureColumns.ts`.
The Hot Instances
section adds a quiet "See all N" button, shown only while the page is, that
opens the Hot Instances page,
which lists every hot instance as a picture card, most friends first, with the
same header, empty state, and sheet. The access pill on a hot card is a
discreet Join shortcut; don't turn it into a prominent Join button. The Hot
Instance sheet supplies the details; no placeholder actions.

### §9.2 Friend details

The friend details drawer is a non-modal frosted panel whose soft scrim
doesn't block input. Escape, a click outside, and Close all dismiss it the
same way, and opening another friend switches the profile. Focus returns to
the opener or the search box. Closed content is inert and hidden from
assistive technology. While a confirmation modal is open, the drawer pauses
its own dismissal.

The order is: header, written status, Where, actions, Notes, and Trust. A
footer pinned below the scrolling area holds Identities on the left and, on
the right, the favorite star and the alerts bell. The star is an outline when
off and a filled `--favorite` star when on, so its state never rests on color;
a linked person is one star across both accounts. Stars stay in VRX. The bell shows whether this friend can alert you by
shape, not color: sound waves when on, a slash when off, and the button's
name says On or Off. Pressing it springs a small panel out of the bell
(scale and fade with a slight overshoot, rows following one after another,
and the bell swings); reduced motion shows and hides it without movement. The
panel holds Alert me about this friend while alerts are limited to picked
friends (otherwise one line says every friend can alert you), the three
friend alert kinds with a check or dash beside each, and Alert settings, which
opens Settings → Notifications. Escape or a press outside folds the panel
before the drawer itself closes. A long name wraps to two lines before it is cut, and its tooltip
shows it in full. Where cards keep privacy rules, show neutral art when a picture is
missing, use instance labels, and never show raw IDs or policy pills; a split
card names each platform. If notes load without a valid account revision,
they stay read-only with Retry. A failed save keeps the draft and a warning;
a successful save is quiet. A presence change never retargets a draft.

### §9.3 Confirmation and sheets

Join confirmation is a true heavy-frosted modal. It keeps focus inside, offers
Cancel, respects permission denials, reviews the live target, and handles
session changes and in-flight states. The main process has the final say, and
confirmation preferences never bypass permission or target checks.

Explore and Hot Instance sheets are contained and non-modal and share one
layout: platform stripe, grab bar, then the picture starting below Close.
Close stays reachable outside the scrolling area. In the light theme a sheet
banner keeps the photo at full brightness and lays a soft card-colored scrim
under the title instead of darkening it. The banner's pills and Join sit on
the same small card-colored backing as other pills over a picture. Escape, a click outside, and Close
return focus to the opener or a stable fallback. A confirmation modal owns
dismissal while open, and the Dashboard never shows both sheet types at once.

Every bottom sheet (Hot Instance, Explore world, Avatar, person, group) opens
collapsed, and its grab bar is a real control (`SheetGrabBar`): drag up to
expand to nearly the window height, drag down to collapse, and pull a
collapsed sheet down to close it. A press on the bar, Enter or Space toggles;
Arrow Up and Arrow Down expand and collapse. Expanding grows the banner and
adds the sheet's "more" details (`SheetFacts`) from data already on hand,
never a new platform request. Both platforms show the same extra fields in
the same order. Each reopen starts collapsed.

### §9.4 Explore and loading states

Explore and the Dashboard's Popular now use the same world card. Equivalent
content from both platforms gets equal treatment. Occupancy is "People"; the
old "Visible rooms" figure is gone. Don't repeat the top-bar heading.

Dashboard and Explore show one "Worlds loading…" line while any selected
platform is loading for the first time with nothing to show yet, even beside
cards from the other platform; those cards stay visible. The line ends when no
selected source is still loading for the first time. A normal refresh with
cards already shown is silent. Real errors, unavailable sources, stale
results, and verified empty states stay visible. Unknown or partial counts
stay unknown, never zero. Nothing here may add polling. Under All, a platform
the user isn't signed in to adds no line; filtered to that platform, Explore
shows the same Connect gate with Go to Accounts as the Dashboard.

When one platform's roster fails, Friends keeps the usable list and shows a
line under the header naming that platform, with a Retry for that platform
only. A platform that never loaded uses the error color; one showing its last
loaded list uses `--text-dim`, matching Explore's stale line. When the other
platform loaded an empty roster, that named line replaces the generic error.

**Sign-in from this PC.** Under each sign-in form (login screen, Accounts,
welcome setup) a quieter outlined button, "Use my sign-in from VRCX" for
VRChat and "Use my sign-in from ChilloutVR" for ChilloutVR, sits below the
platform-tinted Connect button, so the password sign-in stays the main way in.
Both platforms get the same button in the same place at the same size, with a
one-line hint that the source app is only read. VRX looks only when the button
is pressed; there is no startup prompt. Not found and no-longer-accepted
results name where VRX looked and point back to the password form. An imported
VRChat sign-in whose second factor expired opens the normal code prompt.

**Welcome setup.** A brand-new install opens one centered information card
before the app: a welcome screen, five labeled steps (Sign in, Pages,
Dashboard, Alerts, Look), then a summary. Step state reads from position,
weight and a check, not color. Sign-in shows the two Accounts cards side by
side at equal height, and the line under its title doubles as the live sign-in
status, so the step fits the default window without scrolling; one ready
account is enough to continue. Every other step
changes the real settings as the user picks and keeps the defaults (all alerts
off, VRChat instance labels) until changed. Pages lists Hot Instances, Activity, Inbox
and Explore; Alerts lists the same six alerts as Settings → Notifications, friend alerts
in one card and inbox alerts in another, so the step fits without scrolling. Look also offers the background
picture (same picker, checks and wording as Settings; the fade stays in
Settings) and asks for the instance label style. Skip setup is a visible button on every screen before the
summary, never a small link, so setup never feels like a forced tour; skipping before any
account is ready shows sign-in only, then opens the app. The main button is a
neutral text-colored fill, so neither platform color leads. Each screen keeps to a
short line or two; the welcome's unofficial-app notice is one line, and the
sign-in storage note is one short line with the full text behind Show more
(Locked rule 11). Settings → About offers Run setup again.

**Sign-in.** Sign-in text explains OS-backed encryption and the weaker
local-key fallback (in setup, behind Show more), and never promises keychain
protection everywhere. The
sign-in screen (both tabs) and Accounts show the one-line unofficial-app notice
in plain dim text. Settings → About → Legal, closed by default, holds the full
text: a VRChat sentence and ChilloutVR's required disclaimer, worded the same
way, plus help, terms, privacy and license notes (see
[API policy](./api-policy.md)).
The real credential and two-factor forms are used in examples; a secure
storage failure keeps its dedicated message. Guide fixtures accept only
made-up input and never sign in or save it.

### §9.5 Activity

The Activity page lists friends coming online, joining a world, and going
offline, newest first. Main records it from the live sockets with the same
transition rules as the alerts but without the toast rate limit, keeps it in
memory only (up to 300 entries per platform, so one platform never pushes the
other out), and forgets a platform's entries at an account change or sign-out.
Reading it makes no platform request.

Both platforms share one row: a small avatar, the name, what happened in
words, the platform pill filling a fixed-width column (both pills the same
size, the word centered), and the time (with the date
once it is not today). Each row is its own capsule tinted with its platform's
color, strongest at a 3px platform edge on the left, so the platforms read
apart at a glance; the pill is the non-color cue. The same `.platform-row`
capsule carries friend rows (a linked person runs blue into orange), Inbox
rows and the Dashboard glance rows, so a platform looks the same on every
list. Coming online straight into a world is one entry that
names the world; a ChilloutVR world name that resolves a moment later fills
in, and its `(#…)` instance tag is trimmed. Ask Me and Do Not Disturb friends
never show a world, and their moves are not recorded. The top-bar filter
scopes the list; the page's Show control (All, Online, Worlds, Offline) is a
saved setting. Clear empties the list. A row opens that friend's details on
the Friends page, as a linked person under All; a friend no longer on the
list is plain text.

### §9.6 Inbox

The Inbox page lists invites, invite requests and friend requests that the two
platform sockets deliver while VRX is open. It is view-only: VRX never
accepts, declines or replies, and the "?" help says to answer in the game or
on the platform's site. Hide removes a row inside VRX only; Hide all hides
every row in the current platform filter. Nothing is stored, so the list
starts empty each launch.

- Two sections, Invites (invites and invite requests) and Friend requests,
  each newest first, and both platforms mixed in one list with equal weight.
- A row shows the sender's picture when they are a friend (no presence ring)
  or their initial, the name (a friend's current name, else the name the
  platform sent, else "Someone"), a platform pill with the platform word, the
  action ("Invited you to Pug Lounge", "Asked you for an invite", "Sent you a
  friend request"), a relative age ("Just now" under a minute) and a Hide button.
- It follows the platform filter, offers Accounts when the filtered platform
  is not connected, and has a short empty state.
- The sidebar shows a neutral count badge (text, never color alone) of rows
  newer than the last ones shown, per platform; opening the page clears it.
- Invite and friend-request alerts are separate switches in Settings →
  Notifications, both off by default, and limited to a few a minute.

### §9.7 Search, profiles, Groups and world lists

Read-only community views (owner, 2026-10-31). Every one follows the platform
filter, offers Accounts when the filtered platform is not connected, and adds
no line under ALL for a platform the user isn't signed in to.

- **Search** sends only on Enter or the Search button, never while typing.
  People and Worlds are two sections; each alternates the platforms' results
  (first of each, then second of each) so neither platform leads. People are
  square picture tiles with the platform stripe, tint and VRC/CVR badge, and a
  quiet "Friend" line. Worlds use the Explore world card and sheet with Join.
- **Full profile** opens in the non-modal bottom sheet (Search) or behind
  "Show full profile" in friend details (collapsed by default). Fields come in
  one order on both platforms: Pronouns, Rank, Bio, Badges, then Show worlds
  and Show groups, which read only when pressed. A missing field says "Not
  shown"; VRChat trust uses the friend-details rank words.
- **Groups** is one name-sorted grid (neutral across platforms) of cards that
  are wider than tall: the group's square icon centered on top over a blurred
  copy of itself (never cropped), then the name, and the VRC/CVR badge with
  "Owner" or the group code. No picture, or one that fails, shows the name's
  first letter on the platform color instead of an empty box. A group opens the bottom sheet
  with its banner, platform pill and role pill, description, and Details
  (Code, Members, Your role). View only.
- **Explore** has a segmented Popular now · New · Recently updated ·
  Favorites control. The lists alternate platforms like Search and open the
  same world sheet. Favorites (owner, 2026-11-01) lists the starred worlds,
  newest first, with no Refresh because nothing is fetched for it. The world
  sheet's star follows the world name.
- **Player counts** moved from a line under the Dashboard stat cards to the
  top bar (§8, owner, 2026-11-01).

## §10 Linked friends

Linking is explicit and local. Each person links one VRChat account and one
ChilloutVR account, scoped to the signed-in accounts. Original names and notes
stay; a new link starts with its own blank shared note. Never infer a link
from similar names or presence, and never read or write VRCX or CVRX data for
it.

The platform filter shows the saved person without changing the link: All
combines the accounts, and a single-platform view shows that account. The
header prefers in-game, then active, then offline, with the preferred platform
breaking ties. A merged picture changes artwork only, never the status source.
Two locations use a hard, centered 45-degree split, VRChat upper-right and
ChilloutVR lower-left. In the row, two joinable locations share one
"2 locations" pill whose halves carry each access tier by color, so the world
line names each tier in words after its platform tag.

Combined Join always opens the destination chooser, even with one eligible
choice, and never picks for the user. Single-platform views use the normal
direct flow. A choice invalidated by a location change stays invalid until
the chooser is reopened. Hidden or stale location data never becomes an
action or leaks through metadata. Friends' online count counts unique people;
Dashboard statistics stay account-based.

Identities manages links in native modal dialogs. Replacing or unlinking
shows the affected pairs and any shared-note loss and needs an explicit
acknowledgement. Unsaved or in-flight drafts block destructive changes and
offer a way back to the editor. Reviewed revisions must still match. Account
ownership checks, all-or-nothing writes, explicit Retry, and account-change
invalidation stay. If linked profiles fail to load, Friends and Identities
offer a local Retry; a retry joins any read already running and can't restore
an outgoing account's data. Saving or resetting a name clears only an
unchanged draft.

Sources: [`projectLinkedFriends.ts`](../src/renderer/src/utils/projectLinkedFriends.ts),
[`FriendDrawer.tsx`](../src/renderer/src/components/FriendDrawer.tsx),
[`IdentitiesDialog.tsx`](../src/renderer/src/components/IdentitiesDialog.tsx),
[`LinkedDialog.tsx`](../src/renderer/src/components/LinkedDialog.tsx), and the
[renderer contract](../src/renderer/AGENTS.md).

## §11 Known open findings

These are tracked separately and are not design rules: Full shown below
capacity, and Private versus Hidden wording. Don't fix them in passing or
present them as approved. The access pill's discreet Join shortcut is
approved, not a defect. A proposed design is labeled as a proposal and never
replaces a current example before approval.

A source or sample-data check doesn't prove the owner accepted something in
an installed app. Never hide a product defect with preview-only styles. Keep
access to existing controls and workflows. The security, credential, account,
request-rate, and merge rules in the root contract still apply; no visual
change waives them.

## §12 Workflow and verification

1. Read the owning source and the [internal API catalog](INTERNAL-API.md).
   Reuse the existing component, resolver, hook, store, and translation
   before adding one.
2. Run `npm run guide:dev` and open `http://127.0.0.1:4173/design.html`, or a
   single scene such as `glass.html?scene=dashboard`. Guide controls stay
   outside the production examples.
3. Check representative widths, both themes, each glow level, with and
   without a background picture, real
   typography, material over busy content, overflow, keyboard focus, reduced
   motion, and the loading, error, and disabled states. Use the browser or app
   test tool you were asked to use, and report it before substituting
   another. Device access and screenshots follow the local environment's
   policy and the task's scope; this document grants neither.
4. A served page or a successful build is not an observed render. Sample
   scenes prove only their sample behavior, not live accounts or a packaged
   install.
5. Run `npm run guide:build` and the guide tests. For app or build changes,
   also run the root gate and the relevant behavior tests. Guide code and
   output never ship in the app. The guide never mounts the real app
   bootstrap, reuses the live preload bridge, loads remote art, or forwards
   sample actions.
6. Settle the guide and examples, then update this document, the owning
   `AGENTS.md` files, the catalog, and the changelog. Keep section numbers
   stable.

Code comments cite these section numbers and a few older rule labels. R2, R10,
and R12 mean a color always has a non-color cue (label, glyph, or word); R6 is
the Ask Me and Do Not Disturb location privacy rule in §5; R5 is the updater
showing an indeterminate "Updating…" label while it downloads. "Channel law"
means the color rules in "Locked for 1.0" and §5.

The guide includes the renderer's Tailwind utilities through
`guide/production.css`. Its isolated documents keep the root theme, body
background, portal, and fixed positioning. Desktop samples keep 900×670 and
scroll inside a narrower guide. Overlays that take focus wait for a click.
Shared scenario controls include each platform's first load, a quiet refresh
with cards kept, and note failure and retry. Each scene starts from sample
memory, and reset reloads it. Never replace real components with copied HTML
to make a preview look right.
