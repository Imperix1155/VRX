# VRX design language

This is the complete description of how VRX looks and behaves: the rules,
the materials, every design token with its real value, and copy-ready recipes.
It is written so a person or an AI agent with no other context can build a
screen that looks and feels like VRX, and can tell when a change would break
the design.

- **Humans:** read this alongside the visual guide, [`design.html`](design.html),
  which renders the real app components with sample data in both themes and
  shows the code behind each example. Run `npm run guide:dev` and open
  `http://127.0.0.1:4173/design.html`.
- **Agents:** read this file top to bottom before UI work. Start with
  [Quick start](#quick-start-for-agents), follow the Locked rules, and take
  values from [Appendix A](#appendix-a-token-reference). The recipes in
  [Appendix B](#appendix-b-recipes) follow the shipped code.

**Source of truth.** The renderer components in
[`src/renderer/src/components`](../src/renderer/src/components) and the
stylesheet [`main.css`](../src/renderer/src/assets/main.css) are the
implementation. This document records the decisions that code must keep, and
Appendix A is generated from `main.css` (`npm run design:tokens`), so its
values always match the app. If the code and the prose disagree, investigate
before changing either. A known defect is never a design rule, and an old
example is never an approved redesign.

**Stable references.** Code comments cite this document by section ("DESIGN.md
§5") and by Locked rule number ("Locked rule 5"). Keep both numbering schemes.
Older comments use rule labels from earlier versions; [Appendix D](#appendix-d-glossary-and-legacy-labels)
translates them.

## Quick start for agents

VRX is a dense desktop companion for two social VR platforms, VRChat and
ChilloutVR. Its look is **layered frosted glass over a dark aurora canvas**:
a blue glow in the top-left corner, an orange glow in the bottom-right, faint
scanlines, and stacked translucent panes that blur whatever is behind them.
Inter carries the interface; the retro VT323 face is a small accent.

To build a screen that belongs in VRX:

1. **Pick the layer.** The page sits on a back panel (`.glass .glass-panel`) or
   straight on the canvas. Cards and rows are `.glass .glass-layer` (or
   `.platform-row` when they belong to one platform). Pills and badges are
   `.glass-chip`. Menus and dialogs are opaque (`.glass .glass-information`,
   plus `.glass-frosted-heavy` for a confirmation). See §3.
2. **Use tokens, never raw colors.** Every color is a CSS variable from
   Appendix A, used through Tailwind arbitrary values such as
   `text-[var(--text-dim)]` or `bg-[var(--control-fill)]`. Light mode is the
   same variables overridden under `[data-theme='light']`; you get it for free.
3. **Give every color a job and a word.** VRChat is blue (`--vrc`) and always
   comes with the word VRChat or VRC; ChilloutVR is orange (`--cvr`) with
   ChilloutVR or CVR. Status, access and errors carry words or glyphs too.
   The only color-only cue is the friends-list avatar ring (Locked rule 4).
4. **Treat both platforms the same.** Same layout, same fields in the same
   order, same size, same wording weight. VRChat first when an order is needed.
   Never invent a feature for the platform that lacks it.
5. **Say little.** Show what most people need in few words; put the rest
   behind a quiet "?" or Show more control, in Settings, or in About.
6. **Type:** Inter 13 px for body text, 12–12.5 px for labels, 25 px extra
   bold for the page title, VT323 only for the wordmark, section kickers and
   big numbers. Text is `--text`, secondary text is `--text-dim`.
7. **Shape:** panels round at 20 px, controls and rows at 12 px, pills at
   9–10 px. Spacing comes from the 4 px scale (`--space-1` … `--space-10`).
8. **Controls:** choices are the shared segmented control (`SegmentedControl`,
   or `Toggle` for On/Off). Buttons are quiet fills on `--control-fill`; the
   one filled button on a screen is the main action.
9. **Accessibility is part of the look:** visible focus rings, keyboard paths
   for everything, motion only under `motion-safe:`, nothing color-only, and
   every workflow usable at the 900×670 minimum window.
10. **Check both themes** (dark and light), every glow level, with and without
    a background picture, and in Japanese, before calling a change done.

## Locked rules

These decisions are settled by the owner. Changing one needs the owner's
explicit approval.

1. **Equal platforms.** VRChat and ChilloutVR get the same treatment, visual
   weight, wording weight, and features wherever both platforms support them.
   That includes the app icon, where the V and X are the same size (§1).
2. **Brand colors.** VRChat is blue (`--vrc`) and ChilloutVR is orange
   (`--cvr`), following each platform's brand. The combined "All" view uses
   the blue-to-orange blend.
3. **Color always means something, and never alone.** Every color cue sits in
   a consistent place with a non-color cue nearby: a word, glyph, shape, or
   label. Platform pills and tabs carry the platform name, instance pills are
   words, and the connection indicator pairs color with shape (§8).
4. **The one color-only exception.** In the friends list, the avatar ring and
   its corner dot show presence and status by color alone, to keep rows clean.
   The row's accessible label names the state, and the friend details panel
   shows the written status (§5). Don't "fix" this.
5. **Missing is red, stale is dim.** A source that never loaded uses the error
   color (`--error`). A source showing older data uses `--text-dim` (§9.4).
6. **Layered glass.** The UI is panes of frosted glass stacked on each other
   (owner, 2026-11-04): the background, then the sidebar and back panels, then
   the cards and rows on them, then the small chips on the cards. The
   background shows through every pane as blurred color; words stay readable
   and platform color stays the strongest tint on a platform card. Menus and
   dialogs stay opaque (§3).
7. **Dashboard layout.** Under the numbers the Dashboard has four sections:
   Wearing now (the worn avatar per signed-in platform), Latest invites (the
   newest invite per platform), Popular now and Hot Instances, in that order
   by default. Settings → Dashboard → Sections moves each one up or down and
   turns it on or off, all on by default; off only hides the Dashboard section
   (§8, §9.1). Wearing now and Latest invites share one glance row while they
   sit next to each other. Of Popular now and Hot Instances, the first shown
   uses picture cards and the second uses bars with the world picture behind
   them. Each shows two cards: the top one per platform when both have one,
   otherwise the top two. Hide empty sections, on by default, lets a section
   with nothing to show step aside so the others take its space.
8. **Hot Instances page.** The sidebar has a Hot Instances page listing every
   hot instance, most friends first. It shows by default and can be hidden in
   Settings → Appearance → Sidebar pages (§8). While it shows, the Dashboard
   section's "See all" button opens it (§9.1).
9. **Privacy first.** Friends set to Ask Me or Do Not Disturb never reveal
   their world or instance anywhere, including notifications (§5).
10. **Liquid glass on an aurora.** Glass is the material, with a blue top-left
    and orange bottom-right aurora, restrained scanlines, and retro type
    accents. The Theme setting defaults to System (§0, §3, §4).
11. **Simple by default, more on demand.** Each screen shows only what most
    people need, in as few words as possible. Longer explanations, fine print
    and power-user options sit behind a Show more or ? control, in Settings,
    or in About, where people who go looking find them. Required notices stay
    reachable, never dropped (§9.4).

Two more owner rules apply to every change:

- **Never force a tour.** Optional guidance always has a visible Skip; the
  welcome setup is the only guided flow (§9.4).
- **No personal information** about the owner or any real user appears in the
  app, the guide, fixtures or screenshots. Sample data is invented.

## §0 Direction and authority

VRX is a dense desktop companion, not a website. Equivalent concepts on the
two platforms use the same presentation and terminology. A feature one
platform doesn't have stays absent for that platform; never fake it, and never
add a feature just to make the platforms match.

Dark is the stylesheet baseline (`:root`). Light mode uses the same
components, hierarchy, interactions, and meaning, with token overrides under
`[data-theme='light']`. The stored Theme preference defaults to System, which
follows the operating system. Don't confuse the dark baseline with the default
preference.

Visible wording, layout, and interaction changes need the owner's approval
unless an approved issue already specifies the outcome. Polish that keeps the
design language (alignment, contrast, focus, spacing, overflow) is welcome;
changing the language itself is not. Documentation work never authorizes
redesigning the app.

## §1 Identity

**Wordmark.** Inside the app, the brand is the horizontal VRX wordmark in
VT323 with the platform colors on V (`--vrc`) and X (`--cvr`) and the neutral
bridge color (`--bridge`) on R, with the subtitle "Social VR Companion" in
11 px `--text-faint` below it. The sidebar sets it at 40 px with 2 px
tracking; the welcome screen at 64 px. Page titles name the active view. When
a platform logo is needed, use the platform's official asset; never draw a
substitute.

**App icon.** The launcher icon is the VRX lettering on a frosted glass chat
bubble, drawn as the app's layered glass: the blue and orange aurora is the
canvas, the bubble is a frosted back panel, and the letters are glass layers on
it. The R sits behind; the V and X overlap it from both sides at the same size
and depth, in a lighter frost tinted blue and orange so the R shows through.
The colors don't change with the theme or desktop background.
`build/icon.svg` is the master; `build/icon-24.svg` is a simpler drawing for 17
to 32 px and `build/icon-16.svg` a pixel drawing for 16 px.
[App icon](APP-ICON.md) owns the files, sizes, and the
`npm run icons:generate` / `npm run icons:check` workflow.

Sources: [`Sidebar.tsx`](../src/renderer/src/components/Sidebar.tsx),
[`LoginScreen.tsx`](../src/renderer/src/components/LoginScreen.tsx),
[`viewTitles.ts`](../src/renderer/src/utils/viewTitles.ts).

## §2 Tokens and themes

`main.css` owns every token value, font face, spacing step, radius, material
class, background effect, and light override. [Appendix A](#appendix-a-token-reference)
lists all of them with both themes' values. Use the existing semantic
variables and the spacing scale; add a shared token only for an approved need
that existing ones can't meet, and never copy a value into a component.

Themed colors are raw CSS variables, not Tailwind theme colors, so they switch
at runtime. Components consume them through arbitrary values
(`text-[var(--text-dim)]`, `border-[var(--border)]`) or `style={{ color:
'var(--vrc)' }}`. Only the static scale (radii, fonts) lives in Tailwind's
`@theme` (`rounded-control`, `rounded-panel`, `font-mono`). A build must never
bake light and dark values into a fixed palette.
[`applyTheme`](../src/renderer/src/hooks/useApplyTheme.ts) sets
`data-theme="light"` on `<html>` for light and removes it for dark.

### Token families

| Family                  | Tokens                                                               | Job                                                                     |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Canvas and text         | `--bg-base`, `--text`, `--text-dim`, `--text-faint`, `--names-lift`  | The base canvas and the three text steps                                |
| Neutral controls        | `--border`, `--surface-hover`, `--control-fill(-hover)`              | Hairlines, hover wash, quiet button fills                               |
| Feedback                | `--error`, `--warning`, `--favorite`                                 | Missing data and failures; caution; the favorite star                   |
| Platforms               | `--vrc`, `--cvr`, `--bridge`                                         | Brand hues: fills, rings, edges, glow                                   |
| Platform words          | `--plat-*-word`, `--plat-*-ghost-text`, `--login-tab-*`              | A brand word set in its own color, lifted to 4.5:1                      |
| Platform badges         | `--plat-*-badge-*`, `--plat-*-rail-*`, `--plat-*-picture-badge-bg`   | Small VRC / CVR labels: quiet outline in dark, solid fill in light      |
| Platform surfaces       | `--tint-*-bg`, `--tint-*-border`, `--platform-row-tint-*`            | Platform-tinted cards and rows                                          |
| Presence                | `--ingame`, `--active`, `--offline` (+ `-text`)                      | Friend state: in a world, online outside the game, offline              |
| VRChat status           | `--st-joinme`, `--st-online`, `--st-askme`, `--st-dnd` (+ `-text`)   | The four VRChat statuses                                                |
| Instance access         | `--op-*` (+ `-text`)                                                 | The openness ladder: green (open) to orange (locked), purple for groups |
| Policy space            | `--policy-public`, `--policy-private` (+ `-text`)                    | Moderation context: rose public, ice private                            |
| Pill strength           | `--pill-tint`, `--pill-edge` (+ `-strong`)                           | How much of a pill's hue fills and edges it, per theme                  |
| Glass                   | `--glass-*`, `--scrim*`, `--control-active-*`, `--seg-bubble-*`      | The material: fills, blur, edges, shadows, sheen, selected states       |
| Pictures and sheets     | `--hot-sheet-*`, `--group-*`                                         | Banner scrims, shadows and filters                                      |
| Canvas glow             | `--aurora-*`, `--glow-*`, `--wisp-*`, `--scanline-*`                 | The aurora and scanlines (§4)                                           |
| Spacing and geometry    | `--space-*`, `--sidebar-width`, `--content-inset-*`                  | The 4 px spacing scale and shell geometry                               |
| Static scale (`@theme`) | `--radius-pill` 9, `--radius-control` 12, `--radius-panel` 20, fonts | Radii and font stacks, the same in both themes                          |

### Text steps

- `--text` is for names, headings, values, and anything that must be read.
- `--text-dim` is for secondary text a person still needs: labels, notices,
  fine print, counters, versions, loading lines, Dashboard section headings.
- `--text-faint` is only for the wordmark subtitle, placeholders, disabled
  controls, and technical identifiers such as the Hot Instance ID. It never
  carries information a person must read.

### How light differs from dark

Light is not dark inverted. The canvas is a cool gray (`--bg-base: #e7ecf3`)
and cards are white, so panels read as raised. Brand colors stay at full
strength for fills, rings, edges and the glow, while words in a brand color
use a deeper companion that clears 4.5:1 on white and on the platform tints.
Every small platform label (the friends-list rail, platform pills, the short
badge on a picture) is solid platform color with white words in light, so blue
and orange show at a glance down a list; in dark the same labels are quiet
outlines, where the word and edge already glow. The ChilloutVR badge fill is
one step deeper than the raw orange (`--plat-cvr-solid`) so its white word
clears 4.5:1. The dark friends-list rail is the one firmer outline: it sits on
a row already washed in its own hue, so it takes a stronger tint, edge and word
(`--plat-*-rail-*`), and it sits 3 px in from the row's edges.

Contrast targets: body text and every word that carries meaning clear 4.5:1 on
the surface it actually sits on, in both themes, including over the glow and a
background picture. Token comments in `main.css` record the measured ratios;
re-measure when a token changes.

## §3 Material: layered glass

The whole interface is one material in five layers. Each layer is a pane of
frosted glass that blurs what is under it, so a background picture or the
aurora glows through as soft color, while each pane keeps enough fill that its
words stay readable.

| Layer | What it is                                       | Class                                                   | Fill token                       |
| ----- | ------------------------------------------------ | ------------------------------------------------------- | -------------------------------- |
| 0     | Canvas: base, picture, aurora                    | `body`, `.app-backdrop`                                 | `--bg-base`, `--aurora-*`        |
| 1     | Shell chrome: sidebar, tracks                    | `.glass`                                                | `--glass-bg` (translucent)       |
| 2     | Back panels and side sheets                      | `.glass .glass-panel`, `.glass .glass-sheet`            | `--glass-panel`, `--glass-sheet` |
| 3     | Cards, rows, headers, fields                     | `.glass .glass-layer`, `.platform-row`, `.setting-card` | `--glass-layer`                  |
| 4     | Chips: pills, badges, rails                      | `.glass-chip`                                           | the chip's own tint              |
| —     | Opaque information: menus, dialogs, error screen | `.glass .glass-information` (+ frost)                   | `--glass-information`            |

**`.glass`** is the base skin: a soft diagonal gradient (`--glass-bg`), the
sidebar's blur (`--glass-blur`), a hairline edge (`--glass-border`), the panel
radius, and a deep shadow with a lit top edge (`--glass-shadow`). Its
`::before` paints a sheen (`--glass-sheen`) from the top-left corner at
z-index -1, under every child, so it lights the pane and never washes out
text, logos or pictures.

**`.glass-panel`** is the back panel a page's cards sit on (the Friends list,
Settings). **`.glass-sheet`** is the frost of the friend details drawer and the
world, hot instance, avatar and group sheets, heavier than a panel
(`--glass-sheet`) because sheets float over live cards and what is behind them
must read as glow, never as words. Both draw their blur on an `::after` layer
at z-index -2, never as a `backdrop-filter` on the element itself: a backdrop
filter makes its element the containing block for fixed children, which would
pin the friend drawer inside the list. Never put a backdrop filter on an
ancestor of a fixed overlay.

**Edge reach.** On a scaled display (125%, 150%) the graphics card's blur can
stop short of a blurred box's right and bottom edges and fill the last strip
with one flat color, which shows as a seam over a busy picture. So a blur
layer reaches `--glass-reach` (32px) past those two edges and a clip-path
trims it back to the box's rounded shape; the short strip falls outside and is
never seen. Panels, sheets and the unclipped `.glass-layer` cards (statistics,
notices, empty states) draw their blur this way. Bottom sheets round only their
top corners, so they set `--glass-clip-radius` to match. A clip-path hides
paint but the hidden reach still counts as content, so the app shell wraps
its views in a box that clips sideways at the scroller's padding edge (and
downward on Settings, whose bottom padding is thinner than the reach). Any
other scroller that holds reaching glass near its edge needs the same.

**`.glass-layer`** makes a card, row, header or field its own frosted pane: the
sidebar's blur, a thinner fill (`--glass-layer`), lifted by a lit top edge and
a soft shadow (`--glass-layer-depth`). On a back panel it blurs the already
frosted panel, so the stack reads glass over glass; on the bare canvas it is as
frosted as the sidebar. It covers platform rows, setting cards, the Friends
section headers and search field, statistics, Hot Instances, Popular now,
Explore, avatar, group and account cards, the login card, the sign-in fields,
the welcome setup's theme choices, notices and empty states. No fixed-position
child may live inside one. Small icon tiles in setup are `.glass-chip`s.
A `.glass .glass-layer` card that does not clip its content builds its pane
from layers for the edge reach: `::after` is the blur, `::before` the fill,
face (`--glass-bg` or the platform tint, through `--glass-face`), sheen,
border (`--glass-edge`) and lift, and the card itself paints nothing. It looks
the same as a card that blurs itself. Picture cards (Hot instances, Explore,
avatars, groups) take the reach too: instead of clipping the whole card they
round their pictures to the card's inner corners (`.glass-clip-top`,
`.glass-clip-left`, `.glass-clip-all`). They brighten on hover with
`.glass-hover`, which brightens the pane, its blur and the pictures by 5%. A
`hover:brightness` filter on the card would make it a backdrop root and empty
its blur layer, so a test refuses one on any `.glass-layer`. Only the sign-in
and account cards still clip their content (`overflow-hidden`) and blur
themselves.

**`.platform-row`** is a layer-3 row that belongs to one platform: the same
glass, washed in its platform's hue from the left (`--platform-row-tint-strong`
fading to `--platform-row-tint-soft`) and a soft platform-colored border.
No solid accent bar on any edge (owner, 2026-11-06), here or on any card,
sheet or dialog: the frosted tint and the VRC/CVR word carry the platform. Modifiers: `.platform-row--vrchat`, `.platform-row--chilloutvr`, `.platform-row--vrx` (a
linked person, blue running into orange) and `.platform-row--none` (loading and empty rows,
plain). Friend rows, Activity, Inbox and the Dashboard glance rows all use it,
so a platform looks the same on every list.

**`.glass-chip`** is the top pane (owner, 2026-11-04): instance, platform and
rule pills, platform badges on pictures and in friend details, the
friends-list platform rail, the linked VRC and CVR tags, the friend details
status band, alert kinds, and the sidebar's Inbox count. A chip keeps its own
tinted fill under the sidebar's blur, with a glossy top light under its word
(`--glass-chip-sheen`, on `::after` at z-index -1) and a tight lift
(`--glass-chip-depth`). Chips over a picture sit on a heavy card-color frost
(74% of `--glass-information`), so the art glows through but never sits bare
under the word. Presence dots keep their solid color and take only the lift
(`.status-badge`). Words that must be read, such as names, custom status
messages, world names and other details, stay plain text on their card and
never become chips.

**`.glass-information`** puts an opaque neutral backing
(`--glass-information`) under the existing gradients and turns the blur off
(nothing behind an opaque pane can show, so it saves the GPU). Menus,
dialogs, the welcome setup, the boot splash, the error screen, the top-bar
counts panel and the favorite and alert panels use it, so their colors and
meaning never change with the background. Add **`.glass-frosted`** for a
frosted dialog and **`.glass-frosted-heavy`** for a true confirmation modal
(Join, Unfriend, Block); both use the stronger `--glass-blur-frosted`.

**Platform tints.** `.tint-vrc` and `.tint-cvr` wash a card in its platform's
hue (`--tint-*-bg`) with a platform edge (`--tint-*-border`). They set
`background-image` only, never the `background` shorthand, which would clear
an opaque backing. On a platform card, platform color stays the strongest tint
in the stack.

**Layer order rules.** Keep the material classes in `@layer components` so a
utility on the same element still wins (for example `fixed` on the drawer).
Frost modifiers follow `.glass`; `.glass-information` follows the frost
modifiers so its backing wins without clearing the gradient; `.glass-panel`
and `.glass-sheet` follow `.glass-information` so their transparent backing
wins. In compiled CSS `-webkit-backdrop-filter` comes before the standard
`backdrop-filter` (Electron needs the standard property). Check the
computed result, not just source order.

**Overlays and focus.** Use the existing overlay components instead of
building a new scrim or focus pattern. The friend drawer and bottom sheets are
non-modal: a soft scrim (`--scrim-soft`) that doesn't block input, no
`aria-modal`, no focus trap. A true modal keeps keyboard focus inside, even
when its actions are disabled, and uses the heavy frost.

**Busy and finished buttons.** Outside a modal dialog, a button that is busy,
or has nothing left to do, stays focusable with `aria-disabled` rather than
`disabled`, which drops keyboard focus to the page. A dialog that disables its
controls while saving puts focus back on the control last used, or ✕, when the
save settles. When a button gives way to a result, or its item leaves a list,
focus moves to the result or the item in its place; focus the user moved
elsewhere stays put. A held Enter presses a button, or sends a form, once
([`installHeldEnterGuard.ts`](../src/renderer/src/installHeldEnterGuard.ts)).

Sources: [`main.css`](../src/renderer/src/assets/main.css),
[`FriendDrawer.tsx`](../src/renderer/src/components/FriendDrawer.tsx),
[`ExploreWorldSheet.tsx`](../src/renderer/src/components/ExploreWorldSheet.tsx),
[`JoinConfirmDialog.tsx`](../src/renderer/src/components/JoinConfirmDialog.tsx),
[`instancePill.ts`](../src/renderer/src/utils/instancePill.ts).

## §4 Canvas, glow and background picture

The document body draws the canvas with two fixed pseudo-elements:
`body::before` (z-index -2) is the aurora, two large radial glows (VRChat blue
centered near the top-left at 12% 6%, ChilloutVR orange near the bottom-right
at 92% 96%) plus two optional smaller wisps, over `--aurora-gradient` (flat
`--bg-base` in dark, a soft vertical gradient in light). `body::after` (z-index
-1) is the scanline texture: a 1 px line every 3 px in `--scanline-color`,
blended (`overlay` in dark, `multiply` in light) at low opacity. It is a faint
texture, never a visible grid.

**Glow levels.** [`applyGlow`](../src/renderer/src/hooks/useApplyGlow.ts) sets
Settings → Appearance → Background glow: Off, Muted, Standard and Vivid.
Standard, the default, sets no `data-glow` attribute; the others set
`data-glow` on `<html>` and override the size, fade and alpha variables
(Appendix A). Off keeps the plain base canvas. In light mode Standard is
deliberately stronger than Muted, so the brand corners read as clearly as in
dark. Background glow and a pane's tint are separate: changing the glow never
changes the colors of informational surfaces. Reduced motion keeps the same
static composition (the canvas never animates).

**Background picture.** The user may put their own picture behind the app
(Settings → Appearance → Background picture).
[`AppBackdrop`](../src/renderer/src/components/AppBackdrop.tsx) draws it as a
fixed, decorative `.app-backdrop` layer at z-index -3, and
`data-app-background` on `<html>` drops the aurora's opaque floor so any glow
the user keeps sits over the picture. A fade layer in the theme's base color
(Low, Medium, High; Medium by default) keeps words over the picture readable;
light uses a lighter fade so a picture never turns milky white. The layered
glass above shows the picture blurred, and opaque information surfaces keep
their own backing, so a picture never changes their colors or meaning.

**Words on the canvas.** Text set straight on the canvas (`.canvas-text`: page
titles, the top-bar counts, Dashboard section headings) and the small buttons
beside it (`.canvas-control`) get, over a light-theme picture only, a small
crisp card-color backing with near-solid ink, so a dark picture can't swallow
them. Words never get a glow or halo: on a light theme it reads as fuzzy text.

Main refuses a picture that can't fill the landscape window (smaller than
640×360, taller than 0.6 of its width, or wider than 5:1;
[`backgroundPicture.ts`](../src/shared/backgroundPicture.ts)) and Settings
gives one short warning line for a usable picture that will crop hard or look
soft.

## §5 Presence, status, and privacy

Presence state and VRChat status are separate inputs. State is
`in-game | active | offline`; VRChat status is
`join-me | online | ask-me | dnd`. VRChat's upstream status string `active`
becomes Online; it is not the presence state `active`, which means online
outside the game. ChilloutVR has no status, custom status, or trust rank; never
fabricate them.

[`ringFor`](../src/renderer/src/utils/statusRing.ts) decides the avatar ring:

- Active and offline friends use their presence color (`--active`,
  `--offline`).
- In-game VRChat friends use their status color (`--st-*`).
- In-game friends without a status, including every ChilloutVR friend, use
  Online (`--st-online`).
- Row avatars have a plain corner dot and an accessible label naming the
  state. Drawer avatars have no dot; the drawer shows the written status in a
  status band (a chip in the status color with the status word).

This is the color-only exception in Locked rule 4. Don't add a row status pill,
and don't read raw presence from ring color alone. Platform identity stays
readable as text (the VRC or CVR rail or platform pill) as well as tint, and a
linked person's rail says VRX.

**Privacy.** Ask Me and Do Not Disturb hide the world and instance. Active and
offline friends never show a stale cached instance. Rows, the drawer, Hot
Instances, Activity, notifications, and actions all use the shared
hidden-location and membership checks in
[`hotInstanceKey.ts`](../src/shared/hotInstanceKey.ts) and
[`joinability.ts`](../src/shared/joinability.ts). Never put a hidden
identifier in gesture metadata, an accessible name, or an image. An invite is
the one place a world name can appear for any sender: the sender chose to
share it by inviting, so the Inbox shows the world the invite names, never a
location read from presence (§9.6).

**Joining** is a separate decision, made by
[`isFriendJoinable`](../src/shared/joinability.ts) and the existing Join flow.
There is no Ask-to-join action. "Always ask" in Settings → Behavior → Join in
chooses a ChilloutVR launch mode; it doesn't request an invitation. When the
game is already open, Join uses it instead of starting a second copy, the same
way on both platforms: the join dialog shows one quiet note in place of the
mode picker or launch note ("VRChat is open, so Join takes you there in the
game.", "ChilloutVR is open, …"), and afterwards the status line under Join
says "Sent to your open game" or, for a VRChat invite, "Invite sent. Accept it
in VRChat." for 8 seconds. While VRX checks whether the game is open, that line
keeps its place but stays blank, so the dialog never shows the picker and then
swaps it for the note; when the picker would show, Join waits for it.

**Trust.** Names stay neutral. When VRChat provides a trust rank, it appears as
quiet 12 px plain text below Notes in the drawer; a combined linked profile can
use its VRChat member's rank. There is no row trust pill, trust toggle, or
ChilloutVR equivalent.

## §6 Instance labels and policy

### §6.1 Access labels

`InstanceInfo.type` stays platform-true: eight VRChat types and nine
ChilloutVR types, including the ChilloutVR Offline Instance. Every access pill
goes through [`instancePillFor`](../src/renderer/src/utils/instancePill.ts) and
renders [`InstancePill`](../src/renderer/src/components/InstancePill.tsx), one
component for the friends list, the Dashboard, friend details and the join
dialog, so the pill looks identical everywhere.

Settings → Appearance → Instance labels picks the wording: VRChat (the default
on both platforms), Per platform, or ChilloutVR, in that order. The label maps
live in [`instanceTypeLabels.ts`](../src/renderer/src/utils/instanceTypeLabels.ts);
never copy a map into a component or derive a label from a color.

Pills are words with no icon, on the shared geometry (`PILL_BASE`: a 28 px
glass chip, 10 px radius, 12 px semibold, 12 px side padding). The tier color
fills the pill at `--pill-tint` and edges it at `--pill-edge`, and the word uses
the tier's `-text` companion. Friend-family tiers run green to orange (Public,
Friends+, Friends, Invite+, Invite) and group-family tiers use purple (Group
Public, Group+, Group). Group labels stay in full. `opennessUnknown: true`
shows a neutral Unknown under every scheme; hidden in-game locations can show a
neutral Private; the Offline Instance is neutral under every scheme. These
neutral states share one look (a `--text` wash) but keep their own words. No
pill appears for an active or offline friend's old location. The pill's
discreet Join shortcut is an approved design, not a defect.

### §6.2 Policy space

Policy space is separate from access. Use
[`policySpaceFor`](../src/renderer/src/utils/instancePolicySpace.ts) and
[`PolicySpacePill`](../src/renderer/src/components/PolicySpacePill.tsx): Public
space is rose (`--policy-public`), Private space is ice (`--policy-private`),
and Unknown is neutral. Never infer access, membership, or join permission from
this moderation label. Keep its platform-specific explanation in the
translation files.

The guide shows the model's values; it doesn't prove every ChilloutVR wire
form. Read [API volatility](api-volatility.md) before changing a mapping, and
never invent a raw value for the Offline Instance.

## §7 Typography

Two faces, both shipped as local WOFF2 files with their licenses and
`SOURCES.json` (never load a remote font, never add another display face):

- **Inter** (`--font-sans`, variable 400–800) for names, headings, labels,
  controls, body text, status, and help.
- **VT323** (`--font-mono`, Tailwind `font-mono`) only for the VRX wordmark,
  section kickers, prominent statistics, and the version line. Technical
  identifiers use a readable monospace (`ui-monospace`), never VT323.

| Role                          | Face  | Size         | Weight  | Color                                | Notes                                       |
| ----------------------------- | ----- | ------------ | ------- | ------------------------------------ | ------------------------------------------- |
| Wordmark (sidebar)            | VT323 | 40 px        | 400     | brand letters                        | 2 px tracking; 64 px on the welcome screen  |
| Page title (`h1`, top bar)    | Inter | 25 px        | 800     | `--text`                             | `.canvas-text`; one per page                |
| Statistic number              | VT323 | 38 px        | 400     | `--text`                             | tabular figures; label 12.5 px `--text-dim` |
| Dashboard section heading     | VT323 | 18 px        | 400     | `--text-dim`                         | uppercase, 2 px tracking, `h2`              |
| Popular now heading           | VT323 | 20 px        | 400     | `--text-dim`                         | 0.08em tracking, not uppercase, `h2`        |
| Card title, world name        | Inter | 18 px        | 700     | `--text`                             | bar cards use 25 px                         |
| Navigation item               | Inter | 13.5 px      | 600     | `--text-dim` → `--text` when current |                                             |
| Body text, rows, buttons      | Inter | 13 px        | 400–600 | `--text`                             | `text-sm` for quiet buttons                 |
| Labels, help, secondary       | Inter | 12–12.5 px   | 400–500 | `--text-dim`                         | segmented options are 12.5 px 600           |
| Pills                         | Inter | 12 px        | 600     | tier `-text`                         | `PILL_BASE`                                 |
| Meta, timestamps, small notes | Inter | 10.5–11.5 px | 500–600 | `--text-dim`                         | rails and badges 10–10.5 px                 |

Dashboard section headings use `--text-dim` at weight 400 in both themes
(owner, 2026-11-04: faint fell below 4.5:1 at their size), and all four stay
semantic `h2` elements. Numbers use the reader's locale grouping
(`Intl.NumberFormat`): "1,234 friends".

Never use negative letter spacing or scale type with the viewport. Japanese
text wraps at phrase boundaries, never mid-word: `main.css` sets
`word-break: auto-phrase` on `body:lang(ja)` only. Don't add per-component
copies. A long name or custom status wraps to two lines before it is cut, and
its tooltip shows it in full.

## §8 Shell, layout and controls

**Shell.** [`AppShell`](../src/renderer/src/components/AppShell.tsx) places the
fixed [`Sidebar`](../src/renderer/src/components/Sidebar.tsx) (a translucent
`.glass` column, 248 px wide, padding 20 px 16 px, 16 px from the window
edges) beside the main column, which owns all scrolling; the body never
scrolls. [`TopBar`](../src/renderer/src/components/TopBar.tsx) heads the main
column. The default and minimum page size is 900×670, measured inside the
window frame; on a smaller screen the minimum shrinks so the app stays usable.
Every workflow must fit and stay reachable at that size. Don't design a mobile
layout from a narrow documentation viewport.

**Navigation**, in order: Dashboard, Friends, Hot Instances, Activity, Inbox,
Explore, Search, Groups, Avatars, Settings. Each item is a 13.5 px semibold
label with an icon, 12 px radius. The current page has a raised selected
surface (`--control-active-*`) and a 3 px spine at the sidebar's left edge in
the platform filter's color (blue, orange, or the blue-to-orange blend for
All); position carries "current page" and the color only echoes the filter.
Hot Instances, Activity, Inbox, Explore, Search and Groups can be hidden in
Settings → Appearance → Sidebar pages and in the welcome setup; a hidden page
leaves the sidebar and its links, while its Dashboard section and alerts keep
their own switches. A hidden page that is open falls back to the Dashboard; a
hot-instance alert click still opens Hot Instances while that page is hidden,
until the user goes elsewhere. The Inbox item shows a neutral count chip of new
rows (the number is the cue, never a color).

