# VRX Design System — AGENT SPEC

<!-- AUDIENCE: AI coding/design agents. Human contributors read design.html (rendered guide) instead. -->
<!-- ROLE: Authoritative, enforceable spec for every VRX UI surface. Comply with every MUST/NEVER. -->
<!-- VISUAL REFERENCE (source of truth for exact rendering): glass.html -->
<!-- CONFORMANCE: MUST / MUST NOT / NEVER / ALWAYS = hard gates. SHOULD = strong default. -->
<!-- STABLE ANCHORS: §5, §6, §10 are cited by Linear issues (VRX-141, VRX-130, VRX-143). DO NOT renumber. -->

## RULES DIGEST — read before emitting any UI

```
R1  Every floating surface = .glass (§3). NEVER opaque/solid card backgrounds.
R2  Color == meaning, never decoration. Each meaning has ONE fixed location + a non-color glyph (§5).
R3  Platform hues: --vrc(blue)=VRChat, --cvr(orange)=ChilloutVR. NEVER swap. NEVER reuse blue/orange for non-platform meaning.
R4  STATE == the avatar DOT only: in-game=green, active=teal (online-not-in-game), offline=gray. NEVER color text/panels by state; NEVER make it blue. (Friend-row ring: a statusless in-game friend folds to the tier-2 Online ring, not the state palette — §5/VRX-207.)
R5  Openness == colored by its §6 LADDER TIER (owner-ratified 2026-07-01: friend ladder green→orange open→locked, groups purple by shade, hidden/offline-instance neutral) — NEVER by platform. The friend-row pill is the tier-colored form; icon badges elsewhere stay neutral gray until migrated (VRX-71).
R6  STATUS (VRChat: Join Me/Online/Ask Me/DND + custom msg) renders as a LABELED colored pill, NEVER a bare dot. Joinability ACTION (Join/Ask/⊘) is separate + neutral. Ask Me/DND hide the world. CVR has NO status (§5). [Friend-row carve-out: ring + corner badge + aria-label replace the pill (the badge's svg glyph was RETIRED — owner 2026-07-17/VRX-69; the drawer's WRITTEN status band (§9.2) is the long-form signifier); openness pill IS the join target — §9.1.]
R7  Trust == OFF by default, names neutral, opt-in muted pill only (§5). NEVER color a name by trust. NEVER default-on.
R8  Type: Inter = all readable text. VT323 = accent ONLY (mark, big numbers, kickers, glyphs, IDs) (§7). NEVER VT323 for body/helper/status/labels.
R9  NEVER hardcode color/spacing outside tokens (§2). NEVER auto-merge cross-platform identities (§10). NEVER write to VRCX/CVRX folders.
R10 NEVER rely on color alone — always color + position + glyph/text. ALWAYS honor prefers-reduced-motion. (The friend-row color-only platform exception was REVERSED by VRX-206, owner 2026-07-11: the row's platform tab carries tint + position + sideways `VRC`/`CVR` text — §9.1.)
R11 Light mode is a token/material shift only (§2A–§4A). SAME layout, typography, channel law, glyphs, and component grammar. NEVER make a separate-looking app.
R12 EVERY new/changed component MUST pass the BLACK-AND-WHITE test (owner law, 2026-07-11 / VRX-206): rendered fully desaturated (`filter: grayscale(1)`, dark AND light), the user can still tell what platform it belongs to and what it means — via glyph, text, pill, or position. Verify on the render check BEFORE merge. Reference PASS: the dashboard hot-card platform pill; reference FAIL that created this rule: the color-only friend-row spine.
```

Conflict resolution: a more specific section overrides the digest only where it adds detail, never where it contradicts a NEVER.

---

## §0 Identity
One-line model: *dark translucent liquid-glass companion for VRChat + ChilloutVR; frosted panels over a near-black canvas with blue + orange corner glows (no third hue); VT323 + faint CRT scanlines = "old-internet" accent.*
DIRECTIVE: operational + readable FIRST; unique via material (glass/aurora/VT323), not via decoration. Set apart from both platforms' own apps. Do not produce marketing/landing-page layouts.
LIGHT MODE DIRECTIVE: light mode keeps the exact same VRX identity and interaction grammar; only the canvas, glass fill, token values, and contrast tuning shift lighter.

## §1 Brand mark
- MUST render per-letter spans: `V`=`--vrc`, `R`=`--bridge`, `X`=`--cvr`. NEVER a full-word gradient (orange vanishes at small sizes).
- `<div class="brand"><span class="v">V</span><span class="r">R</span><span class="x">X</span></div>`, font `--font-mono` (VT323).
- Subtitle = "Social VR Companion". Window/page title = current view name.
- Platform logos: official assets ONLY, `<img>` + `object-fit:contain`. NEVER fabricate/trace/approximate; NEVER place in fake badges/frames.

## §2 Tokens — AUTHORITATIVE (copy verbatim; Tailwind v4: static scale via `@theme`, THEMED colors stay raw CSS vars — VRX-4)
```css
:root{
  --bg-base:#08080b; --text:#f3f1fb;   /* near-black, neutral (no purple cast) */
  --text-dim:rgba(231,225,250,0.72); --text-faint:rgba(216,208,242,0.46);
  --border:rgba(255,255,255,0.10); --surface-hover:rgba(255,255,255,0.05);
  --control-fill:rgba(255,255,255,0.05); --control-fill-hover:rgba(255,255,255,0.10); --error:#f87171;
  --space-0-5:2px; --space-1:4px; --space-2:8px; --space-2-5:10px; --space-3:12px;
  --space-4:16px; --space-6:24px; --space-8:32px; --space-10:40px;
  --friend-status-description-width:160px;
  /* PLATFORM — deep + saturated (tab/pill/tint only) */
  --vrc:#2b7ce8;     /* VRChat / blue        rgb(43,124,232) */
  --cvr:#f3711e;     /* ChilloutVR / orange  rgb(243,113,30) */
  --bridge:#e8e8f0;  /* neutral merge accent (silver) — VRX mark "R", "hot" stat; user-customizable later */
  /* STATE — avatar dot; in-game + offline match CVR */
  --ingame:#34d399;  /* state="online"  — in a world */
  --active:#2dd4bf;  /* state="active"  — online, NOT in game (web/app) */
  --offline:#6b6480;
  /* STATUS — VRChat user intent (labeled pills ONLY) */
  --st-joinme:#3aa0ff; /* status="join me" */
  --st-online:#43c95a; /* status="active" → displays "Online" */
  --st-askme:#ff9a3d;  /* status="ask me" */
  --st-dnd:#e5484b;    /* status="busy"   → displays "Do Not Disturb" */
  --st-joinme-text:var(--st-joinme); --st-online-text:var(--st-online);
  --st-askme-text:var(--st-askme); --st-dnd-text:var(--st-dnd);
  --glass-blur:blur(26px) saturate(165%);
  --font-mono:'VT323',ui-monospace,monospace;  /* accent only */
}
```
RULE: platform values are deep/saturated, UI-tuned for dark glass. Deeper hero/login hues are a SEPARATE set; NEVER use hero hues in app chrome. Body/UI font = Inter (400–800).

