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
implementation. This document records what that code does and the decisions it
must keep. Appendix A is generated from `main.css` (`npm run design:tokens`),
so its values always match the app. Sizes given in pixels were measured in the
running app at 100% display scale. If the code and the prose disagree,
investigate before changing either. A known defect is never a design rule, and
an old example is never an approved redesign.

**Stable references.** Code comments cite this document by section ("DESIGN.md
§5") and by Locked rule number ("Locked rule 5"). Keep both numbering schemes.
Older comments use rule labels from earlier versions; [Appendix D](#appendix-d-glossary-and-legacy-labels)
translates them.

## Quick start for agents

VRX is a dense desktop companion for two social VR platforms, VRChat and
ChilloutVR. Its look is **layered frosted glass over an aurora canvas**: a blue
glow in the top-left corner, an orange glow in the bottom-right, faint
scanlines, and stacked translucent panes that blur whatever is behind them.
Inter carries the interface; the retro VT323 face is a small accent.

To build a screen that belongs in VRX:

1. **Pick the layer.** A page sits straight on the canvas or on a back panel
   (`.glass-panel`). Cards are `.glass .glass-layer`; rows that belong to one
   platform are `.platform-row`; Settings rows are `.setting-card`. Pills,
   badges and small counts are `.glass-chip`. Menus and dialogs are opaque
   (`.glass .glass-information`, plus `.glass-frosted-heavy` for a
   confirmation). See §3.
2. **Use tokens, never raw colors.** Every color is a CSS variable from
   Appendix A, used through Tailwind arbitrary values such as
   `text-[var(--text-dim)]` or `bg-[var(--control-fill)]`. Light mode is the
   same variables overridden under `[data-theme='light']`; you get it for free.
3. **Give every color a job and a word.** VRChat is blue (`--vrc`) and always
   comes with the word VRChat or VRC; ChilloutVR is orange (`--cvr`) with
   ChilloutVR or CVR. Status, access and errors carry words or glyphs too.
   The only color-only cue is the friends-list avatar ring (Locked rule 4).
4. **Treat both platforms the same.** Same layout, same fields in the same
   order, same size, same wording weight. VRChat comes first where a fixed
   order is needed (tabs, account cards, the filter). Never invent a feature
   for the platform that lacks it.
5. **Say little.** Show what most people need in few words; put the rest
   behind a quiet "?" or Show more control, in Settings, or in About.
6. **Type:** Inter 14 px for names and labels, 12–13 px for secondary text,
   25 px extra bold for the page title, VT323 only for the wordmark, section
   kickers and big numbers. Text is `--text`, secondary text is `--text-dim`.
7. **Shape:** panels and cards round at 20 px, controls and rows at 12–13 px,
   pills at 9–10 px. Spacing comes from the token scale (`--space-0-5` …
   `--space-10`, 2 to 40 px).
8. **Controls:** choices are the shared segmented control (`SegmentedControl`,
   or `Toggle` for On/Off); numbers use `NumberStepper`. Buttons are quiet
   fills on `--control-fill`. A platform's own action (Connect, Save) is a
   button tinted in that platform's color; "Sign in" on the sign-in screen is
   the only solid platform-colored button.
9. **Accessibility is part of the look:** visible focus, keyboard paths for
   everything, motion only under `motion-safe:`, nothing color-only, and every
   workflow usable at the 900×670 minimum window.
10. **Check both themes** (dark and light), every glow level, with and without
    a background picture, and in Japanese, before calling a change done.

## Locked rules

These decisions are settled by the owner. Changing one needs the owner's
explicit approval.

1. **Equal platforms.** VRChat and ChilloutVR get the same treatment, visual
   weight, wording weight, and features wherever both platforms support them.
   That includes the app icon, where the V and X are the same size (§1).
2. **Brand colors.** VRChat is blue (`--vrc`) and ChilloutVR is orange
   (`--cvr`), following each platform's brand. The combined "All" view and a
   linked person use the blue-to-orange blend.
3. **Color always means something, and never alone.** Every color cue sits in
   a consistent place with a non-color cue nearby: a word, glyph, shape, or
   label. Platform pills and tabs carry the platform name, instance pills are
   words, and the connection indicator pairs color with shape (§8).
4. **The one color-only exception.** In the friends list, the avatar ring and
   its corner dot show presence and status by color alone, to keep rows clean.
   The row's accessible name includes the state, and the friend details panel
   shows the written status (§5). Don't "fix" this.
5. **Missing is red, stale is dim.** A source that never loaded uses the error
   color (`--error`). A source showing older data uses `--text-dim` (§9.4).
6. **Layered glass.** The UI is panes of frosted glass stacked on each other:
   the background, then the sidebar and back panels, then the cards and rows
   on them, then the small chips on the cards. The background shows through
   every pane as blurred color; words stay readable and platform color stays
   the strongest tint on a platform card. Menus and dialogs stay opaque (§3).
7. **Dashboard layout.** Under the numbers the Dashboard has four sections:
   Wearing now (the worn avatar per signed-in platform), Latest invites (the
   newest invite per platform), Popular now and Hot Instances, in that order
   by default. Settings → Dashboard → Sections moves each one up or down and
   turns it on or off, all on by default; off only hides the Dashboard section
   (§9.1, §9.8). Wearing now and Latest invites share one glance row while they
   sit next to each other. Of Popular now and Hot Instances, the first shown
   uses picture cards and the second uses bars with the world picture behind
   them. Each shows two cards: the top one per platform when both have one,
   otherwise the top two. A picture-card section on a window wide enough for
   three or more columns fills one whole row instead. Hide empty sections, on
   by default, lets a section with nothing to show step aside so the others
   take its space.
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
  welcome setup is the only guided flow (§9.9).
- **No personal information** about the owner or any real user appears in the
  app, the guide, fixtures or screenshots. Sample data is invented.

## §0 Direction and authority

VRX is a dense desktop companion, not a website. Equivalent concepts on the
two platforms use the same presentation and terminology. A feature one
platform doesn't have stays absent for that platform; never fake it, and never
add a feature just to make the platforms match. Name the platforms only, never
the companies behind them.

Dark is the stylesheet baseline (`:root`, with `color-scheme: dark`). Light
mode uses the same components, hierarchy, interactions, and meaning, with
token overrides under `[data-theme='light']`. The stored Theme preference
defaults to System, which follows the operating system and switches live when
the system does. Don't confuse the dark baseline with the default preference.

The interface language follows the operating system: Japanese when the system
language is Japanese, English otherwise. There is no language control in the
app. Every visible string comes from
[`locales/en`](../src/renderer/src/locales/en/translation.json) and
[`locales/ja`](../src/renderer/src/locales/ja/translation.json).

Visible wording, layout, and interaction changes need the owner's approval
unless an approved issue already specifies the outcome. Polish that keeps the
design language (alignment, contrast, focus, spacing, overflow) is welcome;
changing the language itself is not. Documentation work never authorizes
redesigning the app.

## §1 Identity

**Wordmark.** Inside the app, the brand is the horizontal VRX wordmark in
VT323 with the platform colors on V (`--vrc`) and X (`--cvr`) and the neutral
bridge color (`--bridge`) on R. It has `role="img"` so it reads as one name.

| Place                       | Wordmark size                     | Below it                                                       |
| --------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Sidebar                     | 40 px, 2 px tracking              | "Social VR Companion", 11 px, `--text-faint`, 0.5 px tracking  |
| Sign-in screen              | 40 px, 2 px tracking              | the same subtitle                                              |
| Welcome setup, first screen | 64 px, 2 px tracking              | the title "Welcome to VRX"                                     |
| Loading and error screens   | 36 px (`text-4xl`), wide tracking | "Connecting…", or the error heading                            |
| Sidebar footer              | 16 px, 1 px tracking              | "Social VR Companion · v" and the version, 11 px, `--text-dim` |

Page titles name the active view in the sidebar's words (Dashboard, Friends,
Hot Instances, Activity, Inbox, Explore, Search, Groups, Avatars, Settings).
The window title is "VRX". VRX draws no platform logos: a platform is always
named by its word (VRChat, ChilloutVR) or short tab (VRC, CVR).

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

**Tray.** The tray icon uses the same artwork, with the tooltip "VRX" and a
menu of Show VRX or Hide VRX, and Quit VRX. On Windows and Linux the window's
close button hides the window to the tray instead of quitting.

Sources: [`Sidebar.tsx`](../src/renderer/src/components/Sidebar.tsx),
[`LoginScreen.tsx`](../src/renderer/src/components/LoginScreen.tsx),
[`BootSplash.tsx`](../src/renderer/src/components/BootSplash.tsx),
[`viewTitles.ts`](../src/renderer/src/utils/viewTitles.ts),
[`tray.ts`](../src/main/tray.ts).

## §2 Tokens and themes

`main.css` owns every token value, font face, spacing step, radius, material
class, and theme override. Tokens are plain CSS variables on `:root` (dark)
with a second block under `[data-theme='light']`. Only five live in Tailwind's
`@theme` block, so they also exist as utilities: `--radius-pill` (9 px,
`rounded-pill`), `--radius-control` (12 px, `rounded-control`),
`--radius-panel` (20 px, `rounded-panel`), `--font-mono` (VT323) and
`--font-sans` (Inter). Everything else is used through arbitrary values:
`text-[var(--text-dim)]`, `p-[var(--space-4)]`.

Rules:

- No raw hex, `rgb()` or named color in a component. If a color is missing,
  add a token to both theme blocks and run `npm run design:tokens`.
- A token has one meaning. Do not reuse `--error` for decoration or a
  platform color for emphasis.
- Derive tints with `color-mix(in srgb, var(--vrc) 16%, transparent)` so
  they follow the theme.
- React `style={}` is allowed for token-driven values. The page's content
  security policy forbids `<style>` elements and inline style strings.

### Token families

Appendix A lists every token with both values. The families:

| Family          | Tokens                                                                                                                                                                                                         | Job                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Base            | `--bg-base`, `--text`, `--text-dim`, `--text-faint`, `--border`                                                                                                                                                | Canvas color, the three text steps, the neutral hairline.                                  |
| Fills           | `--surface-hover`, `--control-fill`, `--control-fill-hover`                                                                                                                                                    | Hover wash on rows; resting and hover fill of quiet buttons and fields.                    |
| Feedback        | `--error`, `--warning`, `--favorite`                                                                                                                                                                           | Failure and destructive actions; reconnecting; the favorite star.                          |
| Spacing         | `--space-0-5`, `--space-1`, `--space-2`, `--space-2-5`, `--space-3`, `--space-4`, `--space-6`, `--space-8`, `--space-10`                                                                                       | 2, 4, 8, 10, 12, 16, 24, 32, 40 px.                                                        |
| Layout          | `--sidebar-width`, `--content-inset-left`, `--content-inset-right`                                                                                                                                             | 248 px sidebar; the content area's left and right edges, used by bottom sheets and scrims. |
| Identity        | `--vrc`, `--cvr`, `--bridge`                                                                                                                                                                                   | VRChat blue, ChilloutVR orange, the neutral R of the wordmark.                             |
| Presence        | `--ingame`, `--active`, `--offline`, each with a `-text` twin                                                                                                                                                  | In a world, online outside the game, offline (§5).                                         |
| Status          | `--st-joinme`, `--st-online`, `--st-askme`, `--st-dnd`, each with a `-text` twin                                                                                                                               | VRChat's four statuses (§5).                                                               |
| Access tiers    | `--op-*` (eight tiers, each with a `-text` twin)                                                                                                                                                               | Instance pills, from Public to Group (§6.1).                                               |
| Policy space    | `--policy-public`, `--policy-private`, each with a `-text` twin                                                                                                                                                | The Public space and Private space pill (§6.2).                                            |
| Platform chips  | `--plat-*-badge-*`, `--plat-*-ghost-*`, `--plat-*-rail-*`, `--plat-*-picture-badge-bg`, `--plat-vrc-word`, `--plat-cvr-word`, `--linked-rail-text`                                                             | Platform pills, the friends-list rail, badges over pictures, the filter words.             |
| On-color text   | `--text-on-vrc`, `--text-on-cvr`, `--login-tab-vrc`, `--login-tab-cvr`, `--names-lift`                                                                                                                         | Text on a solid platform button; sign-in tab words; the who's-here line on cards.          |
| Glass           | `--glass-*` (blur, fills, border, sheen, shadows)                                                                                                                                                              | The material (§3).                                                                         |
| Tints and mixes | `--tint-vrc-bg`, `--tint-vrc-border`, `--tint-cvr-bg`, `--tint-cvr-border`, `--platform-row-tint-strong`, `--platform-row-tint-soft`, `--pill-tint`, `--pill-edge`, `--pill-tint-strong`, `--pill-edge-strong` | Platform wash on cards and rows; how strong a pill's fill and edge are.                    |
| Controls        | `--control-active-bg`, `--control-active-border`, `--control-active-shadow`, `--seg-bubble-bg`, `--seg-bubble-shadow`, `--sidebar-foot-border`, `--scrollbar-thumb`                                            | Active sidebar item, the segmented bubble, the footer hairline, the scrollbar.             |
| Overlays        | `--scrim`, `--scrim-soft`, `--hot-sheet-shadow`, `--hot-sheet-banner-*`, `--hot-sheet-group-image-filter`, `--group-icon-shadow`, `--group-icon-ring`, `--group-banner-scrim`                                  | Dimming behind overlays; sheet and banner treatment (§9.3).                                |
| Canvas          | `--aurora-gradient`, `--glow-*`, `--wisp-*`, `--scanline-color`, `--scanline-blend`, `--scanline-opacity`                                                                                                      | The aurora, its glow levels and the scanlines (§4).                                        |
| Setup previews  | `--setup-picture-*`                                                                                                                                                                                            | The small theme pictures in the welcome setup (§9.4).                                      |
| Linked geometry | `--linked-world-corner`, `--linked-world-name-max`, `--linked-world-pair-max`                                                                                                                                  | Sizes for a linked person's two-world line and picture (§10).                              |

Some components set local variables that are not theme tokens:
`--instance-pill-bg` (a pill's own fill), `--platform-row-color` and its
`--platform-row-from`, `--platform-row-to`, `--platform-row-border` (a
platform row's wash), `--app-backdrop-fade` (the fade over a background
picture), `--aurora-floor`, `--alert-step` (stagger in the alerts panel),
`--linked-platform` and `--linked-badge-bg` (a linked person's platform tag),
and the edge-reach variables `--glass-reach`, `--glass-clip-radius`,
`--glass-face`, `--glass-edge` (§3).

### Text steps

| Token          | Dark                        | Light                    | Use                                                                 |
| -------------- | --------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `--text`       | `#f3f1fb`                   | `#12111a`                | Names, titles, values, button words.                                |
| `--text-dim`   | `rgba(231, 225, 250, 0.72)` | `rgba(26, 24, 38, 0.76)` | Secondary lines, labels, idle sidebar items, kickers, hints.        |
| `--text-faint` | `rgba(216, 208, 242, 0.46)` | `rgba(44, 41, 62, 0.56)` | Placeholders, the wordmark subtitle, a stepper button at its bound. |

`--text-faint` never carries information a person must read to use the app.

### How light differs

Light is not an inverted dark. The same classes read these changes from the
light token block:

- **Canvas.** `--bg-base` is a cool pale grey (`#e7ecf3`) and the aurora sits
  on a soft top-to-bottom gradient instead of a flat floor. The glows are
  stronger so they still read on a pale ground (§4).
- **Glass.** Panes are white-based: `--glass-bg` runs from 66% to 34% white,
  the blur is 24 px with 175% saturation (dark: 26 px, 165%), borders are a
  cool dark hairline, and shadows are soft grey-blue instead of black.
- **Platform chips turn solid.** A platform pill and the friends-list rail are
  white words on the solid platform color in light, and tinted glass with
  lighter platform-colored words in dark. Short badges over pictures keep a
  card-colored backing in both.
- **Colored words darken.** Access-tier pill words use the darker `-text`
  twins (Public is `#11652d` on a 17% green fill; dark uses the bright
  `#3ee36a` on a 13% fill). `--error` is `#b4232c` (dark `#fca5a5`),
  `--favorite` is `#a16207` (dark `#fcd34d`).
- **Platform rows** take a 28% wash and a strong platform-colored border in
  light (dark: 24% wash, a soft 34–36% border).
- **Scanlines** multiply dark lines at 40% opacity in light; dark overlays
  light lines at 60%.
- **Words on a background picture** get a small card-colored backing in light
  only (§4).

The window's own background, painted by the main process before the page
loads and during resize, matches `--bg-base`: `#08080b` in dark and `#e7ecf3`
in light ([`windowTheme.ts`](../src/main/windowTheme.ts)).

Sources: [`main.css`](../src/renderer/src/assets/main.css),
[`useApplyTheme.ts`](../src/renderer/src/hooks/useApplyTheme.ts),
[`cssTokens.ts`](guide/cssTokens.ts).

## §3 Material: layered glass

Everything visible is a pane of glass on the canvas. Panes stack in a fixed
order, and each layer has one class.

| Layer | What it is                                   | Class                                                                | Fill                                         | Blur                           |
| ----- | -------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------ |
| 0     | The canvas: aurora or the user's own picture | (`body`, §4)                                                         | `--bg-base`                                  | none                           |
| 1     | Shell and control glass                      | `.glass`                                                             | `--glass-bg` gradient                        | `--glass-blur` (26 px, 165%)   |
| 2     | Back panels, drawers and bottom sheets       | `.glass-panel`, `.glass-sheet`                                       | `--glass-panel` (50%), `--glass-sheet` (66%) | `--glass-blur-frosted` (34 px) |
| 3     | Cards, rows, section headers, fields         | `.glass-layer`, `.platform-row`, `.setting-card`                     | `--glass-layer` (44%)                        | `--glass-blur`                 |
| 4     | Chips: pills, badges, rails, small counts    | `.glass-chip`                                                        | the chip's own tint                          | `--glass-blur`                 |
| —     | Menus, dialogs, loading and error screens    | `.glass-information` (with `.glass-frosted`, `.glass-frosted-heavy`) | `--glass-information`, opaque                | none                           |

The percentages are the dark values; Appendix A has both themes.

**Layer 1, `.glass`.** The base skin: `--glass-bg` (a 135° white gradient, 9%
to 2.4% in dark), a 1 px `--glass-border`, the 20 px panel radius,
`--glass-shadow` (a deep drop shadow plus a lit top edge), and the blur. Its
`::before` paints `--glass-sheen`, a soft light from the top-left corner, at
`z-index: -1` so it lights the pane but never the content. `.glass` sets
`position: relative` and `isolation: isolate`. Used as is by the sidebar,
every segmented control track, the number stepper, the round "?" help
buttons, and the round favorite and alert buttons in friend details.

**Layer 2, back panels and sheets.** `.glass-panel` is the panel a page's
cards sit on: the Settings panel and the welcome setup card
(`.glass .glass-panel`), and the Friends list panel (`.glass-panel` with its
own `--glass-border` border and `rounded-panel`). `.glass-sheet` is a drawer
or sheet that floats over live content: the friend details drawer
(`.glass .glass-sheet`) and the bottom sheets (§9.3). Both remove the
element's own blur and put it on `::after` at `z-index: -2`, under the sheen
and the content. The reason is a browser rule: an element with a
`backdrop-filter` becomes the containing block for fixed-position
descendants, which would trap the drawer inside the list panel. **Never put a
`backdrop-filter` on an element that contains a fixed overlay.**

**Layer 3, cards and rows.**

- `.glass .glass-layer` is a card: the Dashboard number cards, hot instance
  cards, world cards, avatar cards, group and people tiles, help panels,
  notices above a page, and the empty and not-connected cards. The card
  paints nothing itself. Its `::before` is the pane (fill, face, sheen, border
  and the `--glass-layer-depth` lift) and its `::after` is the blur. A card
  that must clip its content (`overflow-hidden`: the sign-in card and the
  account cards) keeps blurring itself instead.
- `.glass-layer` without `.glass` makes a small element its own pane: the
  Friends search field, the Friends section headers, and the sign-in fields
  inside the welcome setup.
- `.platform-row` is a row that belongs to one platform: a friend row, an
  Activity entry, an Inbox row, a Dashboard glance row. It is a
  `--glass-layer` pane washed in the platform color from the left
  (`--platform-row-tint-strong` falling to `--platform-row-tint-soft`), with a
  1 px platform-tinted border and the 12 px control radius.
  `.platform-row--vrchat` is blue, `.platform-row--chilloutvr` is orange,
  `.platform-row--vrx` (a linked person) runs blue into orange with a blue
  top and left border and an orange right and bottom border, and
  `.platform-row--none` is the same capsule with no color (loading and empty
  rows).
- `.setting-card` is a Settings row on the Settings panel: `--glass-layer`
  with the sheen, a 1 px `--border`, 12 px radius, 8 px by 12 px padding.

**Layer 4, `.glass-chip`.** The top pane: the blur under the chip's own
tinted fill, `--glass-chip-depth` (a tight lift and a lit edge), and
`--glass-chip-sheen` on `::after` under the word. Instance pills, platform
pills, the policy pill, the friends-list rail, short badges over pictures,
the sidebar's Inbox count, and the platform and status chips in friend
details are chips. Names, custom status text, pictures and status dots never
get one. `.status-badge` gives the opaque presence dot on an avatar the
chip's lift without the blur.

**Opaque surfaces.** `.glass-information` replaces the see-through fill with
the solid `--glass-information` backing and turns the blur off. Anything a
person must read over busy content uses it. The welcome setup card stays the
frosted back panel from layer 2.

| Surface                                                              | Classes                                          |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| Top-bar counts panel, loading screen card, error screen card         | `.glass .glass-information`                      |
| Favorites panel and alerts panel in friend details (16 px radius)    | `.glass .glass-information`                      |
| Edit profile, Identities, Picked friends, Choose destination dialogs | `.glass .glass-frosted .glass-information`       |
| Join confirmation; Unfriend, Block and Unblock confirmation          | `.glass .glass-frosted-heavy .glass-information` |

`.glass-frosted` and `.glass-frosted-heavy` on their own give a 78% and a 94%
card-colored underlay with the 34 px blur. In the shipped app they always
come with `.glass-information`.

**Edge reach.** On a display scaled to 125% or 150% a blur can stop short of
a pane's right and bottom edges and leave a flat strip. Panels, sheets and
reach cards therefore extend the blur layer `--glass-reach` (32 px) past
those two edges and cut it back with a `clip-path` to the pane's rounded
shape. `--glass-clip-radius` gives that shape; bottom sheets set it to round
only the top two corners. Because a reach card no longer clips its content, a
picture inside it rounds itself with `.glass-clip-top`, `.glass-clip-left` or
`.glass-clip-all` (19 px, one less than the card).

**Platform tint.** `.tint-vrc` and `.tint-cvr` wash a card in its platform
color (`--tint-vrc-bg`, `--tint-cvr-bg`) and tint its border. They set the
background image only, so an opaque backing survives, and they hand the same
tint to a reach card's pane through `--glass-face` and `--glass-edge`.

**No solid colored edge.** A card, row, sheet or dialog never carries a solid
colored bar or line along one edge. The platform shows as the wash, the soft
tinted border and the platform chip.

**Hover and press.**

| Element                          | Hover                               | Press           |
| -------------------------------- | ----------------------------------- | --------------- |
| Rows, idle sidebar items         | `--surface-hover` wash              | —               |
| Quiet buttons and fields         | `--control-fill-hover`              | —               |
| Picture cards (`.glass-hover`)   | pane, blur and pictures brighten 5% | —               |
| Actionable pills, filled actions | `brightness-110`                    | `brightness-95` |
| Platform buttons                 | 90% opacity                         | —               |

Never put a `filter` on a card that holds a blur layer or on its ancestors;
it empties the blur. That is why picture cards use `.glass-hover`. Color and
filter transitions take 150 ms and only run when the system allows motion.

**Radius scale.**

| Radius | Used by                                                                                 |
| ------ | --------------------------------------------------------------------------------------- |
| 20 px  | Sidebar, panels, cards, dialogs, segmented tracks, the top two corners of bottom sheets |
| 16 px  | The segmented bubble, the favorites and alerts panels                                   |
| 13 px  | Friend rows, world picture and room rows in the world sheet                             |
| 12 px  | `rounded-control`: buttons, fields, platform rows, setting cards, active sidebar item   |
| 10 px  | Instance, platform and policy pills, small Settings buttons, the status chip            |
| 9 px   | `rounded-pill`: short badges, the friends-list rail, segmented options, close buttons   |
| Full   | Avatars, dots, round icon buttons, the sidebar update button, the Inbox count           |

**Stacking.** Background picture −3, aurora −2, scanlines −1, page content 0,
sticky Friends section headers 10, scrims 40, drawers, sheets, dialogs and the
counts panel 50.

Sources: [`main.css`](../src/renderer/src/assets/main.css) (the
`@layer components` block),
[`catalog-scenes.tsx`](guide/catalog-scenes.tsx) (the `layers` scene).

## §4 Canvas, glow and background picture

**Canvas.** `body` is `--bg-base` with `overflow: hidden`; only the content
area scrolls (§8). Two fixed layers sit behind everything:

- `body::before` (`z-index: -2`) is the aurora: a blue radial glow anchored
  at 12% 6% (top-left) and an orange one at 92% 96% (bottom-right), two
  smaller wisps at 30% 22% and 74% 78% that only the Vivid level lights, and
  the floor `--aurora-gradient` (flat `--bg-base` in dark, a pale vertical
  gradient in light). Blue is always top-left and orange bottom-right.
- `body::after` (`z-index: -1`) is the scanlines: a 1 px line every 3 px in
  `--scanline-color`, blended with `--scanline-blend` at
  `--scanline-opacity`. They are a faint texture, never a visible grid, and
  ignore the pointer.

**Background glow.** Settings → Appearance → Background glow has four levels.
A level only changes variables on `<html>`: `data-glow` is `off`, `muted` or
`vivid`, and absent for Standard.

| Level              | Glow size (`--glow-size-x` × `--glow-size-y`) | Fades out at (`--glow-fade`) | Blue / orange strength, dark | Blue / orange strength, light | Wisps        |
| ------------------ | --------------------------------------------- | ---------------------------- | ---------------------------- | ----------------------------- | ------------ |
| Off                | —                                             | —                            | 0 / 0                        | 0 / 0                         | none         |
| Muted              | 58% × 50%                                     | 60%                          | 26% / 20%                    | 30% / 27%                     | none         |
| Standard (default) | 95% × 78%                                     | 74%                          | 29.9% / 23%                  | 42% / 38%                     | none         |
| Vivid              | 120% × 95%                                    | 82%                          | 39% / 30%                    | 54% / 48%                     | 15% / 12.75% |

The strengths are `--glow-a-vrc` and `--glow-a-cvr` (wisps: `--wisp-a-vrc`,
`--wisp-a-cvr`), mixed into `--vrc` and `--cvr`. Off leaves the plain canvas
and the scanlines.

**Background picture.** Settings → Appearance → Background picture puts the
user's own PNG or JPEG behind the whole app. The row shows "Choose picture";
once a picture is kept it shows a 48×28 thumbnail
(`.background-picture-thumb`), "Change picture" and "Remove", and the card
opens a second row, Picture fade: Low, Medium (default) or High.

- `.app-backdrop` is fixed at `z-index: -3`, fills the window and crops the
  picture to cover. `data-app-background` on `<html>` sets `--aurora-floor`
  to transparent so the picture shows through the aurora. Whatever glow level
  the user keeps sits over the picture.
- `.app-backdrop::after` fades the picture toward `--bg-base` by
  `--app-backdrop-fade`: 35%, 55% or 75% in dark and 18%, 34% or 55% in light
  for Low, Medium and High. Light also raises the picture's saturation to
  115%.
- In light only, words set straight on the canvas (`.canvas-text`) get a
  crisp backing: 2 px by 8 px padding, 8 px radius, `--glass-information` at
  78%, and near-solid `--text-dim`. Small buttons on the canvas
  (`.canvas-control`) take the same 78% fill. Dark needs neither.
- A picture the app cannot decode falls back to the normal canvas. The picker
  refuses pictures it cannot use and warns about ones that will crop badly,
  in a line under the row.

Mark any text placed directly on the canvas with `.canvas-text` and any small
button there with `.canvas-control`, or it becomes unreadable over a light
picture. Page titles, section headings, the top-bar counts, and page hints do
this.

Sources: [`main.css`](../src/renderer/src/assets/main.css),
[`useApplyGlow.ts`](../src/renderer/src/hooks/useApplyGlow.ts),
[`AppBackdrop.tsx`](../src/renderer/src/components/AppBackdrop.tsx),
[`BackgroundPicturePicker.tsx`](../src/renderer/src/components/BackgroundPicturePicker.tsx).

## §5 Presence, status, and privacy

Two separate facts describe a friend, and the UI never merges them.

**Presence state** is where they are: `in-game` (in a world), `active`
(online outside the game, such as on the website), or `offline`. The Friends
list groups by it: In-Game, Online, Offline.

**Status** is VRChat's own setting: Join Me, Online, Ask Me, Do Not Disturb.
ChilloutVR has no such setting, so a ChilloutVR friend never shows one.

| Meaning          | Token         | Dark      | Light      | Word on screen |
| ---------------- | ------------- | --------- | ---------- | -------------- |
| Join Me          | `--st-joinme` | `#3aa0ff` | see App. A | Join Me        |
| Online (in game) | `--st-online` | `#43c95a` | see App. A | Online         |
| Ask Me           | `--st-askme`  | `#ff9a3d` | see App. A | Ask Me         |
| Do Not Disturb   | `--st-dnd`    | `#e5484b` | see App. A | Do Not Disturb |
| Active           | `--active`    | `#2dd4bf` | see App. A | Active         |
| Offline          | `--offline`   | `#6b6480` | see App. A | Offline        |
| Live connection  | `--ingame`    | `#34d399` | see App. A | Live           |

Each has a `-text` twin for words in that color.

**The avatar ring.** `Avatar` draws the ring as a `box-shadow` on
`.presence-ring`: 2.5 px wide (1.5 px on the 24 px size). Its color comes
from `ringFor` in [`statusRing.ts`](../src/renderer/src/utils/statusRing.ts):

1. Not in a world: the presence color (`--active` or `--offline`).
2. In a world on VRChat with a status: that status color.
3. Otherwise in a world (every ChilloutVR friend in game): `--st-online`.

Rows also show a 16 px corner dot in the same color (`.status-badge`, with a
2 px `--bg-base` border so it reads as cut out of the avatar). Offline
friends get no dot, and the drawer's 64 px avatar has none. Avatars come in
three sizes: 42 px in rows, 64 px in friend details, 24 px in small lists.
Without a picture, the avatar is the name's first letter on a 10% `--text`
disc. A linked person's avatar is split on the diagonal: VRChat in the
upper-right half, ChilloutVR in the lower-left.

This ring and dot are the one color-only cue in the app (Locked rule 4). The
words are never far: the row opener's accessible name is the friend's name,
the "favorite" mark if starred, the status or presence word, the world, and
the platform; friend details show a status chip with a 10 px dot, the status
word in its color, and a plain description ("Open to joins — hop in freely",
"Around and reachable", "Ask before joining", "Not accepting joins", "Not
connected").

**Custom status text** (VRChat only) is plain `--text-dim` text beside the
name in a row and under the name in friend details. It is never a chip, and
it is hidden for offline friends.

**Privacy (Locked rule 9).** A VRChat friend set to Ask Me or Do Not Disturb
never shows a world or instance:

- no world line, no world picture, no instance pill beyond the neutral
  "Private", no Join;
- not counted toward a hot instance, not named on its card, in its sheet or
  in its accessible name;
- not named with a location in any alert.

Friends whose location the platform itself hides (private, traveling) get the
same neutral treatment. Use the shared helpers `isWorldHidden`,
`isHotInstanceMember`, `hotInstanceKey` and `isFriendJoinable`
([`joinability.ts`](../src/shared/joinability.ts),
[`hotInstanceKey.ts`](../src/shared/hotInstanceKey.ts)); never write a local
copy of the rule.

Sources: [`Avatar.tsx`](../src/renderer/src/components/Avatar.tsx),
[`statusRing.ts`](../src/renderer/src/utils/statusRing.ts),
[`FriendRow.tsx`](../src/renderer/src/components/FriendRow.tsx),
[`FriendDrawer.tsx`](../src/renderer/src/components/FriendDrawer.tsx).

## §6 Instance labels and policy

### §6.1 Instance pills

An instance pill says who may join the instance a friend is in. It is always
a word on a tinted chip, never a color alone.

**Geometry** (`PILL_BASE` in
[`instancePill.ts`](../src/renderer/src/utils/instancePill.ts)): a
`.glass-chip`, 28 px tall, 10 px radius, 1 px border, 12 px side padding,
12 px semibold, one line. In a friend row the pill column is at least 78 px
wide so pills line up.

**Color.** The pill takes its tier's `--op-*` token: the word is the tier's
`-text` twin, the fill is the tier color at `--pill-tint` and the border at
`--pill-edge`.

| Tier token          | VRChat word  | ChilloutVR word     | Dark color |
| ------------------- | ------------ | ------------------- | ---------- |
| `--op-public`       | Public       | Public              | `#3ee36a`  |
| `--op-friends-plus` | Friends+     | Friends of Friends  | `#b7de4f`  |
| `--op-friends`      | Friends      | Friends             | `#e6c353`  |
| `--op-invite-plus`  | Invite+      | Everyone Can Invite | `#ffc172`  |
| `--op-invite`       | Invite       | Owner Must Invite   | `#ffa14e`  |
| `--op-group-public` | Group Public | Group Public        | `#bfa0ff`  |
| `--op-group-plus`   | Group+       | Friends of Members  | `#9d80f6`  |
| `--op-group`        | Group        | Members Only        | `#8d61f0`  |

The scale runs green (most open) through yellow and orange to violet
(group). The neutral pill (`--text-dim` word, `--text` at 7% fill and 16%
border) covers everything without a tier: "Private" for a friend who is in a
world they do not share, ChilloutVR's "Offline Instance", and "Unknown" when
the platform did not say.

**Which words.** The data always keeps the platform's real type. Settings →
Appearance → Instance labels only chooses the words:

| Setting          | Effect                                                     |
| ---------------- | ---------------------------------------------------------- |
| VRChat (default) | Both platforms use the VRChat words for the matching tier. |
| Per platform     | Each friend's pill uses their own platform's word.         |
| ChilloutVR       | Both platforms use the ChilloutVR words.                   |

**Actionable pills.** In a friend row, a joinable friend's pill is a button
named "{access}: Join {name} in {world}". It brightens on hover, dims
slightly on press, shows a 1 px `--text-dim` focus ring, and drops to 50%
opacity while a join is pending. A linked person in two joinable places shows
a "2 locations" button instead (§10). Over a picture, a pill sits on a 78%
card-colored backing so its tint stays readable.

### §6.2 Policy space

A second, never-clickable pill says which moderation context applies:
"Public space" (rose, `--policy-public`), "Private space" (ice blue,
`--policy-private`) or the neutral "Unknown". It uses the instance pill's
geometry and mixes. It appears in the join confirmation, on hot instance
sheets and in a linked person's world details, never in friend rows. A "More
info" link beside it opens one plain sentence about that context.

VRChat's Public and Group Public are public spaces; ChilloutVR's Public,
Friends of Friends, Group Public and Friends of Members are public spaces;
everything else is private. An unknown or impossible type is Unknown, never a
confident claim.

Sources: [`InstancePill.tsx`](../src/renderer/src/components/InstancePill.tsx),
[`instanceTypeLabels.ts`](../src/renderer/src/utils/instanceTypeLabels.ts),
[`PolicySpacePill.tsx`](../src/renderer/src/components/PolicySpacePill.tsx),
[`instancePolicySpace.ts`](../src/renderer/src/utils/instancePolicySpace.ts).

## §7 Typography

VRX ships two typefaces, both as local files in
[`assets/fonts/`](../src/renderer/src/assets/fonts) with their licenses:

- **Inter** (`--font-sans`): one variable file, weights 400 to 800. It sets
  all body text, names, labels and buttons. `body` uses it with antialiasing.
- **VT323** (`--font-mono`): one weight, 400. It is the pixel display face for
  the wordmark, Dashboard section headings, the big Dashboard numbers and the
  welcome setup's step counter. Nothing else uses it.

Both files hold Latin glyphs only. Japanese text falls back to the system's
own fonts, in VT323 headings too, so a Japanese heading is not pixel-styled.
Do not build a layout that depends on VT323's narrow letters.

Measured sizes (computed styles at 900 x 670; the same at every width):

| Text                                 | Size / weight          | Details                                                                                              |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Page title (`h1` in the top bar)     | 25 px / 800            | Line height 37.5 px, `--text`, `.canvas-text`                                                        |
| Dashboard section heading            | VT323 18 px            | Uppercase, 2 px letter spacing, `--text-dim`                                                         |
| Dashboard number                     | VT323 38 px            | Line height 1, tabular digits; label 12.5 px `--text-dim`                                            |
| Wordmark                             | VT323 40 px            | 2 px letter spacing; 64 px in the welcome setup, 36 px on the boot screen, 16 px in the sidebar foot |
| Sidebar page name                    | 13.5 px / 600          |                                                                                                      |
| Sidebar subtitle and foot            | 11 px / 400            | Subtitle has 0.5 px letter spacing, `--text-faint`                                                   |
| Names (rows, tiles, lists)           | 14 px / 600            | One line, cut with an ellipsis                                                                       |
| Setting label                        | 14 px / 500            | Note under it: 12 px `--text-dim`                                                                    |
| World line in a friend row           | 12.5 px / 400          | Fixed 16 px line, `--text-dim`                                                                       |
| Secondary lines, hints, notices      | 12 to 13 px / 400      | `--text-dim`                                                                                         |
| Instance, platform and policy pills  | 12 px / 600            | 28 px tall (§6.1)                                                                                    |
| Friend row platform tab              | 10.5 px / 600          | Vertical, 0.09em letter spacing                                                                      |
| Picture badge ("VRC", "CVR")         | 10 px / 700            |                                                                                                      |
| Small heading in sheets and profiles | 10.5 px / 600          | Uppercase, 1.4 px letter spacing, `--text-dim`                                                       |
| Small heading in friend details      | 10.5 px / 600          | Uppercase, 0.1em letter spacing (1.05 px)                                                            |
| Friends section header               | 12 px / 600            | Uppercase, 0.1em letter spacing                                                                      |
| Segmented option                     | 12.5 px / 600          | The platform filter alone is 700, uppercase, 0.025em                                                 |
| Small button ("Refresh", "Retry")    | 12 px / 400            |                                                                                                      |
| Settings button                      | 13 px / 500            |                                                                                                      |
| Dialog action                        | 14 px / 500 or 600     | 600 on the confirming action                                                                         |
| Hot instance title                   | 25 px / 700 (bar card) | 18 px / 700 on a picture card, 21 px / 700 in the sheet                                              |
| Friend details name                  | 18 px / 700            | Up to two lines                                                                                      |
| Dialog title                         | 16 px / 600            | 18 px / 700 in the linked-friend and profile dialogs                                                 |
| Welcome setup title                  | 25 px / 800            | Line height 1.2; lead text 13 px                                                                     |

Rules:

- Counts, clock times, counters and the Dashboard numbers use tabular digits
  (`tabular-nums`) so they do not shift as they change. Large counts follow
  the app language's number format ("48,213").
- A name never wraps a row. Rows and tiles cut it to one line; friend details
  and the join confirmation allow two lines.
- Japanese: `body:lang(ja)` sets `word-break: auto-phrase` and
  `overflow-wrap: break-word`, so lines break between phrases, not inside
  them. Japanese labels are often longer than the English ones ("ホットインスタンス" for
  "Hot Instances"). Every page was checked in Japanese at 900 x 670; nothing
  overflows sideways.
- Text on the bare canvas (page title, section headings, counts, hints) takes
  `.canvas-text` so it stays readable over a background picture (§4).

Source: [`main.css`](../src/renderer/src/assets/main.css) (font faces and the
`@theme` block), [`i18n/index.ts`](../src/renderer/src/i18n/index.ts).

## §8 Shell, layout and controls

### Window

- The window opens at 900 x 670 (content size) and cannot be made smaller
  than that, or than the screen's work area if that is smaller. Every page
  must work at 900 x 670.
- Title "VRX". The menu bar is hidden and there is no application menu.
- The window background is painted before the page loads and matches
  `--bg-base`: `#08080b` in dark, `#e7ecf3` in light.
- On Windows and Linux, closing the window hides it to the tray. The tray icon
  has the tooltip "VRX" and a menu with "Show VRX" or "Hide VRX", and
  "Quit VRX".

Source: [`src/main/app.ts`](../src/main/app.ts),
[`windowTheme.ts`](../src/main/windowTheme.ts), [`tray.ts`](../src/main/tray.ts).

### What the window shows

[`App.tsx`](../src/renderer/src/App.tsx) picks one of four screens:

1. **Boot screen** (`BootSplash`) until saved settings are read and while the
   sign-in check is pending: a centered `.glass.glass-information` card with
   the wordmark and "Connecting…", which pulses unless motion is reduced.
2. **Welcome setup** (`SetupWizard`, §9.9) while setup is pending. It is shown
   on first run and can be skipped.
3. **The shell** (`AppShell`) as soon as one platform is signed in, or its
   check failed in a way that keeps the session.
4. **Sign-in** (`LoginScreen`, §9.4) when no platform is signed in.

### Shell grid

`AppShell` is a two-column grid that fills the window: `--sidebar-width`
(248 px) and the rest, with `--space-4` (16 px) padding and gap. Measured at
900 x 670: sidebar 248 x 638 at (16, 16); main region 604 x 638 at (280, 16).
At 1280 x 800 the main region is 984 px wide.

- `body` never scrolls. Only `<main>` scrolls, vertically, with a stable
  scrollbar gutter so content does not shift when a scrollbar appears.
- `<main>` has 8 px padding and 40 px at the bottom; on Settings it is 8 px
  all round. Its accessible name is the current page name.
- Changing page resets the scroll position to the top.
- Inside `<main>`, in order: the top bar, recovery notices, then the page.
  Each page sits in an error boundary, so one broken page shows "Something
  went wrong" with "Reload" and "Copy diagnostics" while the sidebar keeps
  working.
- The join confirmation (§9.3) is mounted once, at shell level.

### Sidebar

`<aside class="glass flex flex-col">` with 20 px top and bottom padding and
16 px at the sides. Top to bottom:

1. The wordmark (§1), then "Social VR Companion" in 11 px `--text-faint`.
2. The page list (`<nav>`, named "Main navigation"), 3 px between items, in
   this fixed order: Dashboard, Friends, Hot Instances, Activity, Inbox,
   Explore, Search, Groups, Avatars, Settings.
3. The foot, above a 1 px `--sidebar-foot-border` line: "VRX" in VT323 16 px,
   then "Social VR Companion · v1.4.3" (the version comes from the build).

A page item is a button, 214 x 40 px at the minimum window: 18 px icon, 12 px
gap, 13.5 px / 600 label, 9 px by 11 px padding, radius 12 px.

| State   | Look                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Idle    | `--text-dim` label, no fill, transparent 1 px border                                                                           |
| Hover   | `--surface-hover` fill, `--text` label                                                                                         |
| Current | `--control-active-bg` fill, `--control-active-border` border, `--control-active-shadow`, `--text` label, `aria-current="page"` |
| Focus   | The browser's own focus outline (§11)                                                                                          |

The current page also has a 3 x 20 px rounded spine at the sidebar's left
edge. Its color repeats the platform filter: `--vrc`, `--cvr`, or a
top-to-bottom gradient of both for "ALL". Position marks the current page;
the color is only an echo of the filter.

- **Inbox count.** While Inbox is not the current page and new items are
  waiting, its item ends with a small neutral `.glass-chip` count (11 px /
  600, at least 20 px wide, "99+" above 99). Screen readers hear "3 new". It
  is never colored.
- **Hidden pages.** Settings → Appearance → Sidebar pages can turn off Hot
  Instances, Activity, Inbox, Explore, Search and Groups. Dashboard, Friends,
  Avatars and Settings always show. If the current page is turned off, the
  app goes to the Dashboard.
- **Update button.** Only when an update is available, downloading or ready,
  a 36 px round button sits at the foot's right. On hover or focus it widens
  to 104 px and shows its word: "Update", "Updating…" (or the percent), then
  "Restart". The foot text keeps clear of it.

Source: [`Sidebar.tsx`](../src/renderer/src/components/Sidebar.tsx),
[`NavIcons.tsx`](../src/renderer/src/components/NavIcons.tsx).

### Top bar

One row at the top of `<main>`, 22 px above the page (8 px on Settings):

- **Left:** the page title.
- **Right:** the platform filter, then the counts block, 16 px apart.
- **On Settings** the filter has no use, so the six settings categories take
  its place on a second row of their own, right aligned. Title and counts
  stay on the first row.

**Platform filter.** A segmented control named "Platform filter" with
"VRC", "ALL", "CVR" in that order. "VRC" is always `--plat-vrc-word` and
"CVR" always `--plat-cvr-word`; "ALL" is `--text` when chosen and
`--text-dim` when not. It filters every page and is remembered. Measured:
172 x 41 px.

**Counts block** (`TopBarCounts`, named "Friends and players online"):

- Line 1: a connection dot, then "**13** friends" (13 px, tabular, the number
  in `--text` 600). On Friends the number counts linked people once.
- Line 2, when Player counts is on in Settings: "VRC 48,213 CVR 1,876"
  (12 px; the platform words 11 px / 700 in the platform word colors). Only
  the filtered platforms show.
- Hover or keyboard focus opens a 272 px `.glass.glass-information` panel
  under it: "13 friends online", the connection sentence ("VRChat: Live;
  ChilloutVR: Live"), then "Playing right now" with one line per platform and
  the note "As each platform reports it. Checked at most every 5 minutes."
  Escape closes it. It is a description, not a dialog.

**Connection dot** (8 px). The shape repeats the color:

| Worst state among signed-in platforms | Shape                       | Color       | Word           |
| ------------------------------------- | --------------------------- | ----------- | -------------- |
| Live                                  | Filled circle, soft glow    | `--ingame`  | "Live"         |
| Reconnecting                          | Hollow ring (2 px border)   | `--warning` | "Reconnecting" |
| Down, or nothing signed in            | Filled square (1 px radius) | `--error`   | "Down"         |

The live dot pulses only while the window has focus and motion is allowed,
and never on Linux. A platform that is not signed in reads "Signed out" or
"Needs code" in the sentence.

Source: [`TopBar.tsx`](../src/renderer/src/components/TopBar.tsx),
[`TopBarCounts.tsx`](../src/renderer/src/components/TopBarCounts.tsx).

### Recovery notices

Between the top bar and the page, one line per problem, each a
`.glass.glass-layer` strip (12 px text, `--text-dim`) with a small bordered
button:

| Problem                             | Words                                                                                                       | Actions                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| Platform cannot be reached          | "Can't reach {platform} right now — your session is safe."                                                  | "Retry"                  |
| Platform wants a sign-in code       | "{platform} needs a sign-in code."                                                                          | "Go to Accounts"         |
| The platform signed the person out  | "⚠" in `--error`, then "{platform} signed you out. Sign in again to see your {platform} friends."           | "Go to Accounts", "Hide" |
| Settings could not be saved or read | For example "Settings could not be saved. Your changes are still applied here, but may be lost on restart." | "Retry saving settings"  |

A sign-out the person did not ask for is announced as an alert. The same
sentence opens the sign-in screen when no platform is left (§9.4).

Source: [`RecoveryNotices.tsx`](../src/renderer/src/components/RecoveryNotices.tsx).

### Settings layout

Settings shows one category at a time: Appearance, Dashboard, Behavior,
Notifications, Accounts, About. The category is kept for the session only.
The page is one `.glass.glass-panel` with 8 px padding holding a column of
`.setting-card` rows 8 px apart (`.settings-cards`).

**No category scrolls at 900 x 670.** This was measured for all six
categories in English and Japanese: the main region's scroll height equals
its height (638 px). A new setting must keep that true: put it in the
category with room, or behind a disclosure. §9.8 lists every setting.

### Shared controls

**Segmented control** ([`SegmentedControl.tsx`](../src/renderer/src/components/SegmentedControl.tsx)).
One choice from a short list.

- Track: `.glass` with 4 px padding and 2 px between options. It takes the
  glass 20 px radius.
- Options: buttons with `role="radio"`, 12.5 px / 600, 6 px by 13 px padding,
  no fill of their own. Chosen `--text`, others `--text-dim`, unless the
  caller gives fixed word colors.
- The choice is shown by one sliding bubble (`.segmented-bubble`,
  `--seg-bubble-bg` with `--seg-bubble-shadow`, radius 16 px), measured from
  the chosen button. It slides in 200 ms; with reduced motion it jumps.
- Keyboard: one Tab stop on the chosen option. Left and Up choose the previous
  option, Right and Down the next, wrapping round; the choice applies at
  once.
- Disabled: 50% opacity and a not-allowed cursor; the options stay readable.
- Measured height 41 px. Three short options take about 196 px.

**Toggle** ([`Toggle.tsx`](../src/renderer/src/components/Toggle.tsx)). A
segmented control with the two words "On" and "Off". VRX has no switch
graphic and no checkbox for settings: the chosen word is the state.

**Number stepper** ([`NumberStepper.tsx`](../src/renderer/src/components/NumberStepper.tsx)).
A `.glass` capsule with "−", the value (12.5 px / 600, tabular, at least
36 px wide) and "+". The round 24 px buttons have an 8% `--text` fill, 14% on
hover; at a limit the sign turns `--text-faint`. The value is the one Tab
stop (`role="spinbutton"`): arrow keys change it, Home and End jump to the
limits.

**Buttons.** See Appendix B.4 for the classes.

| Kind              | Look                                                                                                       | Used for                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Quiet             | `--control-fill` fill, no border, `--text-dim` word, 12 px, radius 12 px                                   | "Refresh", "Avatars", "See all 3", "Copy link"       |
| Bordered          | 1 px `--border`, `--control-fill` or no fill, `--text` word                                                | "Cancel", "Retry", "Sign out", settings actions      |
| Confirm (neutral) | `--control-fill-hover` fill, `--control-active-border` border, 600                                         | "Accept", "Add friend"                               |
| Join              | `--op-public` word on a 16% tint with a 45% edge                                                           | "Join" everywhere                                    |
| Platform          | 1 px `--vrc` or `--cvr` border, 16% fill of the same color, word in `--plat-vrc-word` or `--plat-cvr-word` | "Connect" on an account card, "Save" in Edit profile |
| Platform, solid   | Solid `--vrc` or `--cvr` with `--text-on-vrc` or `--text-on-cvr`                                           | "Sign in" and "Verify" on the sign-in screen only    |
| Setup primary     | Solid `--text` fill with `--bg-base` word                                                                  | "Get started", "Continue", "Open VRX"                |
| Destructive       | `--error` word on a faint `--error` tint                                                                   | "Unfriend", "Block", "Unlink"                        |
| Round icon        | 32 px `.glass` circle                                                                                      | "?", favorite star, alerts bell                      |
| Close             | 28 px, radius 9 px, "✕" in `--text-dim`, `--surface-hover` on hover                                        | Sheets, friend details, dialogs                      |

Disabled buttons drop to 40 to 60% opacity. A button that is busy keeps its
place and changes its word ("Refreshing…", "Joining…", "Signing in…").

**Text fields.** Radius 12 px, 1 px `--border`, `--control-fill` fill, 14 px
text (13 px in small dialogs), placeholder in `--text-faint`. The Friends
search field is a `.glass-layer` field with a "Clear search" button inside
its right end.

**Help.** A 32 px round "?" button opens a plain `.glass.glass-layer` text
panel in the page. It is never a tour and never opens by itself.

### Focus, keyboard and motion

- Focus is always visible. Cards, rows, tiles, round buttons and the counts
  block draw a 2 px `--text-dim` ring; small buttons, fields and close
  buttons a 1 px ring. Sidebar items, segmented options and the stepper value
  keep the browser's own outline (§11).
- `/` moves focus to the Friends search field, unless focus is in a text
  field or the join confirmation is open.
- Escape closes the open sheet, friend details, menu or dialog and returns
  focus to what opened it.
- A held Enter key counts once: only its first keydown presses a button or
  sends a form, so a held key cannot repeat a join, a favorite or a sign-in.
  Text areas still take repeated new lines.
- Motion is opt-in for the system: every transition is behind
  `motion-safe:` or a `prefers-reduced-motion: no-preference` query. With
  reduced motion, panels appear and disappear without movement.
- Scrollbars are 9 px, with a fully rounded `--scrollbar-thumb` thumb and no
  track.
- Windows High Contrast (forced colors): focus gets a 2 px `Highlight`
  outline, the segmented bubble and current sidebar page are painted with
  `Highlight`, and the presence ring and status dot keep their own colors.

Source: [`AppShell.tsx`](../src/renderer/src/components/AppShell.tsx),
[`installHeldEnterGuard.ts`](../src/renderer/src/installHeldEnterGuard.ts),
[`main.css`](../src/renderer/src/assets/main.css).

## §9 Component behavior

Each part below gives the anatomy, the words on screen, the states and the
source files. Sizes are measured at 900 x 670 unless a width is named.

### §9.1 Friends, Dashboard, and Hot Instances

#### Friends page

The page is one back panel: a `<section>` with `.glass-panel`, the 20 px
panel radius, a 1 px `--glass-border` border and 16 px padding (579 px wide
at the minimum window). The `.glass-panel` class here supplies only the
blurred backing; this section does not also take `.glass`.

**Header row.** Left: the Order control, a segmented control named "Order
inside each group" with "Name", "Recent", "World", "Joinable". Right: a
people count ("15 people", only when linked friends exist, since linked
people count once) and a quiet "Refresh" button.

- Order never moves a friend between sections. Name is A to Z, compared as
  the names are shown, ignoring spaces at either end. Recent puts
  the friend with the newest Activity entry first. World puts friends who
  share an instance together, the biggest group first. Joinable puts the
  most open joinable instance first, in the order of the access ladder
  (§6.1). Ties fall back to the name.
- "Recent" is offered only while the Activity page is on; with it off, a
  saved Recent choice shows as Name.

**Search.** A full-width field, "Search friends", 38 px tall. Typing filters
after 200 ms across both platforms and a linked person's other names.
Matching letters get a 16% `--text` highlight behind them. While a search is
active every section is open and its header cannot collapse. A linked person
found by another of their names shows that name beside the row name. A
"Clear search" button (24 px) appears inside the field's right end.

**Sections.** In this order: "Favorites (3)", "In-Game (n)", "Online (n)",
"Offline (n)".

- A section header is a full-width button: `.glass-layer`, radius 12 px,
  24 px tall, a 14 px chevron then the label in 12 px / 600 uppercase. The
  chevron points down when open and turns to point right when collapsed.
  Hover lightens the fill by 8% `--text`.
- Collapsed sections are remembered. Offline starts collapsed.
- The header of the section being read sticks to the top of the list while
  its rows scroll under it.
- **Favorites** lists favorite friends who are in a game right now. They also
  stay in In-Game: Favorites is a shortcut, not a move. With no favorite in a
  game the section is absent.
- **Favorite groups.** When those favorites sit in more than one place,
  Favorites splits under small sub-headings: each of the account's own
  favorite groups that has someone in a game ("Besties · VRC (2)", VRChat's
  groups first in the account's order, then ChilloutVR's categories), then
  "Starred in VRX (1)" for friends starred only in VRX. A sub-heading is plain
  words in 11.5 px / 600 `--text-dim`, never a chip or a button: the group's
  name, the platform as a word, and the count. A friend shows once, under the
  first group that holds them. With one place only, Favorites stays one plain
  list. Sub-headings fold away with the section and do not collapse on their
  own.

**Row** (`FriendRow`). 60 px tall, 4 px between rows, radius 13 px. A
four-column grid, `14px 42px 1fr auto` with a 12 px gap, padding 8 px top and
bottom, 10 px left, 12 px right. The row is a `.platform-row` with the
modifier for its platform (§3), so it has the platform's wash and soft edge.

| Column       | Content                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform tab | A 21 x 52 px `.glass-chip` with "VRC", "CVR" or "VRX" written bottom to top, in the platform rail colors                                                                                                                                 |
| Avatar       | 42 px, with the presence ring and the 16 px status dot (§5). This is the button that opens details                                                                                                                                       |
| Text         | Line 1: name (14 px / 600, at most 68% of the line), a 12 px `--favorite` star for a favorite, then custom status text in 12 px `--text-dim`. Line 2: world name, 12.5 px `--text-dim`, fixed 16 px tall so every row is the same height |
| Access       | The instance pill (§6.1), at least 78 px wide, centered. Empty for friends who are not in a game                                                                                                                                         |

- Custom status text is plain text beside the name, never a chip. It shows
  for VRChat friends who are not offline.
- A joinable friend's pill is a button (§6.1). If a join cannot go ahead, a
  12 px `--text-dim` line under the row says why.
- A friend in a game whose world is hidden shows the neutral "Private" pill
  and no world name.
- An unknown world reads "Unknown World".

**Row states.**

| State          | Look                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- |
| Hover          | `--surface-hover` fill over the wash. Pointer cursor when the whole card opens details       |
| Keyboard focus | 2 px `--text-dim` ring round the row, 2 px away from it, plus the same ring on the avatar    |
| Join pending   | The pill dims to 50%                                                                         |
| Unavailable    | A plain bordered 60 px row reading "Unavailable", for a linked account whose data is missing |

**Opening details.** By default a press anywhere on the row opens friend
details (§9.2), except on the pill, and except when the press ends a text
selection. Settings → Behavior → "Friend details open from" can limit this
to the avatar. The avatar button is always the keyboard way in.

**Keyboard.** The list is one Tab stop. Up and Down move between rows; Enter
or Space on a row opens details; Tab moves on to the row's pill. The row
announces its name, "favorite" when it is one, its status, its world and its
platform. `/` focuses the search field.

**List states.**

| State                       | What shows                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Checking sign-in, loading   | "Loading…" in 14 px `--text-dim`                                                                              |
| No platform connected       | A `.glass.glass-layer` card: "Connect VRChat to see your friends here" and "Go to Accounts"                   |
| Nothing loaded              | "Could not load friends" in `--error`                                                                         |
| One platform failed         | Above the list: "VRChat friends could not load. This list is missing them." in `--error`, with "Retry VRChat" |
| One platform is out of date | "VRChat friends could not refresh. Showing the last loaded list." in `--text-dim`, with the same button       |
| No friends                  | "No friends yet"                                                                                              |
| Search finds nothing        | "No friends match your search", with no empty section headers under it                                        |

The list is virtual: only rows near the window are in the page, so it stays
quick with thousands of friends.

Source: [`FriendsList.tsx`](../src/renderer/src/components/FriendsList.tsx),
[`FriendRow.tsx`](../src/renderer/src/components/FriendRow.tsx),
[`FriendsSectionHeader.tsx`](../src/renderer/src/components/FriendsSectionHeader.tsx),
[`FriendsSourceNotice.tsx`](../src/renderer/src/components/FriendsSourceNotice.tsx),
[`Avatar.tsx`](../src/renderer/src/components/Avatar.tsx),
[`friendSort.ts`](../src/renderer/src/utils/friendSort.ts).

#### Dashboard

Top to bottom:

1. **Numbers.** A row of equal `.glass.glass-layer` cards, 14 px apart,
   padding 16 px by 18 px: "Friends online", "In game right now" and, while
   Hot Instances is on, "Hot instances". Each is a VT323 38 px number over a
   12.5 px label. Three cards are 184 x 95 px each at the minimum window.
2. **Sections**, in the order set in Settings → Dashboard → Sections. The
   four sections are "Wearing now", "Latest invites", "Popular now" and
   "Hot Instances". Each can be turned off.
3. A quiet "Settings" button at the bottom right. It opens Settings →
   Dashboard.

A section heading is VT323 18 px, uppercase, 2 px letter spacing,
`--text-dim`, with 24 px above it and 12 px below. Any button for the
section sits on the same line at the right.

**Wearing now** and **Latest invites** are the two glance sections. When
they are neighbors in the order they share one row, two equal columns
14 px apart; under 520 px of content width they stack. A lone glance
section fills the row and lays its two platform rows side by side.

- Wearing now: one `.platform-row` per platform, 78 px tall: a 60 x 45 px
  avatar picture (radius 8 px), the avatar name (14 px / 600) and the
  platform pill. A row opens the Avatars page. The heading has an "Avatars"
  button. A platform that is loading, failed or not connected says so in its
  row, with "Try again" or "Go to Accounts".
- Latest invites: the newest invite from each platform since VRX opened,
  one `.platform-row` each: sender name and platform pill, then the action
  and its age ("Invited you to {world} · Just now") in 12 px. A row opens
  the Inbox. With more waiting, the heading has "See all 5". With none, one
  neutral row reads "No invites since VRX opened".

**Popular now** shows the busiest public worlds from Explore (§9.4).
**Hot Instances** shows instances where friends have gathered.

- Whichever of these two comes first in the order shows **picture cards**;
  the other shows **bar cards**. With "Hide empty sections" on, if the first
  has nothing to show, the other takes the picture cards.
- Count (Locked rule 7): a bar-card section shows two cards. A picture-card
  section shows two, or one whole row when the window is wide enough for
  three or more columns.
- Hot Instances picks one instance per platform first, so both platforms
  appear when both have one.
- The Hot Instances heading line holds "See all 4" (when the Hot Instances
  page is on), the label "Min. friends", a number stepper from 1 to 10
  (default 2) and a "?" help button.
- Empty Hot Instances: a `.glass.glass-layer` card at least 180 px tall,
  "No hot instances currently" (14 px / 600 `--text-dim`) and "When 2 or more
  friends gather in the same instance, it'll show up here." With "Hide empty
  sections" on, the whole section is absent instead.

Page states: "Loading…"; "Could not load your friends right now" in `--error`
with "Retry"; the not-connected card (Appendix B.7); and the same per-platform
source lines as Friends, worded "…so they are left out here."

Source: [`DashboardView.tsx`](../src/renderer/src/components/DashboardView.tsx),
[`DashboardGlance.tsx`](../src/renderer/src/components/DashboardGlance.tsx),
[`ExploreDashboardPreview.tsx`](../src/renderer/src/components/ExploreDashboardPreview.tsx),
[`HotInstancesHeader.tsx`](../src/renderer/src/components/HotInstancesHeader.tsx).

#### Hot instance cards

Both layouts are `.glass.glass-layer` with `.tint-vrc` or `.tint-cvr` and
`.glass-hover`. The whole card opens the hot instance sheet (§9.3); the world
name is the button for keyboard users and is named "{world} hot instance
details". When that button has keyboard focus the card shows a 2 px
`--text-dim` ring.

**Bar card** (112 px tall at the minimum window; one column under 620 px of
content width, two above; a lone card fills the row):

- Top left: the world name, 25 px / 700, one line.
- Top right: the instance pill. When a friend there can be joined it is the
  join button.
- Bottom left: up to four friend names in 13.5 px `--names-lift`, then
  "+3" in bold `--text` for the rest. Names are plain text.
- Bottom right: the platform pill.
- With a world picture: the picture fills the card behind a left-to-right
  veil of the opaque card color (90% to 62%) and the platform tint. The
  pills then sit on a 78% card-color backing.

**Picture card** (two columns from 440 px of content width; three from
1480 px; one more column every 720 px after that):

- A 16:7 picture on top (`.glass-clip-top`), with a "VRC" or "CVR"
  `.glass-chip` badge at its top left (10 px / 700).
- Under it, 12 px padding: the world name (18 px / 700) with the instance
  pill on the same line, then the names line.

**Hot Instances page.** The same header line without "See all", then every
hot instance as picture cards in `.hot-grid.hot-grid--picture`. The empty
card is the same as on the Dashboard. The help panel reads "Hot Instances
show friends together in the same instance. Only in-game friends with
visible locations count…" and explains the stepper.

Source: [`HotInstanceCard.tsx`](../src/renderer/src/components/HotInstanceCard.tsx),
[`HotInstancesView.tsx`](../src/renderer/src/components/HotInstancesView.tsx),
[`CardPictureBackdrop.tsx`](../src/renderer/src/components/CardPictureBackdrop.tsx).

### §9.2 Friend details

Friend details is a panel that slides in from the right
([`FriendDrawer.tsx`](../src/renderer/src/components/FriendDrawer.tsx)). It
is `.glass.glass-sheet`, 372 px wide, 14 px from the top, right and bottom
of the window (372 x 642 px at the minimum window), radius 20 px. It slides
in 260 ms; with reduced motion it appears at once.

**It is not modal.** A soft scrim (`--scrim-soft`) dims the window for depth
only and takes no clicks. The list behind stays usable.

- Pressing another friend's row or avatar switches the panel to that friend.
- Pressing anywhere else outside closes it. So do "✕" and Escape.
- Pressing a join pill outside closes the panel and then joins.
- Focus moves to "✕" when the panel opens and returns to the friend's row
  when it closes.

**Content, top to bottom** (16 px padding, 16 px between blocks):

1. **Header.** A 64 px avatar with the presence ring. The name, 18 px / 700,
   up to two lines. Custom status text under it, 12.5 px `--text-dim`, plain
   text. Then a 24 px platform chip ("VRChat" or "ChilloutVR"). A linked
   person shows one small button per account instead (§10).
2. **Status.** A full-width chip tinted in the status color (10% fill, 30%
   edge): a 10 px dot, the status word in 14 px / 700 in the status text
   color, and a plain description at the right in 12 px `--text-dim`:

   | Status         | Description                     |
   | -------------- | ------------------------------- |
   | Join Me        | "Open to joins — hop in freely" |
   | Online         | "Around and reachable"          |
   | Ask Me         | "Ask before joining"            |
   | Do Not Disturb | "Not accepting joins"           |
   | Offline        | "Not connected"                 |

3. **Where**, only while the friend is in a game: the small heading "WHERE",
   then the world picture (338 x 190 px, radius 12 px) with the instance pill
   and the world name over its lower edge. A hidden world shows the word
   "Hidden" and no picture.
4. **Join**, only when the friend can be joined: a full-width "Join" button
   (38 px tall, the Join look from §8) and a 12 px status line under it for
   "why not" messages.
5. **Notes.** The heading "NOTES (YOURS, PRIVATE)", a four-row text area with
   the placeholder "Add a private note…", and a line under it with the
   account-note state at the left and the counter "128/500" at the right.
   A note saves when focus leaves the field and when the panel closes or
   switches friend.
6. **Trust** (VRChat only): "Trust: Known User" in 12 px `--text-dim`.
7. **Show full profile.** A quiet button. It opens, in place, the profile for
   each account (bio, pronouns, rank, badges, with worlds and groups behind
   their own "Show worlds" and "Show groups" buttons) and the friend actions
   from §9.7. Under the rank it lists the User ID with "Copy link" beside it
   (§9.3). Nothing here is fetched until the button is pressed.
8. **Foot row**, pinned at the bottom: "Identities" at the left (§10), then
   the favorite star and the alerts bell at the right, both 32 px round
   `.glass` buttons.

**Account-note states.** With "Save notes to my accounts" on in Settings,
the line under the note says where the note is:

| State                        | Words                                                                                                            | Action                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Saved to the account         | "Also saved to your VRChat account"                                                                              |                                    |
| Saving                       | "Saving to your VRChat account…"                                                                                 |                                    |
| Not sent yet                 | "Only on this PC so far."                                                                                        | "Save to VRChat"                   |
| Too long for the platform    | "Only on this PC: VRChat keeps notes up to {max} characters."                                                    |                                    |
| Platform unreachable         | "Couldn't reach VRChat. Saved on this PC."                                                                       | "Save to VRChat"                   |
| Platform asked to slow down  | "VRChat asked VRX to slow down. Saved on this PC; try again in a minute."                                        |                                    |
| The account has another note | A bordered box: "Your VRChat account has a different note for this friend:", that note quoted, up to three lines | "Use the VRChat note", "Keep mine" |

A note that fails to load or save shows a bordered alert line with a bold
"!" in `--error` and "Retry". Over 500 characters the note says "This note
is over 500 characters. Shorten it to save your changes."

**Favorite star.** An outline star in `--text-dim` when off; a filled star in
`--favorite` when on, so shape and color both change. Pressing it opens the
Favorite panel above it: a 300 px `.glass.glass-information` panel (radius
16 px) with:

- "VRX": one choice, "Star in VRX (this PC only)".
- "VRChat favorites" or "ChilloutVR favorites": the account's own favorite
  groups, each with its fill ("1/150"). This part shows only with "Use my
  game favorites" on; otherwise it reads "Game favorites are off in
  Settings." with a "Settings" link.
- A choice is a row with a 16 px box that shows "✓" in `--favorite` when
  chosen.
- Messages, in 12 px: loading, "Couldn't load your …" with "Try again", "No
  groups yet. Make one in the game, then check back.", "VRChat keeps a
  favorite in one group…", "That group is full…", "That was a lot of changes
  at once. Wait a moment, then try again."

A linked person has one star for both accounts.

**Alerts bell.** A bell in `--text-dim`, `--text` when alerts apply to this
friend. Pressing it swings the bell and opens the Alerts panel (340 px, same
material):

- With "Who alerts you" set to Everyone: "Every friend can alert you. To
  pick only some friends, change Who alerts you in Settings."
- With it set to Picked friends: an "Alert me about this friend" row with an
  On/Off toggle.
- Then the three friend alerts as small chips: "✓ Comes online",
  "– Joins a world", "– Goes offline". An alert that is off has the dash
  and `--text-faint` words; screen readers hear "(on)" or "(off)". When all
  three are off the line reads "Friend alerts are all off."
- A link, "Alert settings →", opens Settings → Notifications.

Both panels spring open from their button (320 ms) and their lines follow one
after another; with reduced motion they simply appear. Escape or a press
outside closes them.

Source: [`FriendDrawer.tsx`](../src/renderer/src/components/FriendDrawer.tsx),
[`AccountNoteStatus.tsx`](../src/renderer/src/components/AccountNoteStatus.tsx),
[`FavoriteStar.tsx`](../src/renderer/src/components/FavoriteStar.tsx),
[`FavoriteMenu.tsx`](../src/renderer/src/components/FavoriteMenu.tsx),
[`FriendAlertBell.tsx`](../src/renderer/src/components/FriendAlertBell.tsx),
[`LinkedWorlds.tsx`](../src/renderer/src/components/LinkedWorlds.tsx).

### §9.3 Confirmation and sheets

#### Join confirmation

Joining a friend's instance asks first, unless "Confirm before joining" is
off in Settings. The dialog is the one true modal in the shell
([`JoinConfirmDialog.tsx`](../src/renderer/src/components/JoinConfirmDialog.tsx)).

- **Material.** A `--scrim-soft` scrim over the whole window, and a centered
  `.glass.glass-frosted-heavy.glass-information` panel, 400 px wide, 24 px
  padding, 12 px between blocks, radius 20 px. It is opaque so the text is
  never read through blur.
- **Title row.** "Join this Public instance?" (16 px / 600; "Join this
  instance?" when the access is unknown). At the right, stacked: the
  platform pill and the instance pill.
- **Context.** "{name} is in {world}" in 14 px `--text-dim`, up to two lines.
- **Policy.** The policy space pill (§6.2) and a dotted-underline "More
  info" link that opens one sentence.
- **Who is here.** Small avatars of friends in that instance, then "+N".
- **Notes** in 12 px, only when they apply: "VRChat chooses VR or desktop
  from its own launch settings.", "Will launch in VR.", "Will launch on
  desktop.", and the note for a game that is already open.
- **ChilloutVR launch mode.** When Settings says "Always ask", a segmented
  control named "Launch mode": "VR", "Desktop".
- **Actions**, right aligned: "Cancel" (bordered, 14 px / 500) and "Join"
  (the Join look, 14 px / 600). Both are 38 px tall.
- **Foot.** "Don't ask again (turn it back on in Settings → Behavior)" as an
  11 px link.

Behavior:

- Focus starts on "Cancel" and is kept inside the dialog. Escape and a press
  on the scrim cancel.
- While the join is being sent, "Join" reads "Joining…", both buttons are
  held and Escape does nothing.
- If the friend moves while the dialog is open, it does not join the old
  place. It says "{name} moved to a different instance — review before
  joining" with "Review updated location", or "Waiting for updated
  location…", or "{name} is no longer available to join."
- Joining a public room from Explore uses the same dialog, with "{n} people"
  or "Count unknown" in place of the friend line.

#### Other confirmations

| Where                    | Kind                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Unfriend, Block, Unblock | A 400 px alert dialog on the heavier `--scrim` (§9.7)                                                                          |
| Sign out of a platform   | In the account card itself: "Sign out of VRChat?" with "Sign out" and "Cancel" (§9.8)                                          |
| Set as home world        | In the world sheet itself: "Make this your VRChat home world? It replaces the one you have now." with "Make home" and "Cancel" |
| Link or unlink a friend  | Inside the Identities dialog (§10)                                                                                             |

A confirmation always names what will change and where ("on VRChat"). The
safe choice gets first focus.

#### Bottom sheets

Four sheets rise from the bottom of the content area: the hot instance
sheet, the Explore world sheet, the avatar sheet, and the person and group
sheet. They share one frame.

- **Frame.** `.glass-sheet`, fixed to the bottom, spanning the content area
  only (from `--content-inset-left` to `--content-inset-right`, so the
  sidebar stays clear): 604 px wide at the minimum window. Top corners 20 px,
  bottom corners square, a 1 px top border. Its fill is the opaque card
  color behind a blur.
- **Scrim.** `--scrim-soft` over the content area only. It takes no clicks.
- **Not modal.** The page behind stays usable; pressing another card
  switches the sheet. "✕" (top right), Escape and a press outside close it.
  Focus moves to "✕" when the sheet opens and returns to the card that
  opened it.
- **Two heights.** A sheet opens collapsed and can expand to the window
  height less 64 px (606 px at the minimum window). Every reopen starts
  collapsed.

  | Sheet            | Collapsed height                        |
  | ---------------- | --------------------------------------- |
  | Hot instance     | 360 px (or 34% of the window if taller) |
  | Avatar           | 360 px (or 34% of the window if taller) |
  | Explore world    | Up to 55% of the window (368 px at 670) |
  | Person and group | 360 px up to 72% of the window          |

- **Grab bar.** A full-width button at the top holding a 44 x 4 px rounded
  bar in `--border`. Hover widens it to 52 px in `--text-faint`; while
  dragged it is 56 px in `--text-dim`. It is named "Show more" or "Show
  less", with the tooltip "Drag up or click for more" or "Drag down or click
  for less".
  - Click, Enter or Space toggles. Up expands. Down collapses.
  - Dragging 56 px or a quick flick changes the state; less snaps back.
    Dragging a collapsed sheet down 72 px closes it.
- **Motion.** Height and slide take 220 ms with
  `cubic-bezier(0.32, 0.72, 0.29, 1)`. While dragged the sheet follows the
  pointer with no transition. The extra facts fade up in 260 ms. Reduced
  motion removes all of it.

**Hot instance sheet** ([`HotInstanceSheet.tsx`](../src/renderer/src/components/HotInstanceSheet.tsx)):

- A world picture banner (radius 12 px; it grows when the sheet expands) with
  the world name over its lower left (21 px / 700), the instance pill and
  platform pill under the name, and "Join" at the lower right when a friend
  there can be joined.
- Under it: the policy space pill (§6.2), then "FRIENDS HERE — 4" and each
  friend as a small avatar with the name in 12.5 px, inside a rounded
  bordered capsule (`--border` edge, `--control-fill` fill; see §11).
- At the right: for a group instance, the group's banner (200 x 80 px)
  named "Hosted by {group}".
- Expanded, "ABOUT THIS INSTANCE" adds a two-column list: People here,
  Friends here, Region, Access, Group, Instance ID. A value the platform
  does not give reads "Not shown".

**Copy link.** An ID in a sheet's expanded list has a quiet "Copy link"
button beside it ([`CopyLinkButton.tsx`](../src/renderer/src/components/CopyLinkButton.tsx)):
Instance ID in the hot instance sheet, World ID in the world sheet, User ID
in the person sheet and in friend details under "Show full profile". It puts
a link to that person, world or instance on the clipboard and VRX opens
nothing. The button's word says what happened for 2 seconds, "✓ Copied" or
"Couldn't copy", so the result never depends on color. VRChat links are its
website pages; ChilloutVR links open the page in the game. An ID with no
valid link shows without the button.

The world, avatar, and person and group sheets are described with their
pages in §9.4 and §9.7.

Source: [`useSheetExpansion.ts`](../src/renderer/src/hooks/useSheetExpansion.ts),
[`SheetGrabBar.tsx`](../src/renderer/src/components/SheetGrabBar.tsx),
[`SheetFacts.tsx`](../src/renderer/src/components/SheetFacts.tsx).

### §9.4 Explore, loading states and sign-in

#### Explore page

Explore lists public worlds from both platforms.

- **Top row.** Left: a segmented control named "Which worlds to show" with
  "Popular now", "New", "Recently updated", "Favorites". Right: a quiet
  "Refresh" button that reads "Refreshing…" while it works.
- **Hint line** under it, one plain sentence per list: "The busiest public
  worlds on each platform right now.", "The newest public worlds on each
  platform.", "Public worlds their creators updated most recently.", "Worlds
  you starred in VRX, then the favorites in your game accounts."
- **Popular now** also has a "Worlds shown" number stepper (2, 4 or 6;
  default 4). The count is rounded up to whole rows, so a row is never left
  half empty.
- **Grid.** `.picture-grid` inside `.picture-gridwrap`: two columns from
  440 px of content width, three from 1480 px, one more every 720 px after
  that, 16 px apart.

**World card** ([`ExploreWorldCard.tsx`](../src/renderer/src/components/ExploreWorldCard.tsx)).
The picture card matches the hot instance picture card: `.glass.glass-layer`
with the platform tint and `.glass-hover`, a 16:7 picture with a "VRC" or
"CVR" badge, the world name (18 px / 700, one line), "People: **16**" in
12 px, and the words "View rooms". The whole card is one button named
"{world} on {platform}. View rooms". Focus draws a 2 px `--text-dim` ring.
On the Dashboard, when Popular now takes bar cards, the card uses the bar
layout: name in 25 px / 700, a neutral "View rooms" pill, the people count
and the platform pill.

**Source lines.** Above the grid, per platform when something is off:
"Worlds loading…"; "{platform} worlds could not load." in `--error`;
"{platform} discovery is unavailable."; "{platform} results may be out of
date." in `--text-dim`; each failure with a retry button. Missing is red,
stale is dim (Locked rule 5).

**Empty.** "No worlds to show right now."; on Favorites, "No favorite worlds
yet. Open a world and press the star to keep it here."

**World sheet** ([`ExploreWorldSheet.tsx`](../src/renderer/src/components/ExploreWorldSheet.tsx)),
in the shared sheet frame (§9.3):

- The world picture (radius 13 px), then the world name (20 px / 700) with
  the world's favorite star beside it, and the platform pill.
- "Set as home world", a small button. It asks in place: "Make this your
  {platform} home world? It replaces the one you have now." with "Make home"
  and "Cancel". Afterwards it reads "Your home world".
- On VRChat only, **Like** and **Dislike** for the signed-in user's own
  rating. The sheet reads it when it opens. Pressing the choice already
  shown clears it. While that request runs, both buttons stay disabled.
  A failed change puts the previous rating back and shows a short error
  that clears on its own. ChilloutVR has no world rating, so those buttons
  are not on a ChilloutVR sheet. There is no public like count.
- "Visible public rooms", then one bordered row per room (radius 13 px,
  `--control-fill`): the instance pill, the people count ("3 / 30"), the
  region, and a "Join" button. A room that cannot be joined keeps the
  button's place with a plain word instead: "Full", "Restricted",
  "Unavailable", "Refresh first", "Disabled", or "Joining…".
- Room states: "Loading visible public rooms…", "Visible public rooms could
  not load." (`--error`), "No visible public rooms are available.", "Only
  some visible public rooms are available."
- Expanded, "ABOUT THIS WORLD" lists Creator, Description, Tags, Room size,
  People now, Room regions, Last checked and World ID, with "Copy link"
  beside the ID (§9.3). The same lines in the same order on both platforms.
  Tags are plain words joined by the language's list separator, never chips.
  VRChat lists the creator's own tags only. ChilloutVR sets the size per
  room, so its Room size comes from the visible rooms when they agree. A
  line the platform does not give reads "Not shown".

Joining a room goes through the join confirmation (§9.3).

Source: [`ExploreRoute.tsx`](../src/renderer/src/components/ExploreRoute.tsx),
[`ExploreView.tsx`](../src/renderer/src/components/ExploreView.tsx),
[`ExploreLists.tsx`](../src/renderer/src/components/ExploreLists.tsx),
[`ExploreFavorites.tsx`](../src/renderer/src/components/ExploreFavorites.tsx),
[`ExploreSourceState.tsx`](../src/renderer/src/components/ExploreSourceState.tsx),
[`HomeWorldControl.tsx`](../src/renderer/src/components/HomeWorldControl.tsx),
[`WorldRatingControl.tsx`](../src/renderer/src/components/WorldRatingControl.tsx).

#### Loading, empty, error and stale

These rules hold on every page.

| State             | Rule                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading           | One plain line in 14 px `--text-dim` ("Loading…", "Loading activity…"). No skeleton screens and no spinner page. A picture that is on its way shows its box breathing softly (`.picture-waiting`) and then fades in (`.picture-arrive`) |
| Empty             | A short sentence that says what will appear here, in a `.glass.glass-layer` card or as a plain line                                                                                                                                     |
| Error             | The sentence in `--error`, with a retry button beside it. Never color alone: the words say what failed                                                                                                                                  |
| Stale             | The last good data stays on screen with a `--text-dim` line that says it may be out of date                                                                                                                                             |
| One platform down | The other platform's data still shows. The failed platform is named in the line (Locked rule 5)                                                                                                                                         |
| Not connected     | The not-connected card (Appendix B.7): one sentence and "Go to Accounts"                                                                                                                                                                |
| Busy button       | The button keeps its size and place and changes its word                                                                                                                                                                                |

#### Sign-in screen

Shown when no platform is signed in
([`LoginScreen.tsx`](../src/renderer/src/components/LoginScreen.tsx)). One
centered card, at most 384 px wide, 32 px padding: `.glass.glass-layer` with
the tint of the chosen platform.

1. The wordmark (40 px) and "Social VR Companion".
2. After a sign-out the person did not ask for: "⚠" and "{platform} signed
   you out. Sign in again to continue." in `--error`.
3. A segmented control named "Sign-in platform": "VRChat" in
   `--login-tab-vrc`, "ChilloutVR" in `--login-tab-cvr`. It is locked while a
   sign-in is being sent.
4. The form: "Username or email" (VRChat) or "Email address" (ChilloutVR)
   with the placeholder "you@example.com", then "Password".
5. "Sign in": a full-width solid platform button. It reads "Signing in…"
   while busy.
6. "Use my sign-in from VRCX" or "Use my sign-in from ChilloutVR": a quiet
   action with a hint ("Quit VRCX first. Only reads it, never changes it.").
7. Fine print: "Connects to VRChat for you and keeps your sign-in encrypted
   on this device." with a "Show more" link, then the notice "VRX is an
   unofficial app, not affiliated with the VRChat team nor the ChilloutVR
   team."

A wrong password or a network fault shows one alert line in `--error` in
the card, with a glyph, in plain words ("Those sign-in details didn't work.
Check them and try again."). When VRChat asks for a code the card changes to
the code step: a prompt ("Open your authenticator app and enter the 6-digit
code."), a "Verification code" field with the placeholder "000000", "Verify"
and "Back".

Source: [`auth/CredentialsForm.tsx`](../src/renderer/src/components/auth/CredentialsForm.tsx),
[`auth/TwoFactorForm.tsx`](../src/renderer/src/components/auth/TwoFactorForm.tsx),
[`auth/ErrorBanner.tsx`](../src/renderer/src/components/auth/ErrorBanner.tsx),
[`FinePrint.tsx`](../src/renderer/src/components/FinePrint.tsx).

### §9.5 Activity

A log of friends coming online, joining worlds and going offline while VRX
is open ([`ActivityView.tsx`](../src/renderer/src/components/ActivityView.tsx)).
It keeps at most 300 entries per platform.

- **Top row.** A segmented control named "Show" with "All", "Online",
  "Worlds", "Offline", and a quiet "Clear" button at the right. The filter
  is remembered.
- **Entries.** A list with 6 px between entries, newest first. Each is a
  `.platform-row` for its platform, 12 px by 8 px padding:

  | Part        | Detail                                                                                                          |
  | ----------- | --------------------------------------------------------------------------------------------------------------- |
  | Avatar      | 24 px                                                                                                           |
  | Name        | 14 px / 500, one line                                                                                           |
  | Description | 12 px `--text-dim`: "Came online", "Came online in {world}", "Joined {world}", "Joined a world", "Went offline" |
  | Platform    | The platform pill, in a 96 px column                                                                            |
  | Time        | Right aligned in a 104 px column, tabular digits                                                                |

- An entry for a current friend is a button that opens that friend in
  Friends. Hover adds `--surface-hover`; focus draws an inset ring.
- **States.** "Loading activity…"; "No activity yet" with "Friends coming
  online, joining worlds and going offline show up here while VRX is
  open."; "Nothing to show with these filters."; "Couldn't load activity."
  with "Retry"; the not-connected card.

### §9.6 Inbox

Invites and friend requests that arrive while VRX is open
([`InboxView.tsx`](../src/renderer/src/components/InboxView.tsx)). The list
is forgotten when VRX closes.

- **Top line.** "3 waiting" at the left; "Hide all" and a round "?" at the
  right. The "?" opens a `.glass.glass-layer` help panel: "Accept or Decline
  answers a friend request on its platform. Join on an invite opens the game
  in that instance, and tells the sender nothing…"
- **Sections.** "INVITES" and "FRIEND REQUESTS", each a 12 px / 600
  uppercase heading on the canvas.
- **Row.** A `.platform-row` for its platform, 16 px by 12 px padding, 6 px
  between rows: a 36 px avatar; the name (14 px / 600) with the platform
  pill; under it the action and age in 12 px `--text-dim` ("Invited you to
  {world} · Just now", "Asked you for an invite", "Sent you a friend
  request"). Ages update every minute.
- **Actions**, at the right of the row. A friend request has "Accept" (the
  neutral confirm button), "Decline" and "Hide". An invite that named its
  instance has "Join" (the same neutral confirm button) and "Hide"; an invite
  that named none, and an invite request, have only "Hide". VRX never answers
  an invite for the person: Join opens the game there through the join flow
  (§9.4's confirmation, when it is on) and the row stays. It is the same on
  both platforms.
- **Join feedback.** What a Join said shows on a third line under the row's
  action, 12 px `--text-dim`, in a `role="status"`: "This invite is no longer
  here.", "Joining is disabled in Settings", "Sent to your open game". While
  any Join runs, every Join is `aria-disabled`.
- **Invite confirmation.** The join dialog titled with the invite's world
  ("Join {name}'s invite?" when it named none), the platform pill, and
  "{name} invited you here". No access pill, space pill or people count: an
  invite does not say them, so nothing stands in. If the row leaves while the
  dialog is open, "This invite is no longer here." shows and Join is
  disabled.
- **States.** Empty: a card reading "Nothing waiting" and "Invites and
  friend requests that arrive while VRX is open show up here." Errors in
  `--error` ("Could not load your inbox right now", "Couldn't hide that. Try
  again."). The not-connected card.

The sidebar count for new items is described in §8.

### §9.7 Search, profiles, Groups, Avatars and world lists

#### Search

[`SearchView.tsx`](../src/renderer/src/components/SearchView.tsx) searches
people and worlds by name on both platforms.

- A search form: a text field ("Search people and worlds") and a "Search"
  button. The hint under it reads "Press Enter to search people and worlds
  by name." Search runs on Enter or the button, not while typing. Fewer
  than two letters gives "Type at least 2 letters."
- Results come in two sections, "PEOPLE" and "WORLDS", each with a small
  uppercase heading (10.5 px / 600, 1.4 px letter spacing).
- **People** are tiles (`CommunityTile`, shape `square`): a 52 px picture
  beside the name, a "VRC" or "CVR" badge, and "Friend" when they are one. A
  tile opens the person sheet.
- **Worlds** are the Explore world cards in a `.picture-grid`, and open the
  world sheet.
- Empty: "No people found.", "No worlds found."

#### Tiles

`CommunityTile` ([`CommunityParts.tsx`](../src/renderer/src/components/CommunityParts.tsx))
is `.glass.glass-layer` with the platform tint. When it opens a sheet it also
takes `.glass-hover` and a 2 px focus ring. Three shapes:

| Shape    | Layout                                                                                                                                                                                         | Used by             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `square` | 52 px picture beside the name                                                                                                                                                                  | People in Search    |
| `wide`   | 4:3 picture on top, name under it                                                                                                                                                              | Worlds in a profile |
| `icon`   | 112 px banner on top (`.glass-clip-top`), a 56 px icon (radius 14 px) with `--group-icon-ring` and `--group-icon-shadow` over its lower edge, name 14 px / 700, then a badge and a detail line | Groups              |

#### Person and group sheet

[`CommunitySheet.tsx`](../src/renderer/src/components/CommunitySheet.tsx), in
the shared sheet frame (§9.3). A banner with the name over its lower left
(21 px / 700) and pills under the name; then the profile.

**Profile** ([`ProfileDetails.tsx`](../src/renderer/src/components/ProfileDetails.tsx)).
A two-column fact list in 13 px (Pronouns, Rank; "Not shown" when the
platform gives none), "BIO" ("No bio."), "BADGES" as small bordered pills
with a 16 px picture ("No badges shown."), and two quiet buttons, "Show
worlds" and "Show groups", that load those lists only when pressed. Loading
reads "Loading profile…"; a failure reads "Couldn't load this profile." with
Try again. "This profile is no longer available." is only when the platform
says the profile is gone.

**Friend actions** ([`ProfileActions.tsx`](../src/renderer/src/components/ProfileActions.tsx)):

- Not a friend: "Add friend" (the neutral confirm button). It reads
  "Sending…" and then "Friend request sent." Someone already blocked gets no
  Add friend; Unblock stays in the options below.
- They sent a request: "Sent you a friend request." with "Accept" and
  "Decline".
- **Unfriend or block** is behind a quiet button of that name ("Block or
  unblock" for someone who is not a friend). Opened, it shows the hint
  "These change your {platform} account, one person at a time.", then
  "Unfriend" (friends only), "Block" or "Unblock". Unfriend and Block use
  the destructive look; Unblock is neutral. While VRX checks the block state
  it reads "Checking…".
- Each of the three asks first, in an alert dialog: a 400 px
  `.glass.glass-frosted-heavy.glass-information` panel over the heavier
  `--scrim`, titled "Unfriend {name}?", "Block {name}?" or "Unblock
  {name}?" with the platform pill, one sentence on what happens, then
  "Cancel" (first focus) and the action. While sending, the action reads
  "Sending…". Escape cancels.
- Afterwards a status line reads "Unfriended on {platform}.", "Blocked on
  {platform}." or "Unblocked on {platform}.". A failure says why in plain
  words and changes nothing.

#### Groups

[`GroupsView.tsx`](../src/renderer/src/components/GroupsView.tsx) is view
only. The hint "The groups you belong to. View only." with "Refresh" at the
right; the heading "YOUR GROUPS" with "12 groups"; then `icon` tiles in a
grid of columns at least 220 px wide, 12 px apart. A tile shows the banner
(or a soft copy of the icon until the banner arrives), the icon, the name,
the platform badge and a detail line such as the person's role. Empty: "You
aren't in any groups yet." A tile opens the group sheet with the description
and facts.

#### Avatars

[`AvatarsView.tsx`](../src/renderer/src/components/AvatarsView.tsx) shows the
person's own avatars. "Refresh" sits at the top right.

- **Wearing now.** One bar card per platform in a grid of columns at least
  260 px wide: a 128 px wide 4:3 picture at the left (`.glass-clip-left`) and
  the avatar name in 18 px / 700.
- **Your uploads**, with "24 avatars": cards in a grid of columns at least
  168 px wide, 12 px apart. Each card
  ([`AvatarCard.tsx`](../src/renderer/src/components/AvatarCard.tsx)) is
  `.glass.glass-layer` with the platform tint and `.glass-hover`: a 4:3
  picture on top with the platform badge, the name in 14.5 px / 700, and
  "Wearing now" in 12 px / 600 on the one in use. A long list is drawn 48
  cards at a time so it never holds up the page.
- Per-platform lines say what is wrong: "Couldn't load your {platform}
  avatars.", "Couldn't refresh your {platform} avatars. Showing what loaded
  last.", "You haven't uploaded any avatars yet."

**Avatar sheet** ([`AvatarSheet.tsx`](../src/renderer/src/components/AvatarSheet.tsx)),
in the shared frame: a banner with the name and pills, and at its lower
right "Wear this avatar" with the hint "Changes the avatar on your
{platform} account." ("Switching…" while busy; "You're wearing this" on the
current one; then "Done. {platform} has your new avatar."). Under it,
"DESCRIPTION" and "DETAILS": Creator, Visibility ("Public" or "Private"),
Uploaded, Updated, Avatar ID.

#### World lists

[`WorldResults.tsx`](../src/renderer/src/components/WorldResults.tsx) draws
any list of worlds (Search, Explore's lists and favorites) as Explore world
cards in `.picture-gridwrap` and `.picture-grid`, so a world looks and
behaves the same wherever it is listed.

### §9.8 Settings, accounts and editing your profile

[`SettingsView.tsx`](../src/renderer/src/components/SettingsView.tsx). The
layout rule is in §8.

**Row anatomy.** A setting is a `.setting-card.setting-row`: label (14 px / 500) and a one-line note (12 px `--text-dim`) at the left, the control at
the right, 16 px apart, 8 px by 12 px padding, radius 12 px, about 59 px
tall. Under 760 px of window width the control wraps under the text. A
setting with more options is a `.setting-card` whose extra rows sit in a
`.setting-disclosure` that opens in 220 ms; the extra rows
(`.setting-children`) are indented under the first.

A change applies at once and is saved; there is no Save button.

| Category      | Settings, in order                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appearance    | **Theme** (Dark, System, Light; default System). **Background glow** (Off, Muted, Standard, Vivid; default Standard). **Background picture** ("Choose picture"; then a thumbnail, "Change picture", "Remove" and **Picture fade**: Low, Medium, High). **Instance labels** (VRChat, Per platform, ChilloutVR). **Sidebar pages**: On/Off for Hot Instances, Activity, Inbox, Explore, Search, Groups in two columns |
| Dashboard     | **Hide empty sections**. **Player counts**. **Sections**: the four sections in order, each with "↑" and "↓" (24 px round buttons) and On/Off. **Hot instance threshold** (stepper, 1 to 10, default 2)                                                                                                                                                                                                              |
| Behavior      | **Friend details open from** (Whole card, Avatar only). **Save notes to my accounts**, with **Use my game favorites** under it. **Friends background re-sync** (5m, 10m, 30m, 1h, Manual only; default 1h). **Allow joining friends**, with **Confirm before joining**, **Join in** (VR, Always ask, Desktop) and **When the game is already open** (Go there, Send invite, Off) under it                           |
| Notifications | **Who alerts you** (Everyone, Picked friends; with Picked friends, a count line and a "Show" link to the Picked friends dialog). **Friend comes online**, **Friend joins a world**, **Friend goes offline**, **Hot instance**, **Invite received**, **Friend request received**: all Off by default. **Alerts in VR**, with **Time on screen** (Short, Medium, Long) and "Send a test" under it                     |
| Accounts      | Two account cards side by side. **Export your data** ("Export…" saves friends, notes and favorites to a file the user picks; the result reads in words under the description). Then the unofficial-app notice                                                                                                                                                                                                       |
| About         | **Automatic updates** (channel: Stable, Beta, Dev; On/Off; an action button; "VRX v1.4.3"). **Start with your computer** (Off, On, In the tray; default Off). **Welcome setup** ("Run setup again"). **Found a bug?** ("Report a bug"). **Logs** ("Open logs folder"). **Legal** ("Show" opens Not an official app, Getting help, Platforms and terms, Privacy, License)                                            |

A settings action button is 13 px / 500, radius 10 px, 1 px `--border`,
`--control-fill`, about 30 px tall. Moving a Dashboard section announces
its new place to screen readers ("Popular now: 2 of 4").

**Account card** ([`AccountCard.tsx`](../src/renderer/src/components/AccountCard.tsx)).
One per platform, VRChat first, in a two-column grid 24 px apart. Each is
`.glass.glass-layer` with the platform tint and 24 px padding.

| State          | Content                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Checking       | "Connecting…"                                                                                                      |
| Signed in      | "✓ Connected as {name}", then "Edit profile" and "Sign out" (bordered buttons)                                     |
| Sign-out asked | In the card: "Sign out of {platform}?" with "Sign out" and "Cancel"; "Signing out…" while it works. Escape cancels |
| Cannot reach   | "Can't reach {platform} right now — your session is safe." with "Retry" ("Retrying…") and "Sign out"               |
| Signed out     | The sign-in form from §9.4 with "Connect" as the platform button, and the "Use my sign-in from …" action           |
| Needs a code   | The verification code step from §9.4                                                                               |

After a profile save the card reads "Profile saved to {platform}."

**Edit profile** ([`OwnProfileDialog.tsx`](../src/renderer/src/components/OwnProfileDialog.tsx)).
A dialog titled "Your {platform} profile" in the shared dialog frame (§10):

- The first line says what it does: "What you save here changes your
  profile in {platform}."
- Fields: **Bio** (text area) and **Pronouns** on both platforms; **Status**
  and **Status text** on VRChat. Each text field has a counter at its right
  ("128/512"). A counter over its limit turns `--error` and 600, and "Save"
  is held. "Save" is also held until something has changed.
- **Status** is four tiles in a 2 x 2 grid, each a 9 px status dot with its
  word: "Join Me", "Online", "Ask Me", "Do Not Disturb". The dot and word
  together follow §5.
- "Cancel" (bordered) and "Save" (the platform button; "Saving…" while
  busy).
- While there are unsaved edits, Escape and a press outside do not close
  the dialog, so text is not lost by accident.
- Loading reads "Loading your profile…". A failure shows a line with a bold
  "!" and the reason, with "Retry".

### §9.9 Welcome setup

The welcome setup ([`SetupWizard.tsx`](../src/renderer/src/components/setup/SetupWizard.tsx),
[`SetupSteps.tsx`](../src/renderer/src/components/setup/SetupSteps.tsx))
fills the window on first run. It can be skipped at any time and run again
from Settings → About. It never appears over the app as a tour.

**Card.** One centered `.glass.glass-panel` card, at most 640 px wide and
660 px tall (640 x 638 at the minimum window), with 30 px side padding. The
canvas, glow and background picture show behind it. No step scrolls at
900 x 670, in English or Japanese.

**Steps.** Welcome, then five numbered steps: Sign in, Pages, Dashboard,
Alerts, Look; then a closing summary.

- **Progress**, on the five numbered steps: "STEP 2 OF 5" in VT323 18 px,
  uppercase, 2 px letter spacing; then five equal columns
  (`.setup-progress-step`), each a 3 px bar (`.setup-progress-bar`) over its
  step name. A finished step shows a check mark and can be pressed to go
  back; later steps cannot be pressed.
- **Title.** Each step has a 25 px / 800 title and a 13 px lead line. Focus
  moves to the title when the step changes.
- **Foot.** Above a 1 px line: "Skip setup" at the left; "Back" and the
  primary button at the right. The primary button is the setup primary look
  (§8): "Get started", then "Continue", then "Open VRX".
- A choice applies as it is made, so the window behind the card already
  shows the chosen look.

| Step      | Content                                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome   | The wordmark at 64 px, "Welcome to VRX", "Your social VR companion for VRChat and ChilloutVR.", three `.setting-card` rows with a 32 px `.glass-chip` icon tile each ("One friends list", "Hot Instances", "Explore"), and the unofficial-app notice |
| Sign in   | The two account cards side by side. The lead changes: "Connect one platform or both. You can add the other later.", "One connected. Continue, or connect the other one too.", "Both connected." "Continue" is held until one account is connected    |
| Pages     | "Pick your pages": six On/Off rows (Hot Instances, Activity, Inbox, Explore, Search, Groups), each with one line on what the page is                                                                                                                 |
| Dashboard | "Your Dashboard": On/Off for Popular now and Hot Instances, and "Which comes first?" ("The first one gets the big pictures.")                                                                                                                        |
| Alerts    | "Desktop alerts": "Every alert stays off unless you turn it on." The six alert toggles in two cards, and a "Turn all on" button that becomes "Turn all off"                                                                                          |
| Look      | "Pick a look": three picture tiles (`.setup-theme-choice`), "Match my PC", "Dark", "Light", each a radio with a small preview; then Background glow, Background picture and Instance labels                                                          |
| Done      | A summary list of what was chosen (Accounts, Pages, Dashboard, Alerts, Look, Instance labels) in 13 px, with a 128 px label column                                                                                                                   |

"Skip setup" before signing in goes to the Sign in step, since the app needs
one account; after that it opens the app with the usual settings.

## §10 Linked friends

A person who uses both platforms can be linked by hand: one VRChat friend
and one ChilloutVR friend become one VRX person. The link, its VRX name and
its shared note are kept in VRX on this PC. Nothing about a link is sent to
either platform.

**One row, both platforms.** A linked person takes one row in Friends and
counts once in "15 people" and in the top bar count.

- The row is `.platform-row.platform-row--vrx`: the wash runs from `--vrc` at
  the left to `--cvr` at the right, and the soft edge is blue on the top and
  left, orange on the right and bottom.
- The platform tab reads "VRX" on a fill that runs from the ChilloutVR rail
  color at the bottom to the VRChat rail color at the top
  (`.linked-platform-rail`). In dark the word is a gradient
  (`.linked-gradient-text`); in light it is plain `--linked-rail-text`,
  because light rails are solid color.
- The row shows the account with the stronger presence (in a game, then
  online, then offline). On a tie it shows the person's preferred platform.
  The name is the VRX name if one was set, otherwise the name of the
  preferred platform's account.
- With "Use merged profile picture" on, the avatar is cut on the diagonal:
  the VRChat picture in the upper right half, the ChilloutVR picture in the
  lower left.
- **World line.** When both accounts are in a game the line shows both
  places (`.linked-world-pair`): for each, a small "VRC" or "CVR" chip
  (`.linked-world-platform`, 10 px / 600), the access word in its tier text
  color, and the world name. The platform chip is the cue; the colors only
  repeat it.
- **Access column.** One joinable place shows the normal join pill. Two
  joinable places show a "2 locations" button (`.linked-location-button`,
  28 px tall): its fill is split on the diagonal between the two places'
  access colors, and its tooltip names both ("VRChat: Public · ChilloutVR:
  Friends"). It opens the destination dialog.

**Choose a destination.** A dialog titled "Choose a destination" with one
bordered card per joinable account: the platform name, the world name, the
instance pill, and a "Join on {platform}" button; then "Cancel". If the
person moves while it is open it says "Activity changed. Review the current
location." With nowhere to go it says "No joinable locations are currently
available."

**Friend details for a linked person.** The same panel as §9.2, with these
differences:

- Under the name, one small button per account ("VRChat", "ChilloutVR")
  opens that account's own view; there a "Back to combined profile" link
  returns. An account whose platform is not available is disabled and its
  tooltip reads "Unavailable".
- The status chip adds "VRC" or "CVR" after the status word, since a status
  belongs to one account.
- "WHERE" shows both worlds in one 16:9 picture cut on the diagonal
  (`.linked-world-composite`): VRChat's world in the upper right with its
  caption there, ChilloutVR's in the lower left. Each half carries its
  platform chip and access pill.
- The note is the shared note, headed "SHARED NOTES (YOURS, PRIVATE)".
- One favorite star and one alerts pick cover both accounts.
- The foot row's "Identities" button has a thin outline that runs from blue
  to orange (`.linked-identities`).

**Identities dialog** ([`IdentitiesDialog.tsx`](../src/renderer/src/components/IdentitiesDialog.tsx)).
Opened from "Identities". Its buttons are small bordered buttons (12 px).

- For a friend who is not linked: "Link this account to a friend on the
  other platform." and "Link an account". That opens a picker: "Choose the
  {platform} account belonging to this same person. Offline friends are
  included.", a search field and a scrolling list of friends on the other
  platform. A friend who is already linked is marked "Already linked ·
  Review before replacing". No match reads "No matching friends."
- For a linked person: each account with "View {platform} profile" and
  "Replace account"; "VRX name" with "Save name" and "Use platform name"
  ("Only changes the name in VRX."); "Preferred platform" as a native
  drop-down ("Used when both accounts have the same presence level."); a
  checkbox, "Use merged profile picture"; then "Unlink accounts", whose word
  is `--error`, and "Done".
- Linking needs both platforms signed in and reachable; otherwise the dialog
  says "Both platforms must be signed in and available to link."

**Confirming a link change** ([`LinkConfirmDialog.tsx`](../src/renderer/src/components/LinkConfirmDialog.tsx)).
Every link, replacement and unlink is reviewed inside the same dialog before
it is saved.

- Link: "Link these accounts?", "Do these accounts belong to the same
  person?", the two accounts, a "Preferred platform" choice, the combined
  name, then "Back", "Cancel" and "Link accounts".
- Replace: a bordered warning, "Existing links will be replaced", lists each
  old pair and what happens to it ("Remove this link and permanently delete
  its shared note."). The person must tick "I understand that the listed
  shared notes will be permanently deleted." before "Replace and link" works.
- Unlink: "Unlink accounts?", "The shared note will be permanently deleted.
  Save any text you want to keep before unlinking." and "Both original
  account notes stay unchanged." The person must tick "I understand the
  shared note will be deleted." before "Unlink and delete shared note"
  works.
- While saving, the action reads "Saving…". A failure keeps the dialog open
  and says nothing was changed ("Save failed. Existing links and notes are
  unchanged. Try again or cancel.").

**Shared dialog frame** ([`LinkedDialog.tsx`](../src/renderer/src/components/LinkedDialog.tsx)).
Identities, Choose a destination, Picked friends and Edit profile use one
frame:

- A native modal `<dialog>`, at most 440 px wide (never closer than 16 px to
  the window sides) and never taller than the window less 48 px; long
  content scrolls inside it.
- The backdrop is `--scrim-soft`. The panel is
  `.glass.glass-frosted.glass-information` with 20 px padding.
- An 18 px / 700 title and a 28 px "✕" at the top right, which takes first
  focus.
- Escape and a press on the backdrop close it, except while it is saving or
  holds unsaved edits. Focus returns to the control that opened it.

If linked profiles cannot be read, Friends and the Identities dialog show
"Could not load linked profiles. Retry to restore identity management." with
"Retry linked profiles".

Source: [`FriendRow.tsx`](../src/renderer/src/components/FriendRow.tsx),
[`LinkedWorlds.tsx`](../src/renderer/src/components/LinkedWorlds.tsx),
[`LinkedDestinationChooser.tsx`](../src/renderer/src/components/LinkedDestinationChooser.tsx),
[`LinkedProfilesLoadError.tsx`](../src/renderer/src/components/LinkedProfilesLoadError.tsx),
[`projectLinkedFriends.ts`](../src/renderer/src/utils/projectLinkedFriends.ts).

## §11 Known open findings

These were reproduced in version 1.4.3 while this document was written. They
are defects or loose ends, not rules. Do not copy them into new work, and
remove an entry when it is fixed.

1. **Keyboard focus looks different on three controls.** Sidebar items,
   segmented options (the platform filter included) and the number stepper's
   value show the browser's default outline, while every other control draws
   a `--text-dim` ring. Source:
   [`Sidebar.tsx`](../src/renderer/src/components/Sidebar.tsx),
   [`SegmentedControl.tsx`](../src/renderer/src/components/SegmentedControl.tsx),
   [`NumberStepper.tsx`](../src/renderer/src/components/NumberStepper.tsx).
2. **Three tokens are defined and never used:** `--aurora-vrc`,
   `--aurora-cvr` and `--friend-status-description-width`.
3. **The stored `density` setting has no control.** Settings offers no way
   to change it, and in the renderer it only sets a 60 px minimum height on
   friend rows, which rows already have.
4. **Friend names in the hot instance sheet sit in capsules.** Each friend
   under "FRIENDS HERE" is an avatar and a name inside a bordered capsule.
   Everywhere else a name is plain text, and the design contract says names
   never become chips. This one is for the owner to decide. Source:
   [`HotInstanceSheet.tsx`](../src/renderer/src/components/HotInstanceSheet.tsx).

## §12 Workflow and verification

**Before a UI change**

1. Read this document's Quick start and Locked rules, and the section for
   the surface you will touch.
2. Open the visual guide: `npm run guide:dev`, then
   `http://127.0.0.1:4173/design.html`. It renders the production components
   with sample data, never real accounts.
3. Find the component in
   [`src/renderer/src/components`](../src/renderer/src/components) and reuse
   it. Add a token to [`main.css`](../src/renderer/src/assets/main.css) only
   when no existing one has the meaning you need, and define it in both
   themes.

**Checking a change by eye.** One scene at a time, without the guide's
chrome: `http://127.0.0.1:4173/glass.html?scene=NAME&theme=dark&render=1`.

- Scenes: `dashboard`, `hot`, `friends`, `linked`, `activity`, `inbox`,
  `search`, `groups`, `avatars`, `settings`, `updater`, `drawer`, `join`,
  `login`, `setup`, and the catalog scenes `explore`, `layers`, `materials`,
  `semantics`, `instances`, `typography`, `controls`, `feedback`, `icons`.
- Add `theme=light`, `glow=off`, `glow=muted` or `glow=vivid`, `picture=1`
  for a background picture, and `variant=` for a state (for example
  `variant=cvr-missing` on `friends`, `variant=note-account-conflict` on
  `drawer`, `variant=hot-first` on `dashboard`). The states are listed in
  [`docs/guide/scenarios.ts`](guide/scenarios.ts).

Check every change against this list:

- Dark and light.
- Glow Off, Muted, Standard and Vivid, and with a background picture.
- 900 x 670, and a wide window (1280 and up) for grids.
- Keyboard only: Tab order, arrow keys, Enter, Escape, visible focus, focus
  returning to the opener.
- Reduced motion.
- Japanese. The app follows the system language, and the guide follows the
  browser's, so a browser set to Japanese shows every scene in Japanese.
- Every state the surface has: hover, pressed, disabled, busy, loading,
  empty, error, stale, one platform missing, not connected.
- Both platforms side by side, and a linked person where rows are involved.
- No color without a word, glyph or shape beside it.

**Commands**

| Command                       | What it does                                                             |
| ----------------------------- | ------------------------------------------------------------------------ |
| `npm run guide:dev`           | Serves the guide and the scenes at port 4173                             |
| `npm run guide:build`         | Builds `docs/design.html` and `docs/glass.html`                          |
| `npm run guide:typecheck`     | Type-checks the guide against the production components                  |
| `npm run design:tokens`       | Rewrites Appendix A from `main.css`                                      |
| `npm run design:tokens:check` | Fails when Appendix A is out of date                                     |
| `npx vitest run docs/guide`   | Runs the guide tests, including the ones that keep this document in step |
| `npm run docs:links`          | Checks every link in the documentation                                   |
| `npm run icons:check`         | Checks the app icon files ([APP-ICON.md](APP-ICON.md))                   |

`design-doc.test.ts` fails when this document names a token or a material
class that is not in `main.css`, when Appendix A is stale, or when a rule in
Appendix B.1 differs from the stylesheet.

**After a UI change**

1. If a token changed, run `npm run design:tokens`.
2. Update the section of this document that describes the surface, in the
   same change. Describe what the app does now.
3. Add or update a guide scene or variant when a new surface or state
   appears ([`docs/guide/AGENTS.md`](guide/AGENTS.md)).
4. Keep the section numbers and Locked rule numbers stable. Code comments
   cite them.

## Appendix A: Token reference

Every custom property in the theme blocks of `main.css`, in both themes. The
table between the two markers is generated: run `npm run design:tokens` after
changing a token, and never edit it by hand. "(same as dark)" means light
uses the dark value; "(light only)" means the token exists only under
`[data-theme='light']`. A value that names another token resolves in the
active theme.

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

Every recipe is taken from the shipped code. Class strings are the ones the
named component uses today.

### B.1 The material classes (`main.css`, `@layer components`)

These rules are copied from [`main.css`](../src/renderer/src/assets/main.css)
with comments removed. A test compares them with the stylesheet. The two
tint classes are outside the cascade layer on purpose, so they win over the
glass background.

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

.glass-frosted {
  background-color: var(--glass-frost);
  -webkit-backdrop-filter: var(--glass-blur-frosted);
  backdrop-filter: var(--glass-blur-frosted);
}

.glass-frosted-heavy {
  background-color: var(--glass-frost-heavy);
  -webkit-backdrop-filter: var(--glass-blur-frosted);
  backdrop-filter: var(--glass-blur-frosted);
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
  background-color: var(--glass-panel);
  -webkit-backdrop-filter: var(--glass-blur-frosted);
  backdrop-filter: var(--glass-blur-frosted);
}

.glass-sheet::after {
  background-color: var(--glass-sheet);
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

.tint-vrc {
  background-image: var(--tint-vrc-bg);
  border-color: var(--tint-vrc-border);
  --glass-face: var(--tint-vrc-bg);
  --glass-edge: var(--tint-vrc-border);
}

.tint-cvr {
  background-image: var(--tint-cvr-bg);
  border-color: var(--tint-cvr-border);
  --glass-face: var(--tint-cvr-bg);
  --glass-edge: var(--tint-cvr-border);
}

.platform-row {
  --platform-row-from: var(--platform-row-color);
  --platform-row-to: var(--platform-row-color);
  position: relative;
  overflow: hidden;
  border: 1px solid var(--platform-row-border);
  border-radius: var(--radius-control);
  background-color: var(--glass-layer);
  box-shadow: var(--glass-layer-depth);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  background-image: linear-gradient(
    90deg,
    color-mix(in srgb, var(--platform-row-from) var(--platform-row-tint-strong), transparent),
    color-mix(in srgb, var(--platform-row-to) var(--platform-row-tint-soft), transparent)
  );
}
```

Also in the stylesheet, and described in §3: the hover rules for
`.glass-hover`, the corner helpers `.glass-clip-top`, `.glass-clip-left` and
`.glass-clip-all`, the `.platform-row` platform modifiers, `.status-badge`,
`.setting-card`, and the canvas helpers `.canvas-text` and `.canvas-control`.

### B.2 Stacking the layers

```tsx
// Layer 2: a back panel that groups a page
<section className="glass-panel rounded-panel border border-[var(--glass-border)] p-[var(--space-4)]">…</section> // Friends
<div className="glass glass-panel settings-panel p-[var(--space-2)]">…</div>                                    // Settings

// Layer 3: a card, straight on the canvas or on a panel
<div className="glass glass-layer min-w-0 p-[16px_18px]">…</div>                         // Dashboard number
<div className="glass glass-layer tint-cvr glass-hover relative cursor-pointer">…</div>  // a platform's card that opens a sheet

// Layer 3: a row that belongs to one platform
<li className="platform-row platform-row--vrchat flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)]">
  <span className="truncate text-sm font-semibold text-[var(--text)]">{name}</span>
  <PlatformPill platform="vrchat" />
</li>

// Layer 3: a Settings row
<div className="setting-card setting-row">…</div>

// Layer 4: a pill or small count on any of the above
<span className={PILL_BASE}>…</span>

// Opaque: a menu or popover, then a confirmation
<div role="tooltip" className="glass glass-information absolute right-0 top-full z-50 mt-[10px] w-[272px] p-[12px_14px] text-left text-[12.5px] leading-[1.45]">…</div>
<div role="dialog" aria-modal="true" className="glass glass-frosted-heavy glass-information relative flex w-[400px] max-w-full flex-col gap-[var(--space-3)] overflow-hidden p-[var(--space-6)]">…</div>
```

Rules for stacking:

- A pane never sits on a pane of the same layer. A card does not hold a
  card; it holds rows of text, chips and controls.
- A platform tint (`.tint-vrc`, `.tint-cvr`) goes on a layer 3 card. A row
  uses the `.platform-row` modifier instead.
- Anything that carries reading text over busy content is opaque
  (`.glass-information`).
- Do not add `overflow-hidden` to a `.glass.glass-layer` card to clip a
  picture; use `.glass-clip-top`, `.glass-clip-left` or `.glass-clip-all` on
  the picture.

### B.3 Pills

```tsx
// utils/instancePill.ts
export const PILL_BASE =
  'glass-chip inline-flex h-[28px] shrink-0 items-center justify-center ' +
  'rounded-[10px] border px-[12px] text-[12px] font-semibold whitespace-nowrap'

// Access: the label and the color tier come from one helper
const { labelKey, tier } = instancePillFor(instance, labelScheme)
<InstancePill label={t(labelKey)} tier={tier} className="min-w-[78px]" />

// The same pill as the join button
<InstancePill label={t(labelKey)} tier={tier} onJoin={join} disabled={isJoining}
  aria-label={t('friends.joinPillAria', { access, name, world })} />

// Platform and policy
<PlatformPill platform="chilloutvr" />
<PolicySpacePill space="public" />
```

A pill's color is always mixed from its token, never typed in: the word
uses the tier's text token, the fill is the tier color at `--pill-tint`, and
the edge is the tier color at `--pill-edge` (§6.1). A pill with no tier is
neutral.

### B.4 Buttons

```tsx
// Quiet (Refresh, See all, Settings)
"rounded-control bg-[var(--control-fill)] px-[var(--space-3)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-dim)] aria-disabled:opacity-50 motion-safe:transition-colors"

// Neutral confirm (Accept, Add friend): FRIEND_ACTION_BUTTON in utils/friendActions.ts
"shrink-0 rounded-control border border-[var(--control-active-border)] bg-[var(--control-fill-hover)] px-[var(--space-3)] py-[var(--space-1)] text-xs font-semibold text-[var(--text)] hover:brightness-110 active:brightness-95 …"

// Join (friend details, sheets, the join confirmation)
<button
  className="rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)] …"
  style={{
    borderColor: 'color-mix(in srgb, var(--op-public) var(--pill-edge-strong), transparent)',
    background: 'color-mix(in srgb, var(--op-public) var(--pill-tint-strong), transparent)',
    color: 'var(--op-public-text)'
  }}
>

// A platform's own action (Connect, Save): actionClass in utils/accountCard.ts
"rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 border-[var(--vrc)] bg-[color-mix(in_srgb,var(--vrc)_16%,transparent)] text-[var(--plat-vrc-word)]"

// Sign in, on the sign-in screen only
"rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 border-[var(--vrc)] bg-[var(--vrc)] text-[var(--text-on-vrc)]"

// Destructive (Unfriend, Block): the quiet shape with this style
style={{
  borderColor: 'color-mix(in srgb, var(--error) var(--pill-edge-strong), transparent)',
  background: 'color-mix(in srgb, var(--error) var(--pill-tint), transparent)',
  color: 'var(--error)'
}}

// Close
"absolute top-[var(--space-3)] right-[var(--space-3)] z-10 grid h-[28px] w-[28px] place-items-center rounded-[9px] text-base leading-none text-[var(--text-dim)] hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]"
```

- Use `aria-disabled` rather than `disabled` on a button that stays on
  screen while it works. A disabled button loses keyboard focus.
- A busy button changes its word and keeps its size.
- Write whole class names. Tailwind does not see a class built from pieces
  at run time, so a platform's classes are chosen from a map of full strings.

### B.5 Segmented control and toggle

```tsx
<SegmentedControl
  values={THEMES}
  active={theme}
  labelKeys={THEME_LABEL_KEYS}
  ariaLabel={t('settings.theme.aria')}
  onChange={(value) => updateSettings({ theme: value })}
/>

<Toggle
  checked={hideEmpty}
  onChange={(checked) => updateSettings({ dashboardHideEmpty: checked })}
  ariaLabel={t('settings.dashboard.hideEmpty.label')}
/>

<NumberStepper value={threshold} min={1} max={10} onChange={setThreshold}
  ariaLabel={t('dashboard.hotThresholdAria')} />
```

`labelKeys` maps each value to a translation key (above,
`THEME_LABEL_KEYS` in `SettingsView.tsx`). Pass `textColors` only for
platform words (the sign-in tabs). Never draw a second kind of switch.

### B.6 Section heading and notice

```tsx
// Dashboard section heading (SectionHeading in DashboardView.tsx)
<div className="flex items-baseline gap-[10px] mx-[2px] mb-[12px] mt-[var(--space-6)]">
  <h2 className="canvas-text font-[family-name:var(--font-mono)] text-[18px] font-normal tracking-[2px] uppercase text-[var(--text-dim)]">
    {t('dashboard.sectionHotInstances')}
  </h2>
</div>

// Small heading inside a sheet or profile
<h3 className="mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]">…</h3>

// Notice line above a page (RecoveryNotices.tsx)
<div role="status" className="glass glass-layer mb-[var(--space-2)] flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] text-xs leading-snug text-[var(--text-dim)]">
  <span className="min-w-0 flex-1">{message}</span>
  <button className="shrink-0 rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-xs …">{t('settings.accounts.retry')}</button>
</div>
```

A notice that reports a failure starts with a glyph in `--error` ("⚠" or
"!") and uses `role="alert"`. One that only informs uses `role="status"`.

### B.7 Empty and not-connected state

```tsx
// NotConnectedCard.tsx
<div className="glass glass-layer flex flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-10)] text-center min-h-[180px]">
  <p className="text-sm font-semibold text-[var(--text-dim)]">{message}</p>
  <button className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors">
    {t('friends.notConnected.openAccounts')}
  </button>
</div>

// Empty (HotInstancesEmpty in HotInstancesHeader.tsx)
<div className="glass glass-layer flex flex-col items-center justify-center text-center p-[var(--space-10)] min-h-[180px]">
  <p className="text-[var(--text-dim)] text-sm font-semibold">{t('dashboard.emptyHeading')}</p>
  <p className="text-[var(--text-dim)] text-xs mt-[var(--space-1)]">{t('dashboard.emptyHint', { threshold })}</p>
</div>
```

An empty state says what will show up here and, when there is one, the
single next step. It has no illustration.

### B.8 Theme and glow

```ts
applyTheme('light', false) // sets data-theme="light" on <html>
applyTheme('dark', false) // removes it: dark is the baseline
applyTheme('system', prefersLight) // follows the system
applyGlow('vivid') // sets data-glow on <html>; 'standard' removes it
```

- The app calls these through `useApplyTheme` and `useApplyGlow` in
  `App.tsx`. Components never read the theme; they use tokens.
- A background picture sets `data-app-background` on `<html>` and the fade
  through `--app-backdrop-fade` (§4).
- To check a component in light, set `data-theme="light"` on `<html>`. If it
  needs a light-only correction, add or override a token under
  `[data-theme='light']` in `main.css`; do not branch in the component.

## Appendix C: Rebuilding the look outside VRX

To reproduce the VRX look in another codebase (a mockup, a prototype, a
companion page):

1. Copy the `:root` and `[data-theme='light']` token blocks from `main.css`
   (Appendix A lists every value). Keep the names.
2. Host Inter (variable, 400 to 800) and VT323 yourself and set
   `--font-sans` and `--font-mono` as in Appendix A.
3. Paint the canvas: `--bg-base` on `body` with `--text` and `--font-sans`,
   then the aurora on `body::before` and the scanlines on `body::after`
   (§4). `body` does not scroll.
4. Copy the rules from Appendix B.1 into a cascade layer that sits below
   your utility classes, with the two tint classes outside it.
5. Build pages as layers (§3): the sidebar is `.glass`; a page panel is
   `.glass.glass-panel`; cards are `.glass.glass-layer`; platform rows are
   `.platform-row`; pills use `.glass-chip` with the `PILL_BASE` geometry;
   dialogs are `.glass.glass-frosted-heavy.glass-information`.
6. Keep the Locked rules: both platforms equal, a word or shape beside every
   color, VRChat blue and ChilloutVR orange, privacy for Ask Me and Do Not
   Disturb, simple by default.
7. Check dark and light by setting `data-theme="light"` on `<html>`, each
   glow level with `data-glow`, and a window of 900 x 670.

Do not use either platform's logo or art. VRX names the platforms in words.

## Appendix D: Glossary and legacy labels

- **Presence:** where a friend is: in a game, online outside the game, or
  offline. Shown by the avatar ring (§5).
- **Status:** VRChat's own Join Me, Online, Ask Me, Do Not Disturb. Shown by
  the dot on the avatar and by words.
- **Instance:** one running copy of a world. **Access** is who may join it
  (Public, Friends+, Friends, Invite+, Invite, the group kinds, and
  ChilloutVR's own names; §6.1).
- **Policy space:** whether an instance counts as a public or a private
  space for moderation (§6.2).
- **Hot instance:** one instance with at least the threshold number of
  friends whose location is visible.
- **Linked person:** one VRChat friend and one ChilloutVR friend joined by
  hand into one VRX person (§10).
- **Pane, layer:** one sheet of glass in the stack (§3).
- **Information surface:** an opaque pane for reading text: a menu, a
  dialog, the boot and error screens.
- **Canvas text:** words set straight on the background, not on a pane.
- **Platform tab (rail):** the vertical "VRC", "CVR" or "VRX" chip at the
  left of a friend row.
- **Sheet:** a panel that rises from the bottom of the content area.
  **Friend details** (the drawer) slides in from the right.

Code comments from earlier versions use these labels:

| Label         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| R2, R12       | A color always has a non-color cue: a label, glyph, shape or word             |
| R10           | The same non-color rule; in motion comments, motion only under `motion-safe:` |
| R6            | The Ask Me and Do Not Disturb location privacy rule (§5)                      |
| R5            | The sidebar update button's "Updating…" label while it downloads              |
| §2A, §3A, §4A | The light-theme parts of §2, §3 and §4                                        |
| "channel law" | Locked rules 2 to 4 and §5: which signal carries which meaning                |
