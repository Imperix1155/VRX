# VRX design contract

Operational rules for agents changing the renderer. The human guide is
[`design.html`](design.html); [`glass.html`](glass.html) runs its isolated scenes.
Both import production React components, CSS, fonts, and translations through
[`guide/`](guide/AGENTS.md). They are built previews, not standalone HTML mocks.

Use current component source to establish implemented behavior. This document
records the constraints that source must preserve. A mismatch requires investigation,
not silently treating a defect or an old example as an approved design change.
Read the root and applicable child `AGENTS.md` before editing.

## §0 Direction and authority

VRX is a dense desktop companion for VRChat and ChilloutVR. Give both platforms
equal importance. Equivalent concepts use the same presentation and selected
terminology; unsupported platform features stay absent.

Keep liquid glass, the blue top-left and orange bottom-right aurora, restrained
scanlines, and retro type accents. Dark is the CSS baseline. Light uses the same
components, hierarchy, interactions, and semantic channels with token overrides.
The stored Theme preference defaults to System; that resolves to the OS theme.
Do not confuse the dark stylesheet baseline with the persisted preference.

Product changes, including visible wording and interaction changes, require the
owner's approval unless the approved issue already specifies the outcome.
Documentation work does not authorize redesigning the app.

## §1 Identity

Use the existing VRX mark and the subtitle "Social VR Companion". The mark uses
VT323 with platform colors on V and X and the neutral bridge color on R. Keep
page titles specific to the active view. Use official platform assets when a
logo is needed; do not invent or trace a substitute.

Sources: [`Sidebar.tsx`](../src/renderer/src/components/Sidebar.tsx),
[`LoginScreen.tsx`](../src/renderer/src/components/LoginScreen.tsx),
[`viewTitles.ts`](../src/renderer/src/utils/viewTitles.ts).

## §2 Tokens and themes

[`assets/main.css`](../src/renderer/src/assets/main.css) owns token values,
font faces, the spacing scale, radii, material classes, background effects, and
light overrides. Do not copy its values into another token table or stylesheet.
Use the existing semantic variables and Tailwind scale; add a shared token only
when an approved need cannot reuse them.

- Text: `--text`, `--text-dim`, `--text-faint`; do not use faint text for required
  reading where it loses contrast.
- Platform: `--vrc`, `--cvr`, and the platform companion/ghost tokens.
- Friend state: `--ingame`, `--active`, `--offline`, `--st-*` and text companions.
- Instance access: `--op-*` and their text companions. Policy: `--policy-*`.
- Controls: `--control-fill`, `--control-fill-hover`, borders and focus treatment.
- Material: `--glass-*`, scrim, shine, shadow, and radius tokens.

Keep themed colors as runtime CSS variables. A Tailwind build must not resolve
light/dark values into a second fixed palette. Use
[`applyTheme`](../src/renderer/src/hooks/useApplyTheme.ts): light sets
`data-theme="light"` on the document root; dark removes the attribute.

## §3 Material and overlays

Use `.glass glass-information` for information panels over the canvas. Add
`.glass-frosted` for a sheet or drawer, and `.glass-frosted-heavy` for a true
confirmation modal. The information modifier gives these surfaces an opaque
neutral backing beneath their existing gradients. Decorative chrome may keep
the translucent `.glass` material. Preserve neutral sheen, borders, and depth.

Information-bearing foreground cards and panels must keep their intended colors
independent of the ambient background. This includes statistics, Popular now,
Explore, Hot Instances, and informational surfaces elsewhere in the app. Blue or
orange background light must not tint them, especially platform-specific
surfaces. Neutral sheen and highlights may vary. Decorative chrome such as the
sidebar may still take on ambient color. This rule does not remove intentional
platform styling; it prevents the background from changing that styling.

Use `--glass-information` for the backing in both themes. Tint classes must set
`background-image`, not a `background` shorthand that clears that backing. The
Friends list uses the same backing without requiring a `.glass` frame;
hand-styled room sheets consume the token directly. Keep images, semantic colors,
geometry, and existing platform gradients unchanged.

Keep these classes in `@layer components`; utility positioning must still win
for fixed overlays. Frost modifiers follow `.glass`, and `.glass-information`
follows the frost modifiers so its opaque backing wins without clearing the
gradient. In compiled CSS, keep `-webkit-backdrop-filter` before standard
`backdrop-filter`, with the standard property last. Verify the resulting computed
material as well as source order.

Use the existing overlay components rather than assembling a new scrim/focus
pattern. A non-modal sheet must not claim `aria-modal` or trap focus. A true
modal must keep keyboard focus inside, including when actions are disabled.

Sources: [`main.css`](../src/renderer/src/assets/main.css),
[`FriendDrawer.tsx`](../src/renderer/src/components/FriendDrawer.tsx),
[`ExploreWorldSheet.tsx`](../src/renderer/src/components/ExploreWorldSheet.tsx),
[`JoinConfirmDialog.tsx`](../src/renderer/src/components/JoinConfirmDialog.tsx).