## §2A Light mode tokens — AUTHORITATIVE (copy verbatim; → Tailwind v4 @theme, VRX-115)
Light mode is NOT a new palette. It is the same VRX channel system remapped for readability on pale glass: VRChat remains blue, ChilloutVR remains orange, bridge remains neutral, presence/status keep their meanings.
```css
[data-theme="light"]{
  --bg-base:#eef3f8; --text:#14131c;
  --text-dim:rgba(30,28,42,0.72); --text-faint:rgba(52,49,70,0.48);
  --border:rgba(40,48,68,0.16); --surface-hover:rgba(20,19,28,0.045);
  --control-fill:rgba(20,19,28,0.045); --control-fill-hover:rgba(20,19,28,0.09); --error:#b4232c;
  /* PLATFORM — same meanings, tuned darker for light glass */
  --vrc:#1f6fd3;     /* VRChat / blue        rgb(31,111,211) */
  --cvr:#d85f18;     /* ChilloutVR / orange  rgb(216,95,24) */
  --bridge:#30323b;  /* neutral merge accent (ink/silver) */
  /* STATE — avatar dot only */
  --ingame:#0f9f6e;
  --active:#0d9488;
  --offline:#8a8d99;
  /* STATUS — VRChat labeled pills ONLY */
  --st-joinme:#1d78d8;
  --st-online:#169a4a;
  --st-askme:#cf6a18;
  --st-dnd:#c9363a;
  --st-joinme-text:#124e91; --st-online-text:#0f6e35;
  --st-askme-text:#91480e; --st-dnd-text:#8d2428;
  --glass-blur:blur(24px) saturate(142%);
}
```
RULE: dark remains the baseline/default. Light overrides MUST live behind an explicit theme selector (`[data-theme="light"]`, `.theme-light`, or equivalent) and MUST reuse the same semantic token names. NEVER create parallel component classes just for light mode.

`--control-fill` and `--control-fill-hover` are neutral interactive-control surfaces. Use them as a paired idle/hover affordance for buttons and similar controls; they do not carry platform, state, or status meaning. Static spacing tokens live in `:root` because spacing does not theme-switch; use them for component spacing instead of raw scale utilities on touched surfaces.

## §3 Glass material
```css
.glass{position:relative;
  background:linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.025));
  backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);
  border:1px solid rgba(255,255,255,0.13);border-radius:20px;
  box-shadow:0 12px 44px rgba(0,0,0,0.50),inset 0 1px 0 rgba(255,255,255,0.22),inset 0 -1px 1px rgba(255,255,255,0.05);}
.glass::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(125% 80% at 0% 0%,rgba(255,255,255,0.11),transparent 46%);}
.tint-vrc{background:linear-gradient(135deg,rgba(43,124,232,0.22),rgba(43,124,232,0.05));border-color:rgba(43,124,232,0.34);}
.tint-cvr{background:linear-gradient(135deg,rgba(243,113,30,0.22),rgba(243,113,30,0.05));border-color:rgba(243,113,30,0.36);}
```
- MUST always include the inset top highlight WITH the depth shadow (else reads flat). WHY: simulates lit top edge + shadowed underside.
- Radius scale: panels/cards `20px`; nav/segmented/buttons `12–13px`; pills/affordances `9–10px`.
  - **The stack model (owner law, 2026-07-11 / VRX-206):** surfaces read as physical LAYERS stacked on top of each other — background → panel → card → pills/tabs on the card. An element placed onto a parent surface gets an EVEN inset on every attached side and a radius derived concentrically from the parent (inner = outer − border − gap; the friend-row platform tab: 13 − 1 − 3 = **9px**). Never butt an element flush on some sides and gapped on others — "stacked on, never slapped on".
  - **Carve-out (owner-ratified 2026-06):** the **segmented control track** uses the `20px` panel radius, not 12–13px. It's a `.glass` surface and `.glass` (un-layered) overrides any `rounded-[..]` utility anyway; the owner chose to keep the rounder look. Its sliding bubble is then `16px` (= 20 − 4px inset) so it seats concentrically. If you want a control back on the 12–13px scale, you must override `.glass`'s radius explicitly.
- Platform tint opacity ceiling = `0.22`. Above → reads as solid plastic (loses glass).
- `.tint-vrc`/`.tint-cvr` used ONLY where the surface belongs to one platform (e.g. hot-instance cards).

## §3A Light glass material
```css
[data-theme="light"] .glass{
  background:linear-gradient(135deg,rgba(255,255,255,0.70),rgba(255,255,255,0.28));
  border-color:rgba(40,48,68,0.16);
  box-shadow:0 16px 46px rgba(59,72,93,0.22),inset 0 1px 0 rgba(255,255,255,0.88),inset 0 -1px 1px rgba(40,48,68,0.08);}
[data-theme="light"] .glass::before{
  background:radial-gradient(125% 80% at 0% 0%,rgba(255,255,255,0.72),transparent 48%);}
[data-theme="light"] .tint-vrc{background:linear-gradient(135deg,rgba(31,111,211,0.18),rgba(255,255,255,0.34));border-color:rgba(31,111,211,0.28);}
[data-theme="light"] .tint-cvr{background:linear-gradient(135deg,rgba(216,95,24,0.18),rgba(255,255,255,0.34));border-color:rgba(216,95,24,0.30);}
```
- Light glass MUST still read as frosted VRX glass: white pane, visible border, inset highlight, depth shadow, and top-left sheen all remain required.
- Light platform tint opacity ceiling = `0.18`. Higher values overpower the white pane and make the app feel like a different product.
- Component contrast overrides: hover/fills use low-alpha ink (`rgba(20,19,28,0.045)`); active glass controls use white fill + ink border; avatar state-dot border becomes `#eef3f8`; neutral openness badges use white/ink gray, never blue/orange.
- Light status pill text MUST use darker readable companion colors: Join Me `#124e91`, Online `#0f6e35`, Ask Me `#91480e`, DND `#8d2428`, with low-alpha status backgrounds and borders.