**Top bar.** It holds the page's single heading; panels below it keep their
section headings for screen readers only. Its platform filter is a segmented
control reading VRC / ALL / CVR, each platform word in its own lifted brand
color (`--plat-*-word`), and filters the current social view; the sidebar's
spine echoes it. The filter stays in the same horizontal position on every
page that shows it, even when a scrollbar appears; nothing else may take its
place. Settings replaces the filter with its category control, on its own row
under the title, so the counts stay on the title row as on every other page.

**Connection indicator.** It pairs color with shape: a dot is live, a hollow
ring is reconnecting, a square is down, and its label names each platform. The
live dot pulses only while VRX has focus (an endless animation would keep the
window redrawing behind a game), and stays steady on Linux, where some
desktops drew the pulse's redraw a pixel off.

**Top bar counts** (owner, 2026-11-01) sit right of the filter as one
right-aligned block: "13 friends" with the connection indicator, and under it
how many people play each shown platform ("VRC 48,213 CVR 1,876", each number
beside its platform word). Both follow the platform filter; a platform with no
answer drops out. Hovering or focusing the block opens a small opaque glass
panel that spells out friends online, each platform's connection, the full
platform names and where the numbers come from; Escape or leaving closes it.
Settings → Dashboard → Player counts turns the player numbers off.