## §4 Canvas and glow

The document body owns the aurora and scanline pseudo-elements. Keep the blue
corner upper-left and orange corner lower-right in both themes. Background glow
and the intended tint of a glass pane are separate controls. Changing the glow
must not change informational surface colors or invent a new opacity recipe.

Use [`applyGlow`](../src/renderer/src/hooks/useApplyGlow.ts) and the production
Muted, Standard, and Vivid settings. Standard has no `data-glow` attribute.
In light mode Standard is intentionally stronger than Muted. The exact values
live in `main.css`; do not make Standard a synonym for Muted in examples.
Honor reduced motion and retain the same static composition when it is enabled.

## §5 Color channel law

This section retains its number for issue and source references.

`presence.state` and VRChat `status` are independent inputs. State is
`in-game | active | offline`. VRChat status is `join-me | online | ask-me | dnd`.
The upstream status string `active` normalizes to Online; it is not the same
thing as presence state `active`, which means online outside the game.
ChilloutVR has no VRChat status, custom status, or trust rank. Never fabricate them.

Use [`ringFor`](../src/renderer/src/utils/statusRing.ts) for the avatar fold:

- Active and offline friends use their presence ring.
- In-game VRChat friends use their status tier.
- In-game friends without a status system use Online, including ChilloutVR.
- Row avatars have a glyphless corner marker and an accessible state label.
  Drawer avatars omit the marker; the drawer includes the written status band.

Do not reintroduce a separate row status pill or infer raw presence from ring
color alone. Platform identity remains readable through the VRC/CVR text tab or
platform pill as well as tint. The linked-person rail says VRX. Color, position,
and an appropriate label or glyph work together. The historical R12
black-and-white check still applies; the row avatar's accessible label and
written drawer status are the approved form for that compact state treatment.

The historical R6 privacy rule still applies. Ask Me and DND hide world and
instance details. Active/offline friends never expose a stale cached instance.
Use the shared hidden-location and membership predicates for rows, drawers,
Hot Instances, and actions. Do not put hidden identifiers in gesture metadata.

Join eligibility is a separate decision. Use
[`isFriendJoinable`](../src/shared/joinability.ts) and the existing Join flow.
There is no implemented Ask-to-join action. "Always ask" in launch preferences
means choosing a launch mode, not requesting an invitation.

Keep names neutral. Any available VRChat trust rank appears as quiet 12px plain
text below Notes in the drawer. A combined linked profile can use its VRChat
member's rank. There is no row trust pill, trust-display toggle, or CVR equivalent.
Do not claim VRChat trust is deprecated.

## §6 Instance labels and policy

This section retains its number for issue and source references.

Keep the underlying `InstanceInfo.type` platform-true. The model has eight
VRChat types and nine ChilloutVR types, including CVR Offline Instance. Resolve
all displayed access pills through
[`instancePillFor`](../src/renderer/src/utils/instancePill.ts) and render
[`InstancePill`](../src/renderer/src/components/InstancePill.tsx).

The naming schemes are `vrchat`, `platform-native`, and `chilloutvr`; `vrchat` is
the default on both platforms. The selector order is VRChat, Per-platform,
ChilloutVR. Label maps live in
[`instanceTypeLabels.ts`](../src/renderer/src/utils/instanceTypeLabels.ts).
Do not copy a map into a component or derive labels from colors.

Pills are word-only, using the shared height, radius, and tier recipe. Keep full
Group labels. Friend-family tiers use the green-to-orange palette; group-family
tiers use purple. The visible words remain required.

`opennessUnknown: true` resolves to neutral Unknown under every scheme, even if
the parser supplied a restrictive fallback type. Hidden in-game locations can
show neutral Private. CVR Offline Instance is neutral and scheme-invariant.
These states share a material treatment but retain distinct words. No pill
appears for an active/offline person's stale location.

Policy space is separate from access. Use
[`policySpaceFor`](../src/renderer/src/utils/instancePolicySpace.ts) and
[`PolicySpacePill`](../src/renderer/src/components/PolicySpacePill.tsx).
Public space uses rose, Private space uses ice, and Unknown uses neutral tokens.
Never infer access, membership, or join permission from this moderation label.
Keep the current platform-specific explanatory copy in the translation files.

The guide demonstrates canonical model values. It does not prove every upstream
CVR wire form. Read [`api-volatility.md`](api-volatility.md) before changing a
mapping; do not invent a raw value for Offline Instance.

## §7 Typography

Inter is the UI face for names, headings, labels, controls, body text, status,
and help. VT323 accents the VRX mark, section kickers, and prominent statistics.
Technical identifiers may use the component's existing readable monospace face;
the Hot Instance ID uses `ui-monospace`, not VT323.