## §4 Background
The aurora is a USER SETTING since VRX-211 (owner-ratified live design round, 2026-07-17): **Background glow = Muted · Standard (default) · Vivid**. `body::before` consumes `--glow-*` custom properties (main.css §4 block); the level is applied as a `data-glow` attribute on the root by `useApplyGlow` — same mechanism family as the theme (DEFAULT **Standard** = attribute ABSENT; `data-glow="muted"|"vivid"` set explicitly). The gradient list is STATIC (4 layers — two corner glows + two wisps); levels change only var values, never layer structure.

| Level | Size x·y | Fade | Intensity× (on the §4/§4A base alphas) | Wisps |
|---|---|---|---|---|
| muted (the pre-VRX-211 shipped look) | 58% 50% | 60% | 1.00 | no |
| **standard (DEFAULT)** | 95% 78% | 74% | 1.15 | no |
| vivid | 120% 95% | 82% | 1.50 | yes |

Base alphas (×intensity): dark vrc .26 / cvr .20; light vrc .18 / cvr .15. Corner anchors stay 12% 6% / 92% 96% at every level. Wisps (vivid only; alpha-zeroed otherwise) = `34% 26% at 30% 22%` vrc ×.10 and `30% 24% at 74% 78%` cvr ×.085, fade 68% — organic texture, never a third hue.
- Aurora = the two platforms as light: blue corner (top-left) + orange corner (bottom-right) over neutral near-black; NO third hue at ANY level. Static in v1. Animate ONLY behind a `prefers-reduced-motion` guard.
- Scanlines stay ~2.2% white on overlay = texture, not a filter (glow-level independent). NEVER raise to a visible grid.

## §4A Light background
Light keeps the same var-driven structure; `[data-theme='light']` (and its `[data-glow]` compositions) override only the alpha vars per the ×intensity table in §4. Reference shape (standard level):
```css
[data-theme="light"] body::before{background:
  radial-gradient(var(--glow-size-x) var(--glow-size-y) at 12% 6%,rgba(31,111,211,var(--glow-a-vrc)),transparent var(--glow-fade)),
  radial-gradient(var(--glow-size-x) var(--glow-size-y) at 92% 96%,rgba(216,95,24,var(--glow-a-cvr)),transparent var(--glow-fade)),
  linear-gradient(180deg,#fbfcff 0%,var(--bg-base) 48%,#e7edf4 100%);}
[data-theme="light"] body::after{
  background:repeating-linear-gradient(0deg,rgba(20,19,28,0.026) 0 1px,transparent 1px 3px);
  mix-blend-mode:multiply;opacity:0.42;}
```
- The same blue top-left / orange bottom-right composition is mandatory in light mode. The app should feel sunlit, not rebranded.
- Scanlines remain subtle and functional as texture. In light mode they are dark ink at low opacity with multiply; never use white overlay scanlines.

## §5 COLOR CHANNEL LAW (core — cited by Linear)
Each meaning owns a fixed LOCATION + a non-color GLYPH/LABEL so hues never collide. Status colors are allowed ONLY inside labeled pills in their own location — never as bare dots. Lookup:

| Channel | Location (only here) | Encoding | NEVER |
|---|---|---|---|
| Platform | glass tint + left tab/stripe + `VRC`/`CVR` text label (row tab §9.1 · card pill §9) | `--vrc` blue / `--cvr` orange | a bare dot; color-only platform; non-platform use of blue/orange |
| State (presence) | the avatar **dot** | in-game `--ingame` green · active `--active` teal · offline `--offline` gray | color on text/panel; making it blue |
| Status (VRChat) | a **labeled pill** | Join Me / Online / Ask Me / DND (VRChat hues) + custom msg | a bare dot; reusing the dot; a CVR equivalent |
| Openness | right-side instance **pill** (friend row) / icon badge | `--op-*` tier color + VRChat-scheme label (§6 ladder + label rule, VRX-182); hidden/offline-instance = neutral | color by platform; a hue for Private |
| Joinability | right-side **affordance** | `Join` / `Ask` / `⊘` (neutral, derived) | reusing a platform/status hue |
| Trust | opt-in muted pill (right) | OFF by default; names neutral | name color; default-on |

### VRChat presence = TWO separate API fields (DO NOT conflate)
`state` (system-assigned) → the DOT:
```
"online"  → in VRChat / in a world           → --ingame (green)
"active"  → online but NOT in game (web/app)  → --active (teal)
"offline" → offline                           → --offline (gray)
```
`status` (user-chosen intent) → the PILL  (+ `statusDescription` = custom text, ≤32 chars):
```
"join me" → "Join Me"        --st-joinme blue  | location visible; join requests AUTO-accepted
"active"  → "Online"         --st-online green | location visible; joinable if instance allows
"ask me"  → "Ask Me"         --st-askme orange | location HIDDEN; invite requests allowed
"busy"    → "Do Not Disturb" --st-dnd    red   | location HIDDEN; requests allowed, NO notifications
```
⚠️ `status:"active"` = **Online (green)**; `state:"active"` = **online-not-in-game**. Different fields, near-opposite meanings. Parse both.
⚠️ Ask Me / DND HIDE the instance → show status + custom msg, NOT a world/openness.