**Scrollbars.** Every scroll area uses one slim 9 px rounded bar in
`--scrollbar-thumb` on a clear track, set once in `main.css`.

**High Contrast.** Windows High Contrast removes shadows and the app's own
colors, so `main.css` redraws, in forced colors only and in system colors, what
VRX draws with them: the keyboard focus ring becomes a `Highlight` outline; the
chosen side of a segmented control, the current page and the chosen status in
Edit profile use `Highlight` with `HighlightText`; the welcome setup's chosen
theme, choice dots and progress bars use `Highlight`. The presence ring and
the status dot keep their own colors there, as Locked rule 4 needs.

**Segmented controls.** Use
[`SegmentedControl`](../src/renderer/src/components/SegmentedControl.tsx) and
[`useSegmentedBubble`](../src/renderer/src/hooks/useSegmentedBubble.ts): a
`.glass` track (4 px padding, 2 px gap) with an inset bubble
(`--seg-bubble-bg`, 16 px radius) that measures the active label, because
labels have unequal widths. Options are 12.5 px semibold, dim until chosen. It
is a `radiogroup` with one tab stop, arrow-key movement, and visible focus. A
combined or neutral option sits between the two platform options. On/off
settings use [`Toggle`](../src/renderer/src/components/Toggle.tsx): the same
control with visible On and Off labels. The bubble slides only under
`motion-safe:`.

