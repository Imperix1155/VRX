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
R4  STATE == the avatar DOT only: in-game=green, active=teal (online-not-in-game), offline=gray. in-game+offline match CVR. NEVER color text/panels by state; NEVER make it blue.
R5  Openness badge == ALWAYS neutral gray + shared icon (§6). NEVER colored by platform or by type.
R6  STATUS (VRChat: Join Me/Online/Ask Me/DND + custom msg) renders as a LABELED colored pill, NEVER a bare dot. Joinability ACTION (Join/Ask/⊘) is separate + neutral. Ask Me/DND hide the world. CVR has NO status (§5).
R7  Trust == OFF by default, names neutral, opt-in muted pill only (§5). NEVER color a name by trust. NEVER default-on.
R8  Type: Inter = all readable text. VT323 = accent ONLY (mark, big numbers, kickers, glyphs, IDs) (§7). NEVER VT323 for body/helper/status/labels.
R9  NEVER hardcode color/spacing outside tokens (§2). NEVER auto-merge cross-platform identities (§10). NEVER write to VRCX/CVRX folders.
R10 NEVER rely on color alone — always color + position + glyph/text. ALWAYS honor prefers-reduced-motion.
R11 Light mode is a token/material shift only (§2A–§4A). SAME layout, typography, channel law, glyphs, and component grammar. NEVER make a separate-looking app.
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

## §2 Tokens — AUTHORITATIVE (copy verbatim; → Tailwind v4 @theme, VRX-4)
```css
:root{
  --bg-base:#08080b; --text:#f3f1fb;   /* near-black, neutral (no purple cast) */
  --text-dim:rgba(231,225,250,0.72); --text-faint:rgba(216,208,242,0.46);
  /* PLATFORM — deep + saturated (spine/tint/glyph only) */
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
```css
body::before{position:fixed;inset:0;z-index:-2;background:
  radial-gradient(58% 50% at 12% 6%,rgba(43,124,232,0.26),transparent 60%),
  radial-gradient(58% 50% at 92% 96%,rgba(243,113,30,0.20),transparent 60%),var(--bg-base);}
body::after{position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,0.022) 0 1px,transparent 1px 3px);
  mix-blend-mode:overlay;opacity:0.6;}