### Decision rules
- State appears ONLY as the dot. `--active` is teal (not blue) so it never reads as platform.
- Status appears ONLY as a labeled pill in VRChat hues. WHY allowed: a labeled pill in a fixed location can't be confused with the platform tab (left) or the state dot. NEVER render status as a bare colored dot.
- **The status axis is an ordered PRIVACY TIER (owner-ratified 2026-07-11, VRX-208)** — least→most private: **Join Me (1) < Online (2) < Ask Me (3) < DND (4)**; `offline`/`active` are the OTHER axis (presence state), never tiers. The status hues (blue→green→orange→red) ARE the tier ramp — cool→warm = open→closed, the same shade grammar as the §6.1 openness ladder (person-side ↔ instance-side, one language). A platform without a status system maps its plain "online" onto **tier 2**: the friend-row ring for a statusless in-game friend takes the `--st-online` ring + check (VRX-207) — the state palette (`--ingame` + gamepad) never leaks into the ring as a platform difference. Future platform statuses map by MECHANICS, not name.
- Joinability is a SEPARATE neutral action derived from status+instance: Join Me/Online→`Join`; Ask Me→`Ask`; DND→`⊘`; active/offline→none. NEVER tint it with a platform/status hue.
- CVR: state online/offline ONLY (online↔`--ingame`, offline↔`--offline`, matching VRChat). NO status pill, NO custom status, NO `active` state. NEVER fabricate a CVR equivalent.
- Trust: names neutral; trust only as an opt-in muted gray pill. WHY: VRChat is phasing out trust visibility; CVR has none.
- A11y (hard): every channel = color **+** position **+** glyph/label. Color is NEVER the sole signal.
- **Friend-row consolidation (§9.1 — owner-approved A11y carve-out):** in the *friends list row only*, the channel FORMS consolidate — STATE+STATUS fold into the avatar's color **ring + corner badge + `aria-label`** (replacing the separate dot + pill; the badge's svg glyph was retired 2026-07-17/VRX-69 — the aria-label plus the drawer's written status band carry the text); OPENNESS+JOINABILITY merge into ONE right-side **instance-type pill** that doubles as the join target; and PLATFORM is carried by the far-left **platform tab** — platform-tinted, with the sideways `VRC`/`CVR` acronym and a full-name `aria-label` (VRX-206; supersedes the 2026-06 color-only spine carve-out, which the owner reversed on seeing real mixed-platform data). The LAW's intent now holds everywhere in the row: no channel is color-alone. See §9.1 for the full row spec.

## §6 OPENNESS LADDER (instance-type consistency — cited by Linear)
Both platforms have **8 instance types** that map almost 1:1 onto ONE shared openness ladder + a `Group` modifier. Icon IDENTICAL across platforms; label stays platform-true.
Scale (open→closed): `Public → Friends+ → Friends → Invite+ → Invite`. `Group` = chip MODIFIER on top of openness (a group instance is still public / friends-extended / members-only).
Shared icon sprite: `#o-public`(globe) `#o-fof`(person+plus) `#o-friends`(person) `#o-invite`(envelope) `#o-group`(two people).

### §6.1 Openness COLORS (owner-approved 2026-07-01 — replaces "badge always neutral gray")
The instance pill is colored by TIER so the type reads by color alone (hue = family, shade = tier; label carries the last mile). Tokens `--op-<tier>` / `--op-<tier>-text` in main.css:

| Tier | dark | dark text | light | light text |
|---|---|---|---|---|
| Public | `#3ee36a` | = hue | `#1fae4e` | `#147a36` |
| Friends+ | `#b7de4f` | = hue | `#7fa821` | `#5c7a16` |
| Friends | `#e6c353` | = hue | `#b28a1d` | `#82651a` |
| Invite+ | `#ffc172` | = hue | `#d98324` | `#9a5c14` |
| Invite | `#ffa14e` | = hue | `#c96a20` | `#8f4c15` |
| Group Public | `#bfa0ff` | = hue | `#7a5fd0` | `#5b429e` |
| Group+ | `#9d80f6` | = hue | `#6d4fc9` | `#4f38a0` |
| Group | `#8d61f0` | `#b795ff` (lifted) | `#5f3fc4` | `#452f96` |
| Private / Offline Instance | neutral: text `--text-dim`, bg `color-mix(--text 7%)`, border `color-mix(--text 16%)` | | | |

Pill treatment: text `--op-<tier>-text` · bg `color-mix(in srgb, var(--op-<tier>) 13%, transparent)` · border `36%` mix. Rules: friend ladder = green (open) → orange (locked), deliberately LIGHT oranges so Invite never reads as the CVR platform hue (`--cvr` stays deep red-orange); groups = purple family, lighter = more open; **Private/Offline-instance = hueless but readable** (they must recede behind joinable pills, never strain). CVR types color by their tier column above (FoF = Friends+, Everyone-Can-Invite = Invite+, Owner-Must-Invite = Invite, Friends-of-Members = Group+, Members-Only = Group).

**Pill presence rule (owner 2026-07-01):** a friend IN A WORLD always gets a pill — the tier label when visible, **"Private"** when the location is hidden (VRChat sends `location:"private"` for ANY friend in a private instance, regardless of status — `presence.state` is the in-world truth, never `status`). No pill ONLY when truly not in a world: offline, or online-on-web/app (`state:"active"`).

**Pill label rule (owner 2026-07-03, VRX-182):** pills DEFAULT to the **VRChat naming scheme on BOTH platforms** — a CVR instance shows its tier's VRChat label ("Friends of Friends" → "Friends+", "Friends of Members" → "Group+", "Members Only" → "Group"). One vocabulary keeps merged friend lists consistent, and the short labels fit the pill column. The DATA stays platform-true (`InstanceInfo.type` is untouched). **The scheme is user-selectable (VRX-183): Settings → Instance labels** — VRChat (default) / ChilloutVR (the reverse mapping, VRChat types wear CVR terms) / Per platform (each platform's native terms). The ChilloutVR column below documents each platform's native term. CVR **"Offline Instance"** has no VRChat counterpart and renders the same under every scheme. Label maps: `src/renderer/src/utils/instanceTypeLabels.ts` (`LABEL_KEYS_BY_SCHEME`).

Unified mapping — verified vs VRChat wiki + ChilloutVR docs (2026-05):

| Openness tier | icon | VRChat | ChilloutVR (native term — pill shows the VRChat label, VRX-182) |
|---|---|---|---|
| Public | `#o-public` | Public | Public |
| Friends+ | `#o-fof` | Friends+ | Friends of Friends |
| Friends | `#o-friends` | Friends | Friends |
| Invite+ (open invite) | `#o-invite` | Invite+ | Everyone Can Invite |
| Invite (closed) | `#o-invite` | Invite | Owner Must Invite |
| **Group** · public | `#o-public` + group chip | Group Public | Group Public |
| **Group** · friends-extended | `#o-fof` + group chip | Group+ (groupPlus) | Friends of Members |
| **Group** · members only | `#o-group` | Group | Members Only |
| Offline *(not joinable)* | `#o-offline` | — | Offline Instance |