**Buttons.** Most buttons are quiet: `rounded-control` with a
`--control-fill` background that steps to `--control-fill-hover`, `--text`
words at 12–13 px, and a 1 px `--text-dim` focus ring. Quieter still (Hide,
Decline, See all) is text in `--text-dim` with a `--surface-hover` wash on
hover. A row or card has at most one filled action. A friend action (Accept,
Add friend) is the stronger fill (`--control-fill-hover` with the
`--control-active-border` edge, semibold; `FRIEND_ACTION_BUTTON`). A
platform's Connect button is filled with its brand color (`--text-on-vrc`
white on blue, `--text-on-cvr` dark ink on orange). The welcome setup's main
button is a solid `--text` fill with `--bg-base` words, so neither platform
leads. Destructive actions (Unfriend, Block) wear the error tint with their
word as the cue. Icon-only buttons have an accessible name and a tooltip.

**Settings** has six categories, each its own page with no scrolling at the
default window size: Appearance, Dashboard, Behavior, Notifications, Accounts,
and About. The page sits on a `.glass-panel`; each setting is a compact
`.setting-card` (12 px radius, 8 px by 12 px padding, layered glass) with its
label and help on the left and its control on the right.

- Appearance: Theme, Background glow, Background picture (Choose picture;
  once set, a thumbnail, Change picture, Remove, and Picture fade in the same
  card), and Instance labels. Last, one Sidebar pages card with every optional
  page switch in sidebar order (Hot Instances, Activity, Inbox, Explore,
  Search, Groups; all on by default). Hiding a page keeps its alerts and
  Dashboard section; Activity off also stops VRX keeping activity and forgets
  what it kept.
- Dashboard: Hide empty sections, then the Sections card (each section's
  switch with move up and move down buttons), Popular now, Hot Instances, Hot
  instance threshold, and Player counts.
- Behavior: Friend details open from (whole card or avatar only), Save notes
  to my accounts and Use my game favorites (one card), Friends background
  re-sync, and Allow joining friends, which contains Confirm before joining,
  Join in, and When the game is already open (Go there, Send invite, or Off;
  Send invite changes only VRChat, since ChilloutVR has one way). Off keeps
  the saved VRChat choice for when it is turned back on. Turning a parent off
  collapses its card with a 220 ms height transition (instant under reduced
  motion). Hidden children are inert and hidden from assistive technology,
  focus returns to the parent control when needed, and their saved choices
  survive.
- Notifications: one alerts card. Who alerts you (Everyone or Picked friends;
  with Picked friends its explanation becomes each platform's pick count and a
  Show link, which lists picks VRChat first with a Remove for each), then
  Friend comes online, Friend joins a world and Friend goes offline, then,
  below a divider, the alerts picks never limit: Hot instance, Invite received
  (invites and invite requests) and Friend request received. Each alert is
  independent and off by default. Below it, Alerts in VR (off by default)
  shows the alerts switched on above in the headset through XSOverlay, with
  the same words for both platforms. On opens Time on screen (Short, Medium or
  Long) with a Send a test link; for a few seconds after a test, the
  explanation becomes a short sent or failed line beside the link.
- Accounts: the VRChat and ChilloutVR account cards side by side at equal
  height, then the one-line unofficial-app notice. A signed-in card has Edit
  profile and Sign out sharing one row (each its own full-width line when the
  words are long, as in Japanese). Sign out asks once, in place of its row
  ("Sign out of VRChat?", with Sign out and Cancel, focus starting on Cancel),
  since signing back in needs the password again. Edit profile opens a dialog
  with bio and pronouns on both platforms in the same order, then, on VRChat
  only, the four statuses (the friends-list dot beside each word) and the
  status text. Each label carries its character count; Save stays off until
  something changes, a failure keeps the text with a reason, and a stray press
  outside or Escape never throws typed text away.
- About: Automatic updates, with Stable, Beta and Dev in the same card beside
  the on/off control and the check button, plus the installed version, Welcome
  setup (Run setup again), Found a bug? (Report a bug opens GitHub's bug report
  form in the browser), Open logs folder, and Legal (closed by default). The
  portable build can't update itself, so its channel and on/off control stay
  inactive under that note.

**Notices.** Saving is reported once, in the shell (or the welcome setup,
which replaces it), failures first. Shell notices are compact one-row
`.glass-layer` strips with the action beside the text; a failure leads with a
warning glyph as its non-color cue. A normal save is silent; a notice appears
only if the latest change is still unsaved about two seconds later. A failed
save shows an alert at once, keeps the latest edits, offers Retry, and stays
until a save succeeds. Settings VRX couldn't read show the defaults under an
alert that says so. If the first sign-in check fails, VRX shows a
platform-specific recovery message with Retry, never a signed-out form. A
saved VRChat session that needs a fresh sign-in code shows a one-line notice
with Go to Accounts, and the connection label says Needs code. When a
platform signs the user out by itself, an alert names it with Go to Accounts
and Hide, the status dot counts that platform as down, and the sign-in screen
names it; a sign-out the user chose shows none of this. A panel failure
stays inside its tab.

**Dashboard switches.** Popular now off hides only its Dashboard section;
Explore stays. Hot Instances off removes its Dashboard statistic, heading,
threshold, cards, and details, and the remaining statistics fill two equal
columns; it never hides the Hot Instances page or the Hot instance alert.
Wearing now and Latest invites off hide only their glance section. A move
button at the top or bottom stays focusable but does nothing, and each move is
announced to screen readers. A compact "Settings" button below the Dashboard
content opens Settings → Dashboard, even when every section is off.

**Hide empty sections** (owner, 2026-10-27; on by default) makes the Dashboard
fit what it has: Latest invites with nothing waiting, a platform that reported
no worn avatar, and Hot Instances with nothing hot step aside (Popular now
already does). The Hot instances statistic stays, so "0" still explains the
missing section. A lone glance section takes the whole row and puts its two
platform rows side by side. Off shows each section's empty state, and card
style follows the section order only.

**Updater.** The update control is a 36 px round button in the sidebar
footer, right of the version line. When there is nothing to do it is absent;
available, downloading, and downloaded each have their own icon, action and
label. Hover or focus widens it to reveal the label without clipping the icon.
Its label adds "try again" only after a download or install failed. While the
button shows, the footer text stays clear of it, and a long pre-release
version moves to its own line.

## §9 Component behavior

### §9.1 Friends, Dashboard, and Hot Instances

**Friends list.** The list sits on a `.glass-panel` with virtual rows and
sticky, collapsible In-Game, Online, and Offline sections (each header a
`.glass-layer` strip with its count); Offline starts collapsed. Above them, a
Favorites section (owner, 2026-11-02) lists the starred friends who are in
game and shows only while it has someone in it. Those friends also stay under
In-Game, so a favorite in game shows twice; online and offline favorites stay
only in their own section. A friend in one of the account's own favorite
groups counts as starred too. Every starred row carries a small filled star
after the name in `--favorite` yellow (yellow, not amber, so it reads apart
from ChilloutVR orange), and the row's accessible name says favorite. A pinned
section header sits at the scroll area's top edge, with no strip of rows above
it.

An Order control (owner, 2026-11-02), the same segmented control as the
platform picker, sits on the left above Search friends, on the Refresh line.
It orders the rows inside each section, the same way on both platforms: Name
(A to Z, the default), Recent (the newest Activity first; hidden while the
Activity page is off), World (friends in the same instance together, the
biggest crowd first) or Joinable (the most open instance you can join first).
Every choice keeps the sections and falls back to the name. Search shows
matches without changing saved collapse settings; when nothing matches, only
the no-results line shows. Roving focus moves between avatars, and off-screen
rows stay out of the Tab order. Compact rows are at least 60 px and are
re-measured as join feedback appears or clears.

A friend row is a `.platform-row` with, from left: the platform rail (a
vertical VRC / CVR / VRX chip), the avatar with its ring and dot, the name
(with the favorite star and the custom status, dim, beside it), the world line,
and the instance pill with its Join shortcut on the right. The avatar opens
friend details. By default the whole card opens them too, except the Join
control and text selection; the "Avatar only" choice in Settings → Behavior →
Friend details open from keeps the row body inert. The pill's spoken name
starts with the access words it shows ("Public: Join Amy in SunDown"), so
speech users can say what they see. Add friend's spoken name holds its visible
words too: first in English ("Add friend: Amy on VRChat"), last in Japanese.

Join failures wrap below the row's controls, stay until another attempt or an
account change, and say what to do next. Retry uses the same Join control with
its confirmation, busy state, and main-process checks. Joins never retry
automatically.

**Dashboard statistics** are one set (owner, 2026-11-01): each card is a
`.glass-layer` with the same layout, a VT323 number in `--text` and its label
in `--text-dim`, with no icons. Numbers take no presence color: Friends online
counts active and in-game friends together, and the label names each number.
Statistics count accounts. Hot instances group by the exact platform instance,
never just the world, and need at least the threshold number of visible
in-game friends (2 by default, 1 to 10). The threshold stepper sits beside a
quiet "?" button that toggles an explanation of grouping, visible friends, the
platform filter, ranking, and the threshold; it starts closed and exposes its
state to assistive technology.

**Glance row.** Wearing now and Latest invites share a row while they are
neighbors in the section order; apart, each gets its own full-width row. They
sit side by side when the area is at least 520 px wide, one above the other
below that; a lone section fills the row with its two platform rows side by
side. Each is a heading with a quiet button (Avatars, or See all N for the
Inbox, "See 1" for one) over a list of equal-height `.platform-row` rows: a
picture, the name, and the platform as a word (`PlatformPill`), so VRChat and
ChilloutVR read alike. Wearing now has one row per signed-in platform in the
filter: the 4:3 avatar picture and name, or a one-line loading, not-reported,
or failed state with Try again (Go to Accounts when the platform asks to sign
in again). A row opens the Avatars page. Latest invites shows the newest
invite or invite request per platform, VRChat's first, in the Inbox row's
words and age; a row opens the Inbox, and with the Inbox page hidden the rows
are plain text.

**Popular now and Hot Instances cards.** Each Dashboard section shows two
cards, chosen as in Locked rule 7. Picture cards (`ExploreWorldCard`,
`HotInstanceCard`) are `.glass-layer` cards with the world picture on top, a
VRC or CVR chip on the picture, and the details below. Bar cards put the world
picture behind a same-color scrim with the platform tint on top, so the
platform color still reads at a glance; pills over a picture get the
card-color backing. Card grids follow the card style, not the section order:
picture cards sit two across when the area is at least 440 px wide, bars two
across from 620 px. On wide windows picture grids (Explore, Popular now, world
results, Hot Instances) add a column each time a column would pass about
730 px: three from 1,480 px, four from 2,200 px, up to eight, so an ultrawide
shows more cards instead of blurry ones. To avoid half-empty rows, Explore's
Popular now rounds "Worlds shown" up to whole rows, and a Dashboard section
with picture cards shows one full row. The rule lives in `main.css`
(`.picture-grid`, `.hot-grid--picture`), mirrored for counts by
[`pictureColumns.ts`](../src/renderer/src/utils/pictureColumns.ts).