```
- Aurora = the two platforms as light: blue corner (top-left) + orange corner (bottom-right) over neutral near-black; NO third hue. Static in v1. Animate ONLY behind a `prefers-reduced-motion` guard.
- Scanlines stay ~2.2% white on overlay = texture, not a filter. NEVER raise to a visible grid.

## §4A Light background
```css
[data-theme="light"] body::before{background:
  radial-gradient(58% 50% at 12% 6%,rgba(31,111,211,0.18),transparent 60%),
  radial-gradient(58% 50% at 92% 96%,rgba(216,95,24,0.15),transparent 60%),
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
| Platform | glass tint + left spine + `V`/`C` glyph | `--vrc` blue / `--cvr` orange | a bare dot; non-platform use of blue/orange |
| State (presence) | the avatar **dot** | in-game `--ingame` green · active `--active` teal · offline `--offline` gray | color on text/panel; making it blue |
| Status (VRChat) | a **labeled pill** | Join Me / Online / Ask Me / DND (VRChat hues) + custom msg | a bare dot; reusing the dot; a CVR equivalent |
| Openness | neutral gray **badge** + shared icon | gray pill, platform-true label | color by platform or by type |
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
- Status appears ONLY as a labeled pill in VRChat hues. WHY allowed: a labeled pill in a fixed location can't be confused with the platform spine (left) or the state dot. NEVER render status as a bare colored dot.
- Joinability is a SEPARATE neutral action derived from status+instance: Join Me/Online→`Join`; Ask Me→`Ask`; DND→`⊘`; active/offline→none. NEVER tint it with a platform/status hue.
- CVR: state online/offline ONLY (online↔`--ingame`, offline↔`--offline`, matching VRChat). NO status pill, NO custom status, NO `active` state. NEVER fabricate a CVR equivalent.
- Trust: names neutral; trust only as an opt-in muted gray pill. WHY: VRChat is phasing out trust visibility; CVR has none.
- A11y (hard): every channel = color **+** position **+** glyph/label. Color is NEVER the sole signal.

## §6 OPENNESS LADDER (instance-type consistency — cited by Linear)
Both platforms have **8 instance types** that map almost 1:1 onto ONE shared openness ladder + a `Group` modifier. Icon IDENTICAL across platforms; label stays platform-true; badge neutral gray.
Scale (open→closed): `Public → Friends+ → Friends → Invite+ → Invite`. `Group` = chip MODIFIER on top of openness (a group instance is still public / friends-extended / members-only).
Shared icon sprite: `#o-public`(globe) `#o-fof`(person+plus) `#o-friends`(person) `#o-invite`(envelope) `#o-group`(two people).

Unified mapping — verified vs VRChat wiki + ChilloutVR docs (2026-05):

| Openness tier | icon | VRChat | ChilloutVR |
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
```css
.app{display:grid;grid-template-columns:248px 1fr;height:100vh;padding:16px;gap:16px;}
body{overflow:hidden;}   .main{overflow-y:auto;}   /* shell fixed; only main scrolls */
```
- Sidebar (248px `.glass`): brand+subtitle → nav (Dashboard / Activity / Friends·count / Instances / Groups / Settings) → footer (`VRX` / `Social VR Companion · vX.Y.Z`). Active nav = glass-gradient fill + left spine gradient `--vrc → --cvr`. "Activity" carries an unread badge.
- Main: topbar (view title + glass segmented control All/V VRChat/C ChilloutVR + right online count w/ green pulse) → stat row → titled sections (`.secline` = VT323 kicker + dim hint).
- Dense desktop utility. No responsive collapse required for v1. Deadspace OK at view bottom, NOT between related cards.

## §9 Components (compose §3–§7; exact markup in glass.html)
- Stat card: `.glass`, big VT323 number tinted by meaning (online→`--active`, in-game→`--ingame`, hot→`--bridge`), dim Inter label.
- Hot-instance card: `.glass`+`.tint-vrc|cvr`+platform class; 4px top edge gradient (platform→transparent); `V`/`C` glyph; neutral openness badge+icon; world title; platform-colored subtitle; avatar stack + "<b>N</b> here"; platform-tinted Join.
- Friend row: grid `3px | 42px | 1fr | auto` = glowing platform spine · avatar + state dot · neutral name + `V`/`C` glyph + status pill (VRChat) + "world · openness" / custom-status subline · derived affordance. Active/offline → no affordance; Ask Me/DND → no world (hidden).
- Activity feed row (the **Activity** view + a Dashboard preview): reverse-chronological log of friend events — world/instance change, online/active/offline, status change, incoming/accepted friend request, joined-your-instance, group events. Reuses the channel system (platform spine+glyph, state dot, status pill, openness badge on location events, join affordance when joinable) + a small **event-type glyph** + a dim **relative timestamp** (Inter, NOT VT323). MAX user control: scope = **All / Friends / Favorites** (+ specific favorite groups); per-event-type toggles; per-platform via the segmented control. Local/private (derived from polling, stored as local history). Models VRCX Feed/Friend Log; CVR-lighter. (Tracked: VRX-144 + VRX-53 instance history.)
- Segmented control: glass track; active = glass-gradient bubble + inset highlight. React: animate bubble via transform/width; reduce-motion shortens. NEVER fake selection with per-button bg.
- Badges/pills: openness = neutral gray; platform glyph = platform-tinted square; VRChat status pill = labeled (§5).

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
[ ] platform shown only via tint + spine + V/C glyph (blue=VRC, orange=CVR)
[ ] state shown only as the avatar dot (in-game green / active teal / offline gray); never blue
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