Dashboard section headings share `--text-faint` and normal weight 400 in both
themes. Hot Instances keeps its 18px uppercase kicker; Popular now keeps its
20px heading and existing tracking. Preserve their semantic `h2` elements and
leave primary page headings unchanged.

Load the licensed local WOFF2 files through `main.css`. Preserve the font
provenance and license assets. Do not load remote fonts, add another display
face, use negative letter spacing, or scale typography with viewport width.
Keep legitimate role differences such as Dashboard statistics and world titles.
Inspect the real component hierarchy and the guide's computed typography table
instead of copying a specimen's appearance into app code.

## §8 Shell and controls

Use [`AppShell`](../src/renderer/src/components/AppShell.tsx),
[`Sidebar`](../src/renderer/src/components/Sidebar.tsx), and
[`TopBar`](../src/renderer/src/components/TopBar.tsx). The sidebar stays fixed;
the main content owns feed scrolling. Settings uses category mini-pages and a
contextual top-bar selector, with no scroll at the supported 900×670 app floor.
On smaller work areas, the window floor yields so the app stays recoverable.
Do not invent a mobile app layout from a narrow documentation viewport.

The top bar owns the page's single heading. Its social selector reads
VRC / ALL / CVR and filters the relevant social view. The active sidebar spine
echoes that filter. Connection-health copy is real state, not decoration.
Settings replaces the social selector with its category control.

Use [`SegmentedControl`](../src/renderer/src/components/SegmentedControl.tsx)
and [`useSegmentedBubble`](../src/renderer/src/hooks/useSegmentedBubble.ts).
The glass track is 20px; its inset bubble is 16px and measures the active label.
Radiogroups have one sequential tab stop, arrow-key movement, and visible focus.
Combined/neutral options sit between the two scoped options. Preserve reduced
motion. Toggles communicate state with position and accessible switch state.

The updater uses the actual sidebar footer control. Idle is absent; available,
downloading, and downloaded have distinct actions and labels. The collapsed
icon wrapper must not shrink, and the hidden label has zero width. Hover/focus
may reveal the label without clipping the icon. Use neutral control tokens.
The guide's updater callbacks are inert and never download or install anything.

## §9 Component behavior

### §9.1 Friends and Dashboard

Reuse the existing Friends list's virtual rows and sticky collapsible sections:
In-Game, Online, Offline. Offline starts collapsed. Search exposes matches
without mutating saved collapse settings. Preserve roving avatar focus and
exclude offscreen overscan actions from sequential Tab navigation.

The avatar is the semantic details opener. Default whole-card pointer opening
extends that target while excluding Join and text-selection gestures. The Avatar
only preference keeps the row body inert. Instance-pill Join remains a separate
control using the existing confirmation and denial behavior.

Dashboard statistics count accounts. Hot Instances group by exact platform
instance identity, never merely world name or world ID. Preserve the configurable
threshold, readable world/name hierarchy, instance action, and platform label.
The actual Hot Instance sheet supplies details; do not add placeholder actions.

### §9.2 Friend drawer

The drawer is a non-modal frosted panel. Its soft scrim does not block input.
Escape, outside pointerdown, and Close use the same dismissal path; another
opener switches the profile. Restore focus to a connected opener or the existing
search fallback. Keep closed content inert and hidden from assistive technology.
While a confirmation modal is open, the drawer defers its dismissal listeners.

Keep header, written status, Where, actions, Notes, quiet Trust, and Identities
in the implemented order. Where cards preserve privacy, neutral missing art,
and instance labels; they do not show raw IDs or policy pills. Split cards
attribute each platform. A note load without a valid account revision stays
read-only with explicit Retry. Failed saves retain the local draft and warning;
ordinary successful saves stay quiet. Do not retarget a draft on presence change.

### §9.3 Confirmation and sheets

Join confirmation is a true heavy-frosted modal. Preserve focus containment,
Cancel, permission denials, live-target review, session boundaries, and disabled
in-flight behavior. Main remains the final authority. Confirmation preferences
must not bypass the shared permission or target checks.

Explore and Hot Instance sheets stay contained and non-modal. Close remains
reachable outside the scrolling room/details area. Escape/outside/Close restore
their opener or a stable fallback. A confirmation modal owns dismissal while
open. Dashboard's two sheet types remain mutually exclusive.

### §9.4 Explore and feedback

Explore and Dashboard Popular now import the same responsive full world card.
Equivalent platform content has equal card treatment. Use People for occupancy;
do not restore the removed Visible rooms metric or duplicate the top-bar heading.