The Hot Instances section adds a quiet "See all N" button, shown only while
the page is, that opens the Hot Instances page: every hot instance as a
picture card, most friends first, with the same header, empty state, and
sheet. The access pill on a hot card is a discreet Join shortcut; don't turn
it into a prominent Join button. The world name is the card's button for the
keyboard and screen readers, beside the Join pill and never around it; a
click elsewhere on the card, except Join and text selection, opens the sheet.

### §9.2 Friend details

The friend details drawer is a non-modal `.glass .glass-sheet` panel pinned to
the right edge (14 px inset, 372 px wide) over a soft scrim that doesn't block
input. It slides in under `motion-safe:`. Escape, a click outside, and Close
all dismiss it the same way, and opening another friend switches the profile.
Focus returns to the opener or the search box. Closed content is inert and
hidden from assistive technology. While a confirmation modal is open, the
drawer pauses its own dismissal.

The order is: header (avatar without dot, name, platform badge chip), the
written status band, Where, actions, Notes, Trust, then Show full profile
(collapsed). A footer pinned below the scrolling area holds Identities on the
left and, on the right, the favorite star and the alerts bell.

- **Favorite star.** An outline when off and a filled `--favorite` star when
  on, so its state never rests on color. It is filled while the friend is
  starred in VRX or sits in one of the account's own favorite groups. Pressing
  it springs the favorite panel out of it: a VRX row (a linked person is one
  VRX star across both accounts, kept on this PC), then one section per
  account with its game favorite groups as check rows (a ticked box, the group
  name, and the count, with VRChat's cap). VRChat keeps a favorite in one
  group, so the other groups wait until it leaves and a short line says why;
  ChilloutVR allows several. The panel says when game favorites are off, still
  loading, could not load (with Try again), or have no groups yet. It never
  creates a group.
- **Alerts bell.** It shows whether this friend can alert you by shape, not
  color: sound waves when on, a slash when off, and the button's name says On
  or Off. Pressing it springs a small opaque panel out of the bell (scale and
  fade with a slight overshoot, rows following one after another, and the bell
  swings); reduced motion shows and hides it without movement. The panel holds
  Alert me about this friend while alerts are limited to picked friends
  (otherwise one line says every friend can alert you), the three friend alert
  kinds with a check or dash beside each, and Alert settings. Escape or a
  press outside folds the panel before the drawer itself closes.
- **Where** cards keep privacy rules, show neutral art when a picture is
  missing, use instance labels, and never show raw IDs or policy pills; a
  split card names each platform.
- **Notes.** If notes load without a valid account revision, they stay
  read-only with Retry. A failed save keeps the draft and a warning; a
  successful save is quiet. A presence change never retargets a draft. With
  Save notes to my accounts on, a line under the note says whether the
  account's own copy matches, with Keep mine, Use the VRChat note, or Save to
  VRChat; those buttons move focus to that line when pressed.

### §9.3 Confirmation and sheets

**Join confirmation** is a true heavy-frosted modal (`.glass
.glass-frosted-heavy .glass-information`, 400 px wide). It keeps focus inside,
offers Cancel, respects permission denials, reviews the live target, and
handles session changes and in-flight states. The main process has the final
say, and confirmation preferences never bypass permission or target checks. A
Join from a hot card or its sheet is for the instance: if the friend it went
through leaves, the dialog joins through another friend still there, and shows
the move or "no longer available" only once nobody is left. A press outside
closes only the confirmation and returns focus to its opener.

**Sheets.** Explore world, Hot Instance, Avatar, person and group sheets are
contained, non-modal `.glass .glass-sheet` bottom sheets that share one
layout: grab bar, then the picture starting below Close.
Close stays reachable outside the scrolling area. In the light theme a sheet
banner keeps the photo at full brightness and lays a soft card-colored scrim
(`--hot-sheet-banner-scrim`) under the title instead of darkening it. Escape,
a click outside, and Close return focus to the opener or a stable fallback.
Picking another world while an Explore sheet is open switches it in place.
Every sheet opens at its top, also for the one shown last. A confirmation
modal owns dismissal while open, and the Dashboard never shows two sheet
types at once.

Every bottom sheet opens collapsed, and its grab bar is a real control
([`SheetGrabBar`](../src/renderer/src/components/SheetGrabBar.tsx)): drag up
to expand to nearly the window height, drag down to collapse, and pull a
collapsed sheet down to close it. A press on the bar, Enter or Space toggles;
Arrow Up and Arrow Down expand and collapse. Expanding grows the banner and
adds the sheet's "more" details
([`SheetFacts`](../src/renderer/src/components/SheetFacts.tsx)) from data
already on hand, never a new platform request. Both platforms show the same
extra fields in the same order. Each reopen starts collapsed.

### §9.4 Explore, loading states and sign-in

Explore and the Dashboard's Popular now use the same world card. Equivalent
content from both platforms gets equal treatment. Occupancy is "People".
Don't repeat the top-bar heading.

**Loading.** Dashboard and Explore show one "Worlds loading…" line while any
selected platform is loading for the first time with nothing to show yet, even
beside cards from the other platform; those cards stay visible. A normal
refresh with cards already shown is silent. Real errors, unavailable sources,
stale results, and verified empty states stay visible. Unknown or partial
counts stay unknown, never zero. Nothing here may add polling. Under All, a
platform the user isn't signed in to adds no line; filtered to that platform,
the page shows the Connect gate with Go to Accounts.

**Failures** follow Locked rule 5. A failed Refresh or re-read never clears a
list that loaded: the platform keeps its cards and adds a dim line naming it
(after a rate limit it also says to try again in a minute); the error color is
for a platform with nothing loaded. Try again on a red line shows that
platform's loading line until it answers. When one platform's roster fails,
Friends keeps the usable list and shows a line naming that platform, with a
Retry for that platform only; the Dashboard and Hot Instances show the same
line. Right after a sign-in or account switch they say Loading until the real
roster arrives, never 0 friends.

**Sign-in from this PC.** Under each sign-in form (login screen, Accounts,
welcome setup) a quieter outlined button, "Use my sign-in from VRCX" for
VRChat and "Use my sign-in from ChilloutVR" for ChilloutVR, sits below the
platform-filled Connect button, so the password sign-in stays the main way in.
Both platforms get the same button in the same place at the same size, with a
one-line hint that the source app is only read. VRX looks only when the button
is pressed. Not found and no-longer-accepted results name where VRX looked and
point back to the password form.

**Sign-in text** explains OS-backed encryption and the weaker local-key
fallback behind Show more, and never promises keychain protection everywhere.
The sign-in screen and Accounts show the one-line unofficial-app notice in
plain dim text; Settings → About → Legal holds the full text (see
[API policy](api-policy.md)). Guide fixtures accept only made-up input and
never sign in or save it.

**Welcome setup.** A brand-new install opens one centered card before the
app. It is layered glass like Settings: the card is a frosted back panel
(`.glass .glass-panel`), and its cards, theme choices and sign-in fields
are `.glass-layer` panes on it. It holds a welcome screen, five labeled steps
(Sign in, Pages, Dashboard, Alerts, Look), then a summary. Type and shape
follow the rest of the app: each step title is set like a page title (25 px
extra bold), the step count is a VT323 section kicker, and the theme choices
round at the control radius. Step state reads from position,
weight and a check, not color. Sign-in shows the two account cards side by
side at equal height, and the line under its title doubles as the live
sign-in status; one ready account is enough to continue. Every other step
changes the real settings as the user picks and keeps the defaults until
changed. Look also offers the background picture and the instance label
style. Skip setup is a visible button on every screen before the summary,
never a small link; skipping before any account is ready shows sign-in only,
then opens the app. The main button is a neutral `--text` fill, so neither
platform color leads. Each screen keeps to a short line or two (Locked rule
11). Settings → About offers Run setup again.

### §9.5 Activity

The Activity page lists friends coming online, joining a world, and going
offline, newest first. Main records it from the live sockets with the same
transition rules as the alerts but without their rate limit, keeps it in
memory only (up to 300 entries per platform), and forgets a platform's entries
at an account change or sign-out. Reading it makes no platform request.

Both platforms share one row: a `.platform-row` capsule with a small avatar,
the name, what happened in words, the platform pill filling a fixed-width
column (both pills the same size, the word centered), and the time (with the
date once it is not today). Coming online straight into a world is one entry
that names the world; a ChilloutVR world name that resolves a moment later
fills in, and its `(#…)` instance tag is trimmed in the row (the hover keeps
it, by owner decision). Ask Me and Do Not Disturb friends never show a world,
and their moves are not recorded. The top-bar filter scopes the list; the
page's Show control (All, Online, Worlds, Offline) is a saved setting. Clear
empties the list as shown; what the filters hide stays, and Clear is off while
nothing shows. A row opens that friend's details on the Friends page; a friend
no longer on the list is plain text.

### §9.6 Inbox

The Inbox page lists invites, invite requests and friend requests that the
two platform sockets deliver while VRX is open. Nothing is stored, so the
list starts empty each launch.

- Two sections, Invites (invites and invite requests) and Friend requests,
  each newest first, both platforms mixed in one list with equal weight.
- A row is a `.platform-row`: the sender's picture when they are a friend (no
  presence ring) or their initial, the name, a platform pill, the action
  ("Invited you to Pug Lounge", "Asked you for an invite", "Sent you a friend
  request"), a relative age ("Just now" under a minute) and a Hide button.
- A friend request row adds Accept (the row's one filled button) and Decline
  (quiet, like Hide), the same on both platforms (owner, 2026-11-01). While an
  answer is on its way that button says "Accepting…" or "Declining…" and the
  row's buttons wait. A line above the list says what happened or, in the
  error color with words, why it did not; a failed answer keeps the row.
  Invites stay view-only, and the "?" help says to answer those in the game.
- Hide removes a row inside VRX only; Hide all hides every row in the current
  platform filter.
- The sidebar shows a neutral count chip of rows newer than the last ones
  shown; opening the page clears it.
- Invite and friend-request alerts are separate switches, both off by
  default, and limited to a few a minute.

### §9.7 Search, profiles, Groups, Avatars and world lists

Community views (owner, 2026-10-31) only read, except the profile's friend
action and Unfriend or block. Every one follows the platform filter, offers Go
to Accounts when the filtered platform is not connected, and adds no line
under ALL for a platform the user isn't signed in to. A list says it is empty
only once every shown platform has answered; next to a platform that failed
with nothing loaded, its red line stands alone.

- **Search** sends only on Enter or the Search button, never while typing.
  People and Worlds are two sections; each alternates the platforms' results
  (first of each, then second of each) so neither platform leads. People are
  square picture tiles with the platform tint and VRC/CVR chip, and a
  quiet "Friend" line; with no picture the tile shows the name's first letter.
  While a tile's picture is on its way (owner, 2026-11-04) its box breathes
  softly (`.picture-waiting`) with no letter, so a first letter always means
  "no picture"; a picture that arrives after the page is up fades in
  (`.picture-arrive`), one already loaded this session shows at once, and a
  picture that fails falls back to the letter. Reduced motion shows the same
  states without the pulse or fade. The guide's dashboard `pictures-loading`
  variant holds every picture in the waiting state.
  Worlds use the Explore world card and sheet with Join.
- **Full profile** opens in the bottom sheet (Search) or behind "Show full
  profile" in friend details. Fields come in one order on both platforms:
  Pronouns, Rank, Bio, Badges, then Show worlds and Show groups, which read
  only when pressed. A missing field says "Not shown".
- **Friend action** (owner, 2026-11-01): a profile of someone who is not a
  friend yet starts with one row, the same on both platforms: Accept and
  Decline if their request waits in the Inbox, otherwise one filled Add friend
  button that becomes "Sending…", then a check mark and "Friend request sent."
- **Unfriend or block** closes every full profile, below a thin rule: one
  quiet button that reads nothing until pressed. Open, it shows only what
  applies, in one order on both platforms: Unfriend (friends only), then Block
  or Unblock. Unfriend and Block wear the error tint with their word as the
  cue; Unblock is plain. Each opens a heavy-frosted `alertdialog` with the
  platform pill that names the person, says what changes, and
  focuses Cancel. A success leaves a "✓ Unblocked on VRChat."-style line.
- **Groups** is one name-sorted grid of `.glass-layer` cards wider than tall
  (owner, 2026-11-04): the group's wide banner across the top with its square
  icon (never cropped) in the bottom-left corner, then the name and the VRC or
  CVR chip with the group code, led by "Owner ·" on a group you own. Icons
  load first (with the same waiting look as Search tiles) and banners fade in
  after; a group without a banner keeps the same layout over a blurred copy of
  its icon, and no picture at all shows the name's first letter on the
  platform color. A group opens the bottom sheet.
  View only.
- **Avatars** lists the avatars uploaded on each platform and the one worn
  now, as picture cards with a VRC or CVR chip; the sheet has Wear this
  avatar.
- **Explore** has a segmented Popular now · New · Recently updated ·
  Favorites control. The lists alternate platforms like Search and open the
  same world sheet. Favorites lists the worlds starred in VRX, newest first,
  then the account's own favorite worlds. The world sheet's star opens the
  same favorite panel as a friend's. Refresh reads "Refreshing…" and stays off
  until its reads answer.
- **Set as home world** sits beside the platform pill on every world sheet,
  the same small house-and-label button on both platforms. A press asks once
  in an inline panel (Make home, Cancel). A success turns the button into a
  quiet "Your home world" chip for the session; a failure is one line of text.

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
A linked row's rail reads VRX on a blue-to-orange chip and the row is a
`.platform-row--vrx`. Two locations use a hard, centered 45-degree split,
VRChat upper-right and ChilloutVR lower-left. In the row, two joinable
locations share one "2 locations" pill whose halves carry each access tier by
color, so the world line names each tier in words after its platform tag.
Search finds a person by any of their names; when the row's own name has no
match, the name that matched takes the custom status's place beside it, dim,
with the match marked.

Combined Join always opens the destination chooser, even with one eligible
choice, and never picks for the user. Single-platform views use the normal
direct flow. Hidden or stale location data never becomes an action or leaks
through metadata. Friends' online count counts unique people; Dashboard
statistics stay account-based.

Identities manages links in native modal dialogs. Replacing or unlinking shows
the affected pairs and any shared-note loss and needs an explicit
acknowledgement. Unsaved or in-flight drafts block destructive changes. If
linked profiles fail to load, Friends and Identities offer a local Retry.

Sources: [`projectLinkedFriends.ts`](../src/renderer/src/utils/projectLinkedFriends.ts),
[`IdentitiesDialog.tsx`](../src/renderer/src/components/IdentitiesDialog.tsx),
[`LinkedDialog.tsx`](../src/renderer/src/components/LinkedDialog.tsx),
[`LinkedWorlds.tsx`](../src/renderer/src/components/LinkedWorlds.tsx).

## §11 Known open findings

These are tracked separately and are not design rules: Full shown below
capacity, and Private versus Hidden wording. Don't fix them in passing or
present them as approved. A proposed design is labeled as a proposal and never
replaces a current example before approval.

A source or sample-data check doesn't prove the owner accepted something in an
installed app. Never hide a product defect with preview-only styles. Keep
access to existing controls and workflows. The security, credential, account,
request-rate, and merge rules in the root contract still apply; no visual
change waives them.

## §12 Workflow and verification

1. Read the owning source and the [internal API catalog](INTERNAL-API.md).
   Reuse the existing component, resolver, hook, store, token, and translation
   before adding one. All copy goes through i18next with every key in English
   and Japanese.
2. Run `npm run guide:dev` and open `http://127.0.0.1:4173/design.html`, or a
   single scene such as `glass.html?scene=dashboard&theme=light`.
3. Check both themes, each glow level, with and without a background picture,
   at 900×670 and wider, in English and Japanese (`ja-JP`), with keyboard
   focus, reduced motion, and the loading, error, empty and disabled states the
   change can reach. Material changes need a look over a busy picture.
4. A served page or a successful build is not an observed render. Sample
   scenes prove only their sample behavior, not live accounts or a packaged
   install.
5. Run `npm run guide:build` and the guide tests. For app or build changes,
   also run the root gate and the relevant behavior tests. Token changes run
   `npm run design:tokens` to refresh Appendix A (the guide test fails until
   you do).
6. Update this document, the guide, the owning `AGENTS.md` files, the catalog,
   and the changelog in the same change. Keep section and rule numbers stable.

## Appendix A: Token reference

Every custom property in `main.css`, both themes. "(same as dark)" means the
light theme inherits the dark value; "(light only)" means the token exists
only under `[data-theme='light']`. Values that reference other tokens resolve
at runtime in the active theme.

<!-- design-tokens:start -->

<!-- Generated from src/renderer/src/assets/main.css by `npm run design:tokens`. Do not edit by hand. -->

<!-- prettier-ignore-start -->

#### Canvas, text and neutral controls

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--bg-base` | `#08080b` | `#e7ecf3` |
| `--text` | `#f3f1fb` | `#12111a` |
| `--text-dim` | `rgba(231, 225, 250, 0.72)` | `rgba(26, 24, 38, 0.76)` |
| `--text-faint` | `rgba(216, 208, 242, 0.46)` | `rgba(44, 41, 62, 0.56)` |
| `--border` | `rgba(255, 255, 255, 0.1)` | `rgba(36, 44, 64, 0.15)` |
| `--surface-hover` | `rgba(255, 255, 255, 0.05)` | `rgba(20, 19, 28, 0.05)` |
| `--control-fill` | `rgba(255, 255, 255, 0.05)` | `rgba(20, 19, 28, 0.05)` |
| `--control-fill-hover` | `rgba(255, 255, 255, 0.1)` | `rgba(20, 19, 28, 0.1)` |
| `--error` | `#fca5a5` | `#b4232c` |
| `--warning` | `#f59e0b` | `#a15c00` |
| `--favorite` | `#fcd34d` | `#a16207` |
| `--names-lift` | `rgba(233, 228, 250, 0.88)` | `rgba(26, 24, 38, 0.86)` |
| `--scrollbar-thumb` | `rgba(255, 255, 255, 0.12)` | `rgba(20, 19, 28, 0.2)` |

#### Spacing and shell geometry

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--linked-world-corner` | `14px` | (same as dark) |
| `--linked-world-name-max` | `145px` | (same as dark) |
| `--linked-world-pair-max` | `370px` | (same as dark) |
| `--space-0-5` | `2px` | (same as dark) |
| `--space-1` | `4px` | (same as dark) |
| `--space-2` | `8px` | (same as dark) |
| `--space-2-5` | `10px` | (same as dark) |
| `--space-3` | `12px` | (same as dark) |
| `--space-4` | `16px` | (same as dark) |
| `--space-6` | `24px` | (same as dark) |
| `--space-8` | `32px` | (same as dark) |
| `--space-10` | `40px` | (same as dark) |
| `--friend-status-description-width` | `160px` | (same as dark) |
| `--sidebar-width` | `248px` | (same as dark) |
| `--content-inset-left` | `calc(var(--space-4) + var(--sidebar-width) + var(--space-4))` | (same as dark) |
| `--content-inset-right` | `var(--space-4)` | (same as dark) |

#### Platforms

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--vrc` | `#2b7ce8` | `#1769e8` |
| `--cvr` | `#f3711e` | `#ec6210` |
| `--bridge` | `#e8e8f0` | `#30323b` |
| `--plat-cvr-ghost-text` | `color-mix(in srgb, var(--cvr) 76%, white)` | `#b03c08` |
| `--plat-cvr-ghost-border` | `color-mix(in srgb, var(--cvr) 15%, transparent)` | `color-mix(in srgb, var(--cvr) 55%, transparent)` |
| `--plat-vrc-ghost-text` | `color-mix(in srgb, var(--vrc) 72%, white)` | `#1155c8` |
| `--plat-vrc-ghost-border` | `color-mix(in srgb, var(--vrc) 17%, transparent)` | `color-mix(in srgb, var(--vrc) 50%, transparent)` |
| `--plat-vrc-badge-bg` | `color-mix(in srgb, var(--vrc) 10%, transparent)` | `var(--vrc)` |
| `--plat-cvr-badge-bg` | `color-mix(in srgb, var(--cvr) 10%, transparent)` | `var(--plat-cvr-solid)` |
| `--plat-vrc-badge-text` | `var(--plat-vrc-ghost-text)` | `var(--plat-badge-ink)` |
| `--plat-cvr-badge-text` | `var(--plat-cvr-ghost-text)` | `var(--plat-badge-ink)` |
| `--plat-vrc-badge-border` | `var(--plat-vrc-ghost-border)` | `var(--vrc)` |
| `--plat-cvr-badge-border` | `var(--plat-cvr-ghost-border)` | `var(--plat-cvr-solid)` |
| `--plat-vrc-picture-badge-bg` | `color-mix(in srgb, var(--glass-information) 74%, transparent)` | `var(--vrc)` |
| `--plat-cvr-picture-badge-bg` | `color-mix(in srgb, var(--glass-information) 74%, transparent)` | `var(--plat-cvr-solid)` |
| `--plat-vrc-rail-bg` | `color-mix(in srgb, var(--vrc) 30%, transparent)` | `var(--vrc)` |
| `--plat-cvr-rail-bg` | `color-mix(in srgb, var(--cvr) 30%, transparent)` | `var(--plat-cvr-solid)` |
| `--plat-vrc-rail-border` | `color-mix(in srgb, var(--vrc) 70%, transparent)` | `var(--vrc)` |
| `--plat-cvr-rail-border` | `color-mix(in srgb, var(--cvr) 70%, transparent)` | `var(--plat-cvr-solid)` |
| `--plat-vrc-rail-text` | `color-mix(in srgb, var(--vrc) 50%, white)` | `var(--plat-badge-ink)` |
| `--plat-cvr-rail-text` | `color-mix(in srgb, var(--cvr) 55%, white)` | `var(--plat-badge-ink)` |
| `--linked-rail-text` | `var(--text)` | `var(--plat-badge-ink)` |
| `--tint-vrc-bg` | `linear-gradient(135deg, rgba(43, 124, 232, 0.22), rgba(43, 124, 232, 0.05))` | `linear-gradient(135deg, rgba(23, 105, 232, 0.24), rgba(23, 105, 232, 0.1))` |
| `--tint-vrc-border` | `rgba(43, 124, 232, 0.34)` | `rgba(23, 105, 232, 0.72)` |
| `--tint-cvr-bg` | `linear-gradient(135deg, rgba(243, 113, 30, 0.22), rgba(243, 113, 30, 0.05))` | `linear-gradient(135deg, rgba(236, 98, 16, 0.24), rgba(236, 98, 16, 0.1))` |
| `--tint-cvr-border` | `rgba(243, 113, 30, 0.36)` | `rgba(236, 98, 16, 0.76)` |
| `--platform-row-tint-strong` | `24%` | `28%` |
| `--platform-row-tint-soft` | `12%` | `12%` |
| `--text-on-vrc` | `#ffffff` | `#ffffff` |
| `--text-on-cvr` | `#14131c` | `#14131c` |
| `--login-tab-vrc` | `color-mix(in srgb, var(--vrc) 42%, white)` | `var(--plat-vrc-word)` |
| `--login-tab-cvr` | `var(--plat-cvr-word)` | `var(--plat-cvr-word)` |
| `--plat-vrc-word` | `color-mix(in srgb, var(--vrc) 60%, white)` | `var(--plat-vrc-ghost-text)` |
| `--plat-cvr-word` | `color-mix(in srgb, var(--cvr) 66%, white)` | `var(--plat-cvr-ghost-text)` |
| `--plat-cvr-solid` | (light only) | `#c84c08` |
| `--plat-badge-ink` | (light only) | `#ffffff` |

#### Presence and VRChat status

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--ingame` | `#34d399` | `#08a56a` |
| `--active` | `#2dd4bf` | `#0a9a8f` |
| `--offline` | `#6b6480` | `#868a97` |
| `--st-joinme` | `#3aa0ff` | `#1772e0` |
| `--st-online` | `#43c95a` | `#13a04b` |
| `--st-askme` | `#ff9a3d` | `#e46a0e` |
| `--st-dnd` | `#e5484b` | `#d9363b` |
| `--st-joinme-text` | `color-mix(in srgb, var(--st-joinme) 85%, white)` | `#124e91` |
| `--st-online-text` | `var(--st-online)` | `#0f6e35` |
| `--st-askme-text` | `var(--st-askme)` | `#91480e` |
| `--st-dnd-text` | `color-mix(in srgb, var(--st-dnd) 68%, white)` | `#8d2428` |
| `--ingame-text` | `var(--ingame)` | `color-mix(in srgb, var(--ingame) 72%, black)` |
| `--active-text` | `var(--active)` | `color-mix(in srgb, var(--active) 72%, black)` |
| `--offline-text` | `color-mix(in srgb, var(--offline) 60%, white)` | `color-mix(in srgb, var(--offline) 70%, black)` |

#### Instance access, policy space and pills

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--op-public` | `#3ee36a` | `#16ad48` |
| `--op-friends-plus` | `#b7de4f` | `#7ba51a` |
| `--op-friends` | `#e6c353` | `#c29410` |
| `--op-invite-plus` | `#ffc172` | `#e58a1f` |
| `--op-invite` | `#ffa14e` | `#dd6a14` |
| `--op-group-public` | `#bfa0ff` | `#7d5ce0` |
| `--op-group-plus` | `#9d80f6` | `#6c48d6` |
| `--op-group` | `#8d61f0` | `#5c37cf` |
| `--op-public-text` | `var(--op-public)` | `#11652d` |
| `--op-friends-plus-text` | `var(--op-friends-plus)` | `#4c6512` |
| `--op-friends-text` | `var(--op-friends)` | `#6c5410` |
| `--op-invite-plus-text` | `var(--op-invite-plus)` | `#804c10` |
| `--op-invite-text` | `var(--op-invite)` | `#7a3f10` |
| `--op-group-public-text` | `var(--op-group-public)` | `#553c98` |
| `--op-group-plus-text` | `#ac93f7` | `#4a3399` |
| `--op-group-text` | `#b795ff` | `#412b8f` |
| `--policy-public` | `#ed7ab6` | `#c84f91` |
| `--policy-public-text` | `#ed7ab6` | `#8b3265` |
| `--policy-private` | `#62d3e8` | `#228eaa` |
| `--policy-private-text` | `#62d3e8` | `#17667a` |
| `--pill-tint` | `13%` | `17%` |
| `--pill-edge` | `36%` | `55%` |
| `--pill-tint-strong` | `16%` | `20%` |
| `--pill-edge-strong` | `45%` | `62%` |

#### Glass material and controls

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--scrim` | `rgba(0, 0, 0, 0.44)` | (same as dark) |
| `--scrim-soft` | `rgba(0, 0, 0, 0.14)` | (same as dark) |
| `--glass-blur` | `blur(26px) saturate(165%)` | `blur(24px) saturate(175%)` |
| `--glass-bg` | `linear-gradient(135deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.025))` | `linear-gradient(135deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.34))` |
| `--glass-border` | `rgba(255, 255, 255, 0.13)` | `rgba(36, 44, 64, 0.13)` |
| `--glass-shadow` | `0 12px 44px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 1px rgba(255, 255, 255, 0.05)` | `0 1px 2px rgba(31, 38, 56, 0.07), 0 12px 34px rgba(31, 38, 56, 0.13), inset 0 1px 0 rgba(255, 255, 255, 0.9)` |
| `--glass-sheen` | `radial-gradient(125% 80% at 0% 0%, rgba(255, 255, 255, 0.11), transparent 46%)` | `radial-gradient(125% 80% at 0% 0%, rgba(255, 255, 255, 0.6), transparent 48%)` |
| `--glass-frost` | `rgba(13, 15, 22, 0.78)` | `rgba(250, 251, 253, 0.86)` |
| `--glass-information` | `rgb(13, 15, 22)` | `rgb(255, 255, 255)` |
| `--glass-blur-frosted` | `blur(34px) saturate(165%)` | `blur(30px) saturate(175%)` |
| `--glass-frost-heavy` | `rgba(13, 15, 22, 0.94)` | `rgba(250, 251, 253, 0.96)` |
| `--glass-panel` | `rgba(13, 15, 22, 0.5)` | `rgba(250, 251, 253, 0.56)` |
| `--glass-sheet` | `rgba(13, 15, 22, 0.66)` | `rgba(250, 251, 253, 0.76)` |
| `--glass-layer` | `rgba(13, 15, 22, 0.44)` | `rgba(255, 255, 255, 0.6)` |
| `--glass-layer-depth` | `0 6px 18px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.09)` | `0 4px 14px rgba(31, 38, 56, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.9)` |
| `--glass-chip-depth` | `0 3px 8px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(0, 0, 0, 0.18)` | `0 2px 6px rgba(31, 38, 56, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.55)` |
| `--glass-chip-sheen` | `linear-gradient(180deg, rgba(255, 255, 255, 0.16), transparent 60%)` | `linear-gradient(180deg, rgba(255, 255, 255, 0.32), transparent 60%)` |
| `--control-active-bg` | `linear-gradient( 135deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.04) )` | `linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.8))` |
| `--control-active-border` | `rgba(255, 255, 255, 0.16)` | `rgba(36, 44, 64, 0.14)` |
| `--control-active-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.2)` | `inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 2px 10px rgba(31, 38, 56, 0.12)` |
| `--seg-bubble-bg` | `linear-gradient(135deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05))` | `linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.8))` |
| `--seg-bubble-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 2px 10px rgba(0, 0, 0, 0.3)` | `inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 2px 10px rgba(31, 38, 56, 0.14)` |
| `--sidebar-foot-border` | `rgba(255, 255, 255, 0.07)` | `rgba(36, 44, 64, 0.1)` |

#### Pictures, banners and sheets

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--hot-sheet-shadow` | `0 -12px 44px rgba(0, 0, 0, 0.34)` | `0 -12px 44px rgba(31, 38, 56, 0.2)` |
| `--group-icon-shadow` | `0 4px 14px rgba(0, 0, 0, 0.28)` | `0 4px 14px rgba(31, 38, 56, 0.2)` |
| `--group-icon-ring` | `rgba(255, 255, 255, 0.22)` | `rgba(255, 255, 255, 0.9)` |
| `--group-banner-scrim` | `linear-gradient(to top, rgba(0, 0, 0, 0.32), transparent 62%)` | `linear-gradient(to top, rgba(31, 38, 56, 0.16), transparent 62%)` |
| `--hot-sheet-banner-title-shadow` | `0 2px 10px rgba(0, 0, 0, 0.6)` | `none` |
| `--hot-sheet-banner-subtitle-shadow` | `0 1px 6px rgba(0, 0, 0, 0.6)` | `none` |
| `--hot-sheet-banner-image-filter` | `brightness(0.66)` | `none` |
| `--hot-sheet-group-image-filter` | `brightness(0.6)` | `none` |
| `--hot-sheet-banner-scrim` | `none` | `linear-gradient( 0deg, color-mix(in srgb, var(--glass-information) 92%, transparent) 0%, color-mix(in srgb, var(--glass-information) 78%, transparent) 50%, color-mix(in srgb, var(--glass-information) 24%, transparent) 100% )` |