The group sub-track is near-identical (Group Public↔Group Public; Group+↔Friends of Members; Group↔Members Only). CVR classes Public / Group Public / Friends of Members / Friends of Friends as "public"; the rest private (Members Only is public if the group join privacy = "everyone can join"). CVR additionally surfaces an **Offline Instance** (`#o-offline` — local / non-networked: the friend is in-game but in a private offline world, not joinable; CVRX shows it), with NO VRChat privacy equivalent. CVR has NO trust ranks and NO JoinMe/AskMe/Busy. NEVER invent CVR concepts to force symmetry.
NOTE: names above are verified UI/display names. When building each adapter, confirm the exact API enum STRINGS (VRChat location tags → VRX-45; CVR API field values → CVR adapter); ship NO guessed values.

## §7 Typography
- Inter (400–800): ALL body/UI — names, labels, copy, buttons, world titles, statuses, helper text, modal body.
- VT323 (`--font-mono`): accent ONLY — VRX mark, big stat numbers, section kickers (uppercase, +tracking), `V`/`C` glyphs, technical IDs/versions. That is the complete allow-list.
- NEVER VT323 for body/helper/status/form-label/modal text. NEVER negative letter-spacing. NEVER scale font-size with viewport width. WHY: VT323 is a CRT terminal face — accent-legible, body-illegible.

## §8 App shell

**No-scroll rule (owner, 2026-07-05, VRX-186):** control surfaces don't scroll — feeds do. The friends list and future activity feeds scroll; **Settings must never scroll**: it is split into category mini-pages (Appearance | Dashboard, extending as sections are added). **The category nav renders in the TOP BAR's contextual slot** — the slot holds whichever control belongs to the active view: the platform filter on content views, the category nav on Settings (a platform filter is meaningless there; owner-decided). Same one-Tab-stop segmented dialect as every selector. The panel's section headings are sr-only (the nav is their visible label — no double-labeling). Active category is session state, not a persisted setting. Apply the same rule to any future control surface (wizards, dialogs): if it needs a scrollbar, it needs another page.

**Center-neutral rule — CORE, applies to EVERY segmented control (owner, 2026-07-05):** the neutral / combined / mixed option always sits in the **CENTER**; the polar or single-scoped options flank it. This is the app-wide slider language — a user who learns one control has learned them all. Enshrined instances (the `as const` arrays in code are the display order):
- Platform filter: **VRChat | All | ChilloutVR** (`SEG_ITEMS`, TopBar) — All mixes both platforms.
- Theme: **Dark | System | Light** (`THEMES`, `@shared/types`) — System resolves to either neighbor. Default remains System.
- Instance labels: **VRChat | Per-platform | ChilloutVR** (`LABEL_SCHEMES`, `@shared/types`) — Per-platform uses both platforms' terms.

Any NEW segmented control MUST follow this before it ships: identify the option that spans/mixes/defers (the "both/auto" one) and seat it in the middle. If no option is neutral (a pure enum like Compact/Detail), the rule is silent — but check before assuming.

```css
.app{display:grid;grid-template-columns:248px 1fr;height:100vh;padding:16px;gap:16px;}
body{overflow:hidden;}   .main{overflow-y:auto;}   /* shell fixed; only main scrolls */
```
- Sidebar (248px `.glass`): brand+subtitle → nav (Dashboard / Activity / Friends·count / Instances / Groups / Settings) → footer (`VRX` / `Social VR Companion · vX.Y.Z` — the version is BUILD-INJECTED from package.json via `__APP_VERSION__`, never hardcoded). Active nav = glass-gradient fill + left spine gradient `--vrc → --cvr`. "Activity" carries an unread badge. **(Status 2026-07-01: the Friends·count suffix and the Activity unread badge are spec'd but NOT YET BUILT — the nav renders plain labels; no tracking issue yet.)**
- Main: topbar (view title LEFT; the contextual control + online count share ONE RIGHT-ANCHORED dock — VRX-188: the title's width can never shift the control; count copy is "N online" with a reserved 3-digit tabular-nums cell, VRX-187's stability principle) → stat row → titled sections (`.secline` = VT323 kicker + dim hint). **(↻ segmented control REVISED by §9.1 — order `VRChat | All | ChilloutVR`, text-only `VRC/ALL/CVR`; it filters the whole view + drives the sidebar accent. ↻ VRX-188 moved it to the right dock; on Settings the category nav occupies the same dock — owner-ratified 2026-07-11 after live use.)**
- Dense desktop utility. No responsive collapse required for v1. Deadspace OK at view bottom, NOT between related cards.

## §9 Components (compose §3–§7; exact markup in glass.html)
- Stat card: `.glass`, big VT323 number tinted by meaning (online→`--active`, in-game→`--ingame`, hot→`--bridge`), dim Inter label.
- Hot-instance card **(↻ REVISED VRX-198, 2026-07-08; polished VRX-199, 2026-07-09 owner hands-on review)**: `.glass`+`.tint-vrc|cvr`; 4px top-edge gradient (platform→transparent). A **2×2 grid** — world name (**25px bold, line-height 1.5**, top-left; shares the line with the pill and lets descenders hang below — "lined paper"; truncates with ellipsis, full name in the `title` tooltip; **any trailing `(#…)` stripped display-only** — numeric instance ids AND custom tags like `(#teehee)`) + the shared **`InstancePill`** (the HERO, pinned top-right); who's-here (first 4 friend names then "+N", `--names-lift` brightness, bottom-left) + **`PlatformPill`** (bottom-right). The two pills share a `minmax(78px, max-content)` grid column → SAME width per card, edges aligned. **Visual-weight order (the card's law): world name → instance pill → who's-here → platform.** The platform pill is the **§5 non-color signifier** for CVD/low-vision users — a dim ghost outline (`--plat-<vrc|cvr>-ghost-text/border`, WCAG-AA in BOTH themes: dark 6.2/5.5, light 5.1/6.3): it recedes, but the LABEL stays readable — quietness lives in the pill, never the word. Whole-card click → detail panel deferred to VRX-59. The old `V`/`C` glyph box, icon openness badge, platform subtitle, and "N here" count are fully superseded.
  - **↻ VRX-199 — the two typography/layout calls from running it on real windows:** (1) VRX-198's "centre the name to the pill height so cap-top/baseline line up EXACTLY" forced 26px `line-height:1`, which **clipped descenders ~5.5px** (26px line box vs 31.5px glyph height — "Skyfall"'s y, "Night"'s g lost their tails); relaxed to **25px / `line-height:1.5`** (pill stays 28px, they just share the line). (2) The hot-instance **grid** is now max **2 columns that FILL the row**, **container-query** responsive (`.hotwrap` = query container — grid-only so its `contain:layout` never touches the heading/stepper; `.hot-grid` = tracks) → **1 column** on a narrow pane and a **lone card spans the full row** (`:only-child`); replaces the fixed 3-column grid that squished names to "Bo…/Sky…/Lun…". Owner chose *fill* over a max-width cap. Top three stat cards unchanged (fixed 3-across). Suffix strip broadened to **any** trailing `(#…)` (was numeric-only) — a name-internal hashtag ("Room #5") is never touched.