Dashboard and Explore show one platform-neutral "Worlds loading…" message while
any selected platform has initial loading without usable results, including beside
cards already available from the other platform. Keep those cards visible. End the
message once no selected source is initially loading; filtered-out or terminal
sources do not keep it alive. Ordinary refresh with retained cards stays quiet. Preserve meaningful errors,
unavailable sources, stale results, and verified empty states. Unknown or partial
counts remain unknown, never zero. Sheet coverage and disabled actions must
reflect the supplied snapshot. No documentation example may add polling.

Auth examples use the actual credentials and method-specific 2FA forms. Secure
storage failure keeps the dedicated production error copy. Fixtures accept only
invented sample input and never authenticate or persist it.

## §10 Cross-platform friend linking

This section retains its number for issue and source references.

Linking is explicit and local. Each person has one account-qualified VRChat
member and one ChilloutVR member. Preserve original account names and notes;
a new link begins with a separate blank shared note. Never infer a link from
similar names or presence, or read/write VRCX or CVRX data.

The platform filter projects the saved person without modifying the link.
All may combine the accounts; a single-platform view shows its account. Header
selection prioritizes in-game, then active, then offline, with preferred platform
breaking ties. A merged picture changes artwork only, not the source of status.
The two-location treatment uses a hard centered 45-degree split, VRChat
upper-right and CVR lower-left. Its chooser never silently picks a destination.

Combined Join opens the shared destination chooser even with one eligible
choice. Explicit account views use the normal direct flow. A choice invalidated
by observed drift stays invalid until reopened. Hidden or stale location data
must not become an action or leak through metadata. Friends' online count uses
unique people; Dashboard statistics remain account-based.

Identities uses native modal dialogs for link management. Replacement/unlink
reviews disclose affected pairs and shared-note loss with explicit acknowledgement.
Unsaved/in-flight drafts block destructive submission and offer return to their
editor. Reviewed revisions must still match. Preserve account ownership checks,
all-or-nothing writes, explicit retry, and account-boundary invalidation.

Sources: [`projectLinkedFriends.ts`](../src/renderer/src/utils/projectLinkedFriends.ts),
[`FriendDrawer.tsx`](../src/renderer/src/components/FriendDrawer.tsx),
[`IdentitiesDialog.tsx`](../src/renderer/src/components/IdentitiesDialog.tsx),
[`LinkedDialog.tsx`](../src/renderer/src/components/LinkedDialog.tsx), and the
[renderer contract](../src/renderer/AGENTS.md).

## §11 Scope limits

Known app findings about Join/access emphasis, Full below capacity, and Private
versus Hidden wording remain separate work. Do not present them as approved
rules or fix them incidentally in a documentation change. Proposed designs must
be labeled as proposals and must not replace current examples before approval.

The VRX-276 information backing implements the approved no-color-bleed rule in
§3. The guide imports that production material directly. A source or synthetic
fixture check does not establish owner acceptance in an installed app. Never
conceal a remaining product defect with preview-only styles.

Preserve access to existing controls and workflows. Security, credential,
account, API-rate, and merge rules remain in the root contract. No visual change
waives them. Historical R2/R10/R12 references require a non-color signifier;
R6 refers to the location privacy rule in §5.

## §12 Workflow and verification

1. Read the owning source and [`INTERNAL-API.md`](INTERNAL-API.md). Reuse the
   existing component, resolver, hook, store, and translation before adding one.
2. Run `npm run guide:dev`, then open
   `http://127.0.0.1:4173/design.html`. Use `glass.html?scene=dashboard` for a
   standalone scene. Guide controls stay outside the production examples.
3. Verify representative widths, both themes, glow settings, real typography,
   material over busy content, overflow, keyboard focus, reduced motion, and
   reachable loading/error/disabled states. Screen capture requires the owner's
   explicit one-time consent for each capture and target. Use the requested
   browser surface; report an actual capability limit before substituting.
4. A served page or successful build is not an observed render. Synthetic scenes
   prove only their fixture behavior, not live platform/account behavior or a
   packaged Electron installation.
5. Run `npm run guide:build` and the guide fixture tests. For app/build changes,
   also run the root gate and relevant behavior tests. Keep guide code and output
   excluded from packaged app artifacts. Do not mount the normal app bootstrap,
   reuse a live preload bridge, load remote art, or forward fixture actions.
6. Settle the human guide and examples, then synchronize this contract and the
   owning DOX/index/changelog files. Preserve numbered sections referenced by
   source and issues. Use the review and delivery rules in the root contract.

The source-backed guide uses `guide/production.css` to include the renderer's
Tailwind utilities explicitly. Its isolated documents preserve root theme,
body background, portal, and fixed-position behavior. Desktop samples preserve
900×670 and scroll within a narrower guide. Focus-taking overlays wait for a
reader gesture. Shared scenario controls include each platform's first load,
quiet retained-card refresh, and note failure/retry. Each scene starts with
synthetic memory, and reset reloads that scene. Do not replace real components
with copied HTML to make a preview look right.