#### Aurora glow and scanlines

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--aurora-vrc` | `rgba(43, 124, 232, 0.26)` | `rgba(23, 105, 232, 0.26)` |
| `--aurora-cvr` | `rgba(243, 113, 30, 0.2)` | `rgba(236, 98, 16, 0.22)` |
| `--aurora-gradient` | `var(--bg-base)` | `linear-gradient(180deg, #f3f6fa 0%, var(--bg-base) 50%, #dfe5ee 100%)` |
| `--glow-size-x` | `95%` | (same as dark) |
| `--glow-size-y` | `78%` | (same as dark) |
| `--glow-fade` | `74%` | (same as dark) |
| `--glow-a-vrc` | `0.299` | `0.42` |
| `--glow-a-cvr` | `0.23` | `0.38` |
| `--wisp-a-vrc` | `0` | `0` |
| `--wisp-a-cvr` | `0` | `0` |
| `--wisp-fade` | `68%` | (same as dark) |
| `--scanline-color` | `rgba(255, 255, 255, 0.022)` | `rgba(20, 19, 28, 0.024)` |
| `--scanline-blend` | `overlay` | `multiply` |
| `--scanline-opacity` | `0.6` | `0.4` |

#### Welcome setup theme pictures

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
| --- | --- | --- |
| `--setup-picture-dark-bg` | `radial-gradient(80% 90% at 10% 0%, rgba(43, 124, 232, 0.35), transparent 70%), radial-gradient(80% 90% at 100% 100%, rgba(243, 113, 30, 0.28), transparent 70%), #08080b` | (same as dark) |
| `--setup-picture-dark-panel` | `rgba(255, 255, 255, 0.09)` | (same as dark) |
| `--setup-picture-dark-edge` | `rgba(255, 255, 255, 0.1)` | (same as dark) |
| `--setup-picture-light-bg` | `radial-gradient(80% 90% at 10% 0%, rgba(31, 111, 211, 0.2), transparent 70%), radial-gradient(80% 90% at 100% 100%, rgba(216, 95, 24, 0.18), transparent 70%), #eef3f8` | (same as dark) |
| `--setup-picture-light-panel` | `rgba(255, 255, 255, 0.85)` | (same as dark) |
| `--setup-picture-light-edge` | `rgba(40, 48, 68, 0.14)` | (same as dark) |

#### Static scale (`@theme`, same in both themes)

| Token | Value |
| --- | --- |
| `--radius-pill` | `9px` |
| `--radius-control` | `12px` |
| `--radius-panel` | `20px` |
| `--font-mono` | `'VT323', ui-monospace, monospace` |
| `--font-sans` | `'Inter', ui-sans-serif, system-ui, sans-serif` |

#### Background glow levels (Standard is the default and sets no attribute)

| Level | Overrides |
| --- | --- |
| Off (`[data-glow='off']`) | `--glow-a-vrc: 0`, `--glow-a-cvr: 0`, `--wisp-a-vrc: 0`, `--wisp-a-cvr: 0` |
| Muted (`[data-glow='muted']`) | `--glow-size-x: 58%`, `--glow-size-y: 50%`, `--glow-fade: 60%`, `--glow-a-vrc: 0.26`, `--glow-a-cvr: 0.2`, `--wisp-a-vrc: 0`, `--wisp-a-cvr: 0` |
| Vivid (`[data-glow='vivid']`) | `--glow-size-x: 120%`, `--glow-size-y: 95%`, `--glow-fade: 82%`, `--glow-a-vrc: 0.39`, `--glow-a-cvr: 0.3`, `--wisp-a-vrc: 0.15`, `--wisp-a-cvr: 0.1275` |
| Muted, light theme (`[data-theme='light'][data-glow='muted']`) | `--glow-a-vrc: 0.3`, `--glow-a-cvr: 0.27` |
| Vivid, light theme (`[data-theme='light'][data-glow='vivid']`) | `--glow-a-vrc: 0.54`, `--glow-a-cvr: 0.48` |

#### Background picture fade

| Fade | Overrides |
| --- | --- |
| Low, dark (`.app-backdrop[data-fade='low']`) | `--app-backdrop-fade: 35%` |
| Medium, dark (`.app-backdrop[data-fade='medium']`) | `--app-backdrop-fade: 55%` |
| High, dark (`.app-backdrop[data-fade='high']`) | `--app-backdrop-fade: 75%` |
| Low, light (`[data-theme='light'] .app-backdrop[data-fade='low']`) | `--app-backdrop-fade: 18%` |
| Medium, light (`[data-theme='light'] .app-backdrop[data-fade='medium']`) | `--app-backdrop-fade: 34%` |
| High, light (`[data-theme='light'] .app-backdrop[data-fade='high']`) | `--app-backdrop-fade: 55%` |

<!-- prettier-ignore-end -->

<!-- design-tokens:end -->

## Appendix B: Recipes

Each recipe follows the shipped code: B.1 is copied from `main.css` (a test
checks it), and the others use the real components and class strings, named
here as constants where the source writes them inline. The visual guide shows
each one rendered next to its code.

### B.1 The material classes (`main.css`, `@layer components`)

```css
.glass {
  position: relative;
  isolation: isolate;
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-panel);
  box-shadow: var(--glass-shadow);
}
.glass::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: var(--glass-sheen);
}
.glass-information {
  background-color: var(--glass-information);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.glass-panel,
.glass-sheet {
  position: relative;
  isolation: isolate;
  background-color: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.glass-panel::after,
.glass-sheet::after {
  --glass-reach: 32px;
  content: '';
  position: absolute;
  z-index: -2;
  inset: -1px calc(-1px - var(--glass-reach)) calc(-1px - var(--glass-reach)) -1px;
  clip-path: inset(
    0 var(--glass-reach) var(--glass-reach) 0 round var(--glass-clip-radius, var(--radius-panel))
  );
  pointer-events: none;
  background-color: var(--glass-panel); /* --glass-sheet for .glass-sheet */
  -webkit-backdrop-filter: var(--glass-blur-frosted);
  backdrop-filter: var(--glass-blur-frosted);
}
.glass-layer {
  background-color: var(--glass-layer);
  box-shadow: var(--glass-layer-depth);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
}
.glass.glass-layer:not(.overflow-hidden) {
  --glass-reach: 32px;
  background: none;
  background-image: none !important;
  border-color: transparent !important;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.glass.glass-layer:not(.overflow-hidden)::before {
  inset: -1px;
  border: 1px solid var(--glass-edge, var(--glass-border));
  background-color: var(--glass-layer);
  background-image: var(--glass-sheen), var(--glass-face, var(--glass-bg));
  box-shadow: var(--glass-layer-depth);
}
.glass.glass-layer:not(.overflow-hidden)::after {
  content: '';
  position: absolute;
  z-index: -2;
  inset: -1px calc(-1px - var(--glass-reach)) calc(-1px - var(--glass-reach)) -1px;
  clip-path: inset(
    0 var(--glass-reach) var(--glass-reach) 0 round var(--glass-clip-radius, var(--radius-panel))
  );
  pointer-events: none;
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
}
.glass-chip {
  position: relative;
  isolation: isolate;
  box-shadow: var(--glass-chip-depth);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
}
.glass-chip::after {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: var(--glass-chip-sheen);
}
```

### B.2 Stacking the layers (JSX)

```tsx
// Layer 2: the back panel a page sits on.
<section className="glass glass-panel p-[var(--space-4)]">
  {/* Layer 3: a card on the panel. */}
  <div className="glass glass-layer p-[16px_18px]">
    <div className="font-[family-name:var(--font-mono)] text-[38px] leading-none tabular-nums text-[var(--text)]">
      13
    </div>
    <div className="mt-[var(--space-1)] text-[12.5px] text-[var(--text-dim)]">Friends online</div>
  </div>
  {/* Layer 3: a row that belongs to one platform. */}
  <div className="platform-row platform-row--vrchat flex items-center gap-[var(--space-3)] p-[var(--space-2)]">
    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">Amy</span>
    {/* Layer 4: chips. */}
    <PlatformPill platform="vrchat" />
    <InstancePill label="Public" tier="public" />
  </div>
</section>
```

### B.3 Pills (`utils/instancePill.ts`, `InstancePill.tsx`, `PlatformPill.tsx`)

```ts
export const PILL_BASE =
  'glass-chip inline-flex h-[28px] shrink-0 items-center justify-center ' +
  'rounded-[10px] border px-[12px] text-[12px] font-semibold whitespace-nowrap'

// A tiered pill: the tier's hue fills at --pill-tint and edges at --pill-edge.
const style = {
  color: `var(--op-${tier}-text)`,
  '--instance-pill-bg': `color-mix(in srgb, var(--op-${tier}) var(--pill-tint), transparent)`,
  borderColor: `color-mix(in srgb, var(--op-${tier}) var(--pill-edge), transparent)`
}
// A neutral pill (Private, Offline Instance, Unknown).
const neutral = {
  color: 'var(--text-dim)',
  '--instance-pill-bg': 'color-mix(in srgb, var(--text) 7%, transparent)',
  borderColor: 'color-mix(in srgb, var(--text) 16%, transparent)'
}
// A platform pill: the same geometry with the platform badge tokens.
const platform = {
  color: 'var(--plat-vrc-badge-text)',
  borderColor: 'var(--plat-vrc-badge-border)',
  background: 'var(--plat-vrc-badge-bg)'
}
```

### B.4 Buttons

```ts
// Quiet button (the default).
const QUIET =
  'rounded-control px-[var(--space-3)] py-[var(--space-2)] text-[12px] font-semibold text-[var(--text)] ' +
  'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] ' +
  'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] motion-safe:transition-colors'

// Quieter text button (Hide, Decline, See all).
const QUIETER =
  'shrink-0 rounded-control px-[var(--space-3)] py-[var(--space-1)] text-xs font-medium ' +
  'text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] ' +
  'aria-disabled:cursor-default aria-disabled:opacity-50 motion-safe:transition-colors'

// A row's one filled action: Accept, Add friend (utils/friendActions.ts).
const FRIEND_ACTION_BUTTON =
  'shrink-0 rounded-control border border-[var(--control-active-border)] bg-[var(--control-fill-hover)] ' +
  'px-[var(--space-3)] py-[var(--space-1)] text-xs font-semibold text-[var(--text)] ' +
  'hover:brightness-110 active:brightness-95 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] ' +
  'aria-disabled:cursor-default aria-disabled:opacity-60 motion-safe:transition-[filter]'

// The welcome setup's main button, which favors neither platform
// (PRIMARY_BUTTON in components/setup/SetupWizard.tsx).
const SETUP_PRIMARY =
  'rounded-control border border-[var(--text)] bg-[var(--text)] px-[18px] py-[10px] ' +
  'text-[13px] font-semibold leading-none text-[var(--bg-base)] hover:opacity-90 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] ' +
  'disabled:cursor-not-allowed disabled:opacity-40 motion-safe:transition-opacity cursor-pointer'

// A platform's own Connect button (LoginScreen.tsx).
const CONNECT = {
  vrchat: 'border-[var(--vrc)] bg-[var(--vrc)] text-[var(--text-on-vrc)]',
  chilloutvr: 'border-[var(--cvr)] bg-[var(--cvr)] text-[var(--text-on-cvr)]'
}
```

### B.5 Segmented control and toggle

```tsx
<SegmentedControl
  values={['vrchat', 'platform-native', 'chilloutvr'] as const}
  active={scheme}
  labelKeys={{
    vrchat: 'settings.labelScheme.vrchat',
    'platform-native': 'settings.labelScheme.platformNative',
    chilloutvr: 'settings.labelScheme.chilloutvr'
  }}
  ariaLabel={t('settings.labelScheme.label')}
  onChange={setScheme}
/>
<Toggle
  checked={popularNow}
  onChange={(on) => updateSettings({ dashboardPopularNow: on })}
  ariaLabel={t('settings.dashboard.popular.label')}
/>
```

### B.6 Section heading and notice

```tsx
// Dashboard section heading (VT323 kicker).
<h2 className="canvas-text font-[family-name:var(--font-mono)] text-[18px] font-normal tracking-[2px] uppercase text-[var(--text-dim)]">
  {t('dashboard.sectionHotInstances')}
</h2>

// One-row notice strip (RecoveryNotices.tsx); a failure leads with a warning glyph.
<div
  role="alert"
  className="glass glass-layer mb-[var(--space-2)] flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] text-xs leading-snug text-[var(--text-dim)]"
>
  <span aria-hidden="true" className="shrink-0 text-sm text-[var(--error)]">
    ⚠
  </span>
  <span className="min-w-0 flex-1">{t('settings.persistence.error')}</span>
  <button
    type="button"
    aria-disabled={saving || undefined}
    className="shrink-0 rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text)] hover:bg-[var(--control-fill-hover)] aria-disabled:cursor-default aria-disabled:opacity-50"
  >
    {t(saving ? 'settings.persistence.saving' : 'settings.persistence.retry')}
  </button>
</div>
```

### B.7 Empty and not-connected state

```tsx
// NotConnectedCard.tsx: a layered card with one line and one quiet action.
<div className="glass glass-layer flex min-h-[180px] flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center">
  <p className="text-sm font-semibold text-[var(--text-dim)]">{message}</p>
  <button
    type="button"
    onClick={onOpenAccounts}
    className="rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
  >
    {t('dashboard.notConnected.openAccounts')}
  </button>
</div>
```

### B.8 Theme and glow

```ts
// hooks/useApplyTheme.ts: light sets the attribute, dark removes it.
document.documentElement.setAttribute('data-theme', 'light')
document.documentElement.removeAttribute('data-theme')
// hooks/useApplyGlow.ts: Standard removes data-glow; the others set it.
document.documentElement.setAttribute('data-glow', 'vivid') // 'off' | 'muted' | 'vivid'
```

## Appendix C: Rebuilding the look outside VRX

To reproduce the VRX language in another codebase (a mockup, a companion
site, a prototype):

1. Copy the `:root` and `[data-theme='light']` token blocks from Appendix A
   into your stylesheet as CSS variables. Keep the names.
2. Self-host Inter (variable) and VT323 and set `--font-sans` and
   `--font-mono` as in Appendix A.
3. Paint the canvas: `body { background: var(--bg-base); color: var(--text);
font-family: var(--font-sans) }`, then the aurora `body::before` and the
   scanline `body::after` from `main.css` (§4).
4. Copy the material classes from Appendix B.1 and the `.platform-row` rule
   from `main.css`, inside a cascade layer below your utilities.
5. Build pages as layers: sidebar `.glass`, page panel `.glass .glass-panel`,
   cards `.glass .glass-layer`, pills `.glass-chip` with `PILL_BASE`
   geometry, dialogs `.glass .glass-frosted-heavy .glass-information`.
6. Apply the Locked rules: equal platforms, a word beside every color, VRChat
   blue and ChilloutVR orange, privacy for Ask Me and Do Not Disturb, simple by
   default.
7. Check dark and light by toggling `data-theme="light"` on `<html>`.

## Appendix D: Glossary and legacy labels

- **Presence state:** `in-game` (in a world), `active` (online outside the
  game), `offline`. **Status:** VRChat's own Join Me, Online, Ask Me, Do Not
  Disturb.
- **Instance / access tier:** a specific running copy of a world and who may
  join it (Public, Friends+, Friends, Invite+, Invite, Group Public, Group+,
  Group; ChilloutVR adds its own names and the Offline Instance).
- **Hot instance:** one exact instance with at least the threshold number of
  visible friends in it.
- **Linked person:** one VRChat friend and one ChilloutVR friend the user
  joined by hand into one VRX person.
- **Information surface:** any card, row, panel or overlay that carries
  meaning, as opposed to decorative chrome.
- **Canvas text:** words set straight on the background, not on a pane.

Code comments from earlier versions use these labels: **R2, R10, R12** mean a
color always has a non-color cue (label, glyph, or word); **R10** in motion
comments means motion only under `motion-safe:`; **R6** is the Ask Me and Do
Not Disturb location privacy rule (§5); **R5** is the updater's indeterminate
"Updating…" label while it downloads; **§2A, §3A, §4A** are the light-theme
parts of §2, §3 and §4; **"channel law"** means Locked rules 2–4 and §5.