- Friend row: grid `14px | 42px | 1fr | auto` = platform tab · avatar (status ring + badge) · name + custom-status-beside / world subline · instance-type pill (= join target). Avatar click / Enter / Space on the avatar button opens the friend drawer (§9.2, VRX-69; ↻ VRX-225 — the opener is the AVATAR, not the whole row). **Platform tab (VRX-206, owner design round 2026-07-11):** a vertical platform-tinted pill stacked onto the card's left end — `background: color-mix(platform 13%, transparent)`, `border: 1px solid color-mix(platform 36%, transparent)`, text `--plat-vrc/cvr-ghost-text`; even **3px** inset from the card's inner left/top/bottom edges (grid col 14px + `-ml-[7px]` / `-my-[5px]` through `pl-[10px]`/`py-[8px]`); radius **9px** = card 13 − 1 border − 3 gap (§3 stack model); sideways `VRC`/`CVR` at 10.5px/600/0.09em (`writing-mode: vertical-rl` + 180° rotation, reads bottom-to-top). **(↻ BUILT per §9.1 — the old dot + `V`/`C` glyph + status pill + openness-in-subline + separate affordance is fully superseded.)**
- Activity feed row (the **Activity** view + a Dashboard preview): reverse-chronological log of friend events — world/instance change, online/active/offline, status change, incoming/accepted friend request, joined-your-instance, group events. Reuses the channel system (platform spine+glyph, state dot, status pill, openness badge on location events, join affordance when joinable) + a small **event-type glyph** + a dim **relative timestamp** (Inter, NOT VT323). MAX user control: scope = **All / Friends / Favorites** (+ specific favorite groups); per-event-type toggles; per-platform via the segmented control. Local/private (derived from polling, stored as local history). Models VRCX Feed/Friend Log; CVR-lighter. (Tracked: VRX-144 + VRX-53 instance history.)
- Segmented control: glass track; active = glass-gradient bubble + inset highlight. React: animate bubble via transform/width; reduce-motion shortens. NEVER fake selection with per-button bg. Option order follows the §8 **center-neutral rule** (neutral/combined option in the middle).
- Number stepper (`NumberStepper`, VRX-78/187): one `.glass` pill (20px), 4px padding; −/+ are 24×24 **CIRCLES** (§3 concentric: 20 − 4 = 16px ⇒ circle at 24px — same seating rule as the segmented bubble; owner-decided 2026-07-05). Value cell: **fixed 3-digit reservation** — `min-width: 36px`, `tabular-nums`, centered — the pill silhouette NEVER morphs as the value moves. One Tab stop (spinbutton + tabIndex −1 buttons); at a bound the button dims but stays in the DOM.
- Badges/pills: openness = neutral gray; platform glyph = platform-tinted square; VRChat status pill = labeled (§5).

## §9.1 Friends-UI redesign — owner real-data review (2026-06-25)
Decisions from the FIRST real-data Windows review (running app, real friends, ultrawide + normal + TV), refined against rendered mocks (2026-06-26). These **REVISE** the friend row + hot-instance card (§9), the segmented control (§8), and parts of §5/§6 — and supersede the prior spec where they conflict. Items marked **OPEN** are still being explored or carry a rule tension to resolve before building. These feed the existing M3 — Friends UI issues (VRX-64/66/67/68/71/76/78), not new ones.

**Build status (2026-07-01):** the **friend row** + **segmented control** are BUILT + render-verified, and the row's instance pill now carries the **§6.1 openness colors** + the always-Private rule. Still pending their issues: the **hot-instance card REDESIGN** (VRX-71 — the pre-redesign §9 card is built and live on the Dashboard; the §9.1 image-left/"+N more" redesign is not), Compact/Detail (VRX-68), and split-by-platform option (VRX-76). **(↻ 2026-07-12: real avatars VRX-48/202, click-to-join VRX-166, and the whole-view platform filter VRX-66 are BUILT.)**

**Friend row (revises §235 — BUILT, mock-approved 2026-06-26, render-verified):**
- **Faint, always-on card surface** (`color-mix(--text 4%)` + hairline) so rows read as separated cards. **Uniform height** — the 42px avatar sets it (measured 60px/row), so no-custom-status rows are no longer short (fixes the old bug).
- **Avatar far-left** (real image, main-fetched as a CSP-safe `data:` URL — VRX-48; the letter placeholder holds during load/failure), **wrapped in a status-color ring with a corner status badge.** Ring + badge + the avatar's `aria-label` carry the privacy tier — VRChat's set status, or for a statusless in-game friend the tier-2 **Online** fold (VRX-207: the state palette never leaks into the ring as a platform difference) — color **+** text, never color-alone. **(↻ REVISED, owner-ratified 2026-07-17 / VRX-69: the badge's svg GLYPH is removed — the badge is an empty 16px status-color dot (`border-2` in `--bg-base`, same corner position; offline stays badge-less). The non-color signifiers are now the avatar's `aria-label` in the row plus the drawer's WRITTEN status band (§9.2). The old ✓/⇥/?/–/dot glyph set is fully retired.)**
- **Name + custom status on ONE line** (name, then the custom status BESIDE it, dim) — **revises** the earlier "stacked under the name." **World name on the subline** beneath (fixed-height slot keeps rows uniform). Ask Me/DND still hide the world; the custom status still shows beside the name.
- **The platform tab carries the `VRC`/`CVR` acronym IN the row** (VRX-206) — reversing the earlier color-only spine rule after the owner's real-data review ("a horrible UI decision to have only one indicator and have that indicator be reliant on color only"). The acronym text is the R12 black-and-white-test signifier; tint chosen over the dashboard pill's ghost weight because the friend card, unlike the hot card, has no platform-tinted background to lean on (owner call, 2026-07-11).
- **Right side: ONE instance-type pill** (text-only openness label, neutral, `min-width` + centered → a tidy right-aligned column) that **doubles as the join target** — merges the old subline openness badge **and** the separate Join/Ask/⊘ affordance into one element ("press the instance type to join"). Shows the accurate openness label — **tier-colored per §6.1** — when the instance is visible, or a neutral **"Private"** for ANY friend in a hidden world (revised 2026-07-01: any status, not just Ask Me/DND — `state === 'in-game'` is the gate); nothing only when truly not in a world (offline / web-active). **(↻ BUILT, VRX-166 2026-07-12):** when the shared joinability predicate passes, the pill IS a real `<button>` (same recipe at rest; hover/pressed = brightness filters — inline tier backgrounds defeat `hover:bg-*`; house `focus:ring-1` ring; in-flight disable against double-fires); typed denials announce via a separate `role="status"` blip. Non-joinable pills stay spans. The join affordance is non-color (role + cursor + ring — R12); buttons are ordinary Tab stops until virtualization brings the roving model (duel F17).
  - **Label policy (RESOLVED 2026-07-03, VRX-182):** pills default to the short VRChat-scheme labels on both platforms (§6 label rule), so the verbose-CVR-overflow concern is moot — every default label fits the 78px column. The scheme is user-selectable (VRX-183, Settings → Instance labels); the verbose CVR terms only appear by explicit user choice, and the pill's `min-width` column simply widens for them.

**Compact / Detail (VRX-68):** Detail = full row; **Compact hides the custom status**, keeping name + icon + status + instance. The icon **scales down proportionally — "compact," NOT "crunched"** (never distorted/cropped).

**List structure (VRX-67 / VRX-76):** sections — **In-Game / Online / Offline**, each with live counts. **(↻ BUILT 2026-07-10, VRX-67:** ALL three sections are individually collapsible — sticky header buttons (`aria-expanded`, chevron glyph, opaque `--bg-base` mix so rows don't bleed under), **Offline collapsed by default**; the collapsed set persists via `settings.collapsedFriendSections`. This supersedes the earlier "online stays expanded" sketch — the owner's issue AC made every section collapsible.**)** One-column-combined (VRX-76) vs **split-by-platform = a USER OPTION**, not a fixed choice.

**Hot-instance card (revises §9):** **world image LEFT** (rectangular, rounded, glassy — when thumbnails are available; degrade cleanly without it), **info RIGHT**: world title, instance #/hash, openness icon-badge, **platform de-emphasized** (a quiet readable label, NOT a big `V`/`C` — color carries the platform), notes. **"Who's there?"** = a few names + **"+N more"** (NEVER all) + "N here". Quick **Join** (when `joinInstance` lands). **≥2 friends** to be "hot" by default — the floor is **user-configurable 1–10** (BUILT, VRX-78: a `NumberStepper` on the hot-section header for quick access + a Settings → Dashboard row; persisted via `settings.hotInstanceThreshold`, immediate effect. The AC's "Friends panel header" placement was deliberately moved to the Dashboard hot header — the control sits next to the grid it changes); **most→least** order (most friends top-left). Empty: **"No hot instances currently"** (done, VRX-171).

**Segmented control (revises §8):** order **`VRChat | All | ChilloutVR`** — **All in the MIDDLE** (it mixes the platforms, so it sits between them; keep consistent with the mixed-"All" list order — **OPEN** until that list exists). Labels = **text-only acronyms `VRC | ALL | CVR`**, the platform color applied to **the word itself** (VRC blue, CVR orange; ALL neutral) — **no icons, no separate chip**. The bubble tracks the **active button's real width** (labels are unequal — done in VRX-171). The control **filters the WHOLE view** — friends list, online counts, AND dashboard hot instances: one platform → that platform only; All → both combined.

**Sidebar nav accent follows the active platform filter (NEW issue):** keep the `--vrc→--cvr` gradient for All; recolor the active-nav accent to the platform color when one platform is filtered (VRChat → blue, CVR → orange) — an extra "you're filtered, not seeing the full list" cue.

**App opens on the Dashboard** (done, VRX-171).

**Reference:** the owner's pre-rewrite app (v0.10.0) is a *visual target* (NOT a revert) for: distinct stacked cards, `VRC`/`CVR` acronyms, All-in-middle, avatar+ring, instance line under the name. Adapt to the glass language, don't copy.

## §9.2 Friend drawer (VRX-69 phase 1 — owner-approved live design round 2026-07-17, mock rev d3)

Clicking a friend's **avatar** (or Enter/Space on it — the avatar is the row's details opener and its keyboard stop) opens the **friend-details drawer** — `FriendDrawer.tsx`. (↻ VRX-225, owner live session 2026-07-23: the opener moved from a stretched whole-row button to the avatar button — a stray click anywhere on a row must NOT open the card; the row body is inert apart from the Join pill.) The opener is a native `<button>` wrapping the avatar (the `<li>` stays purely structural; the Join pill remains an independent sibling control), whose accessible name COMPOSES from the visible name + status + world + platform (the tab label) — never an overriding `aria-label`, so screen readers keep every §9.1 signal. It carries `data-drawer-opener`, which the drawer's outside-close listener exempts: clicking another friend's avatar SWITCHES the open card in place. Owner-decided pixels; phase 1 ships ONLY sections with real data today (Copy link / self-invite / favorite / pin / notes / history are separate issues — NO placeholder buttons).

**Shell:** fixed right-side floating card — inset **14px** top/right/bottom, width **372px**, radius **20px** (panel scale — the §3 stack model; `.glass` supplies it), real `.glass` material (NO solid underlay — that was a mock-pane workaround, never ship it); scrim `--scrim-soft` (`rgba(0,0,0,.14)`, one value both themes, **`pointer-events: none`** — pure stacked-card depth, never an input wall; ↻ VRX-225 owner decision: "slight gray-out is fine… like you're stacking cards"; the heavier `--scrim` is retained for future TRUE modals); open/close = `translateX` over **260ms `cubic-bezier(.32,.72,.29,1)`**, `motion-safe:` prefixed. The panel stays mounted while closed (translated off-screen, `inert` + `aria-hidden`) so the exit transition can play. Drawer CONTENT may scroll (it's content, not a control surface — the §8 no-scroll rule is silent here). NOTE: the drawer is the codebase's canonical `glass` + `fixed` combination — `.glass` lives in `@layer components` PRECISELY so position utilities beat its `position: relative` (the v0.10.0 in-flow-drawer bug); never move component classes out of that layer.

**A11y (hard, ↻ NON-MODAL since VRX-225):** `role="dialog"` **without `aria-modal`** (the list behind the card is genuinely interactive — hover, scroll, join, and avatar-switch all work while the card is open; claiming modality to assistive tech would lie), `aria-label` = the friend's name; **NO focus trap** — Tab moves freely between card and list (trapping keyboard users while pointer users roam the list would split the interaction model); initial focus lands on ✕ when a friend is selected. Close paths: Esc, any pointerdown outside the panel that isn't a `[data-drawer-opener]` (avatar clicks switch, never close), and the ✕ button (28px, radius 9px, ghost-button styling, top-right) — every close path through ONE handler; focus RETURNS to the opening avatar on close (falling back to the friends search input when the row no longer exists — focus never drops to `<body>`).

**Content, top to bottom:**
1. **Header** — 64px avatar with the 2.5px status ring (**NO corner badge at this size**); name 18px/700; custom status under it (12.5px `--text-dim`, VRChat only); ghost platform pill below ("VRChat"/"ChilloutVR" **full word**; `--plat-*-ghost-text/-border` tokens, transparent fill; height 24px, radius 9px, 11px/600).
2. **Status band — the headline: status in WORDS.** Full-width rounded-10px band; border `color-mix(in srgb, var(--sc) 30%, transparent)`, bg `10%` mix, where `--sc` is the status token from the SAME `ringFor` fold as the row (CVR online = tier-2 Online — never forked); 10px dot in `--sc`; the status word 14px/700 in the status **`-text` companion token** (identical hue in dark; the §2A-mandated darker read in light); right-aligned descriptor 12px `--text-dim`. Copy (en; ja mirrors): Join Me/"Open to joins — hop in freely" · Online/"Around and reachable" · Ask Me/"Ask before joining" · Do Not Disturb/"Not accepting joins" · Offline/"Not connected". Web-active shows the word alone (no phase-1 descriptor). This band is the drawer-side non-color signifier that lets the row badge drop its glyph (R12).
3. **WHERE** — uppercase 10.5px letterspaced label; world name 14px/600 truncating + the SHARED `InstancePill` (identical tier logic/labels as the row); Ask Me/DND show **"Hidden"** as the world (ONLY while in-game — `isWorldHidden` requires in-world presence, so an offline friend with a retained status never reads "Offline" + "Hidden"); hidden-but-in-world shows "Private" (same rule as the row's pill); trust line `Trust: {rank}` (VRChat only, when known).
4. **Actions** — ONE primary **Join** button, full width, shown ONLY when `isFriendJoinable(friend)`: border `color-mix(var(--op-public) 45%)`, bg `16%` mix, text `--op-public-text`; reuses the row's join flow (bridge call, in-flight guard, 2.5s failure blip in a polite live region).

State: the selected friend id lives in the friends store (`selectedFriendId`, view state — composite `platform:platformUserId`). Future phases (VRX-70/72/75) add favorite/notes/history INTO this drawer.

## §10 Cross-platform friend linking (cited by Linear — VRX-143)
- No shared identity exists across platforms → linking is USER-DRIVEN. NEVER auto-merge.
- Data model: link relation tying two `platformUserId`s (1 VRChat + 1 CVR) into one logical person; per-platform presence aggregated INDEPENDENTLY.
- VRX MAY surface optional suggestions (e.g. matching display names); user MUST confirm each. Unlink MUST be trivial + lossless.
- Storage: user-authored private data in app `userData` ONLY. NEVER write into VRCX/CVRX folders.
- Render: one dual-presence person card, blue→orange bridge avatar, each platform's presence side-by-side. Link/suggest/unlink in the friend drawer.

## §11 NEVER (hard gates — restated)
- NEVER color an openness badge by platform/type.  - NEVER use blue/orange for non-platform meaning.  - NEVER render status as a bare dot, or make the state dot blue.  - NEVER conflate status:"active"(Online) with state:"active"(not-in-game).
- NEVER default trust on or color names by trust.  - NEVER set body/helper/status in VT323.  - NEVER auto-merge identities.
- NEVER invent CVR features for symmetry.  - NEVER fake/approximate platform logos.  - NEVER rely on color alone.  - NEVER hardcode outside tokens.  - NEVER write to VRCX/CVRX folders.

## §12 Implementation mapping + GENERATION CHECKLIST
- Tokens (§2) → Tailwind v4 `@theme` (VRX-4). No UI issue hardcodes outside tokens. Self-host Inter + VT323 (M2 — Security Core).
- `glass.html` = living visual reference (the dashboard); keep in sync with this file — it carries BOTH themes (dark default; add `data-theme="light"` to `<html>` to preview light per §2A–§4A). `design.html` = human contributor guide (served at root `/`; embeds glass.html live). `platform-colors.html` = retired early explainer (superseded by design.html). On repo creation, this file → repo root / `docs/DESIGN.md`.
- Light theme: dark is the DEFAULT baseline (§2–§4); light is specified by the `[data-theme="light"]` token/material/background overrides in §2A–§4A (VRX-115). Light MUST NOT fork layout, components, typography, or channel meanings — overrides only.

Self-verify BEFORE emitting/PRing UI (all must pass):
```
[ ] all floating surfaces use .glass; zero solid/opaque cards
[ ] zero color/spacing literals outside §2 tokens
[ ] light mode uses §2A–§4A overrides only; no light-only component grammar or rebrand
[ ] light mode preserves blue top-left / orange bottom-right atmosphere and liquid-glass material
[ ] platform shown via tint + the row tab / card pill with a VRC/CVR text label (blue=VRC, orange=CVR); passes R12 in B&W
[ ] state colors reserved for state surfaces (stat cards, future feed dots — in-game green / active teal / offline gray); never blue; the ROW ring shows the privacy tier — statusless in-game folds to Online (VRX-207)
[ ] openness badge neutral gray + correct shared icon (§6 lookup)
[ ] VRChat status as a labeled colored pill (never a bare dot); custom status kept; Ask Me/DND hide the world
[ ] joinability is a separate neutral action (Join/Ask/⊘), never tinted; status:"active"≠state:"active" (parse both)
[ ] CVR: online/offline only — no status pill, no fabricated equivalent
[ ] friend names neutral; trust only as opt-in muted pill
[ ] VT323 confined to mark / big numbers / kickers / glyphs / IDs
[ ] no signal carried by color alone (always + position + glyph/text)
[ ] prefers-reduced-motion honored; no viewport-scaled font sizes
[ ] no fabricated logos; no auto-merge; no writes to VRCX/CVRX
[ ] CVR openness values verified vs live API (or flagged, not guessed)
```
