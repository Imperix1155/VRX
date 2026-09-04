# Cross-Platform Explore Design

**Status:** Approved by the owner on 2026-09-04 under the Explore portion of
VRX-270.

## Purpose

Replace the placeholder **Instances** destination with **Explore**, a unified
discovery surface for active public destinations across VRChat and ChilloutVR.
Explore must bridge the platforms without pretending their APIs or population
sizes are identical.

The Dashboard remains an at-a-glance summary. Hot Instances answers “Where are
my friends gathering?” and a two-card Explore preview answers “Where are people
gathering publicly right now?” The full Explore page carries the detailed
discovery flow.

Cross-platform friend linking remains the next implementation target. This
document locks the Explore product direction so it can follow without
reopening settled decisions.

## Product Contract

- Rename the sidebar destination and page title from **Instances** to
  **Explore**.
- Present one mixed **Popular now** grid. Do not split the page into a VRChat
  section and a ChilloutVR section.
- Give both platforms the same card structure, controls, interaction, visual
  weight, and display limit.
- Reuse the existing **All / VRC / CVR** platform selector to filter Explore.
- Reuse the app's compact number-stepper language for a **Worlds shown**
  control. Its only values are **2**, **4**, and **6**; it defaults to **4** and
  persists locally.
- Use world-first cards. A busy world appears once even when it has several
  visible public rooms.
- Open a contained, non-modal bottom sheet when a world card is selected. The
  sheet shows the visible public or otherwise joinable rooms VRX can truthfully
  obtain for that world.
- Never reserve a permanent first-class position for one platform or assume
  that VRChat has more results than ChilloutVR.

## Dashboard preview

The Dashboard remains an at-a-glance summary. Its vertical order is:

1. the existing Friends online, In game right now, and Hot instances stat
   cards;
2. a **Popular now** preview containing exactly two Explore world cards; and
3. the existing **Hot instances** section, which keeps its current six-card
   maximum and friend-based meaning.

The preview reads from the same ranked and cached Explore result set. It does
not make its own platform requests or define a second ranking system. In
**All** mode it renders the first two results produced by Explore's symmetric
merge. That normally means one leading world from each platform; if one source
has no candidate, the existing backfill rule can fill the second slot. In
**VRC** or **CVR** mode both slots belong to the selected platform.

The Dashboard preview has no Worlds shown control. It is always two cards and
uses the same card fields, platform treatment, loading truth, and world-sheet
interaction as Explore. It must not reuse friend locations or change the
meaning of Hot Instances.

The existing Hot Instances section moves down intact. Its one-to-ten friend
threshold selector stays beside the section heading with the same persisted
value and immediate update behavior. Its exact-instance grouping, ranking,
six-card cap, Join affordance, empty state, and detail sheet do not change.

## Platform Sources Without False Parity

| Platform   | World candidate meaning                                             | Room drill-in meaning                                                        |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| VRChat     | Popular active worlds returned by the active-world discovery source | Public or otherwise visible joinable instances exposed to the signed-in user |
| ChilloutVR | Worlds containing active public instances                           | Active public instances exposed by ChilloutVR                                |

The shared presentation is deliberate, but the labels must remain truthful:

- A VRChat card's activity count means **people in this world**. It can include
  people in rooms that are private, unlisted, full, or otherwise absent from
  the visible room list.
- A ChilloutVR card aggregates the active public rooms VRX received for that
  world.
- The sheet says **Visible public rooms** rather than “all instances.”
- VRX never invents a room, infers that two people are together from a shared
  world alone, or promises that every visible room can still be joined.

## Ranking, Interleaving, and Backfill

Each platform produces its own ranked candidate list. Platform-native activity
signals determine rank within that list; VRX does not compare raw VRChat and
ChilloutVR population numbers as if they were equivalent.

In **All** mode:

1. Divide the selected display total equally between the two platforms.
2. Take that many top-ranked candidates from each list.
3. Interleave equal ranks in the mixed grid and alternate which platform leads
   each row, producing the accepted helix-style balance instead of fixed
   platform columns. Choose the first row's leader with a stable,
   platform-neutral tiebreaker derived from the current leading candidates; do
   not hard-code either platform as the leader.
4. If one platform cannot fill its share, backfill the unused slots with the
   other platform's next-ranked candidates.
5. Never exceed the selected total and never add empty cards to manufacture
   balance.

Examples:

- **2 shown:** one candidate from each platform when both are available.
- **4 shown:** two from each platform when both are available.
- **6 shown:** three from each platform when both are available.
- **4 shown, one CVR candidate available:** show that CVR candidate and up to
  three VRC candidates.
- The inverse case behaves identically when ChilloutVR has more candidates.

In **VRC** or **CVR** mode, the selected total applies entirely to the chosen
platform. If fewer candidates exist, show the truthful smaller result set with
no blank placeholders.

Ranking and merge logic must be deterministic for the same inputs. It must not
encode either platform as the expected larger source.

## Card and Sheet Content

Explore cards reuse the Dashboard's established liquid-glass world-card
grammar rather than creating a second design system. Each card contains:

- world thumbnail and world name;
- platform spine, tint, and non-color V/C glyph;
- activity count using the truthful platform-specific meaning above;
- visible-room count when known; and
- a clear disclosure affordance for opening the sheet.

Both platforms use the same field positions. Missing optional metadata is
omitted or shown with the app's existing neutral unknown treatment; it must not
change the card's hierarchy.

The world sheet reuses the contained Hot Instance sheet behavior: it stays
inside the main content area, leaves the sidebar available, closes through its
close control or the established outside-dismiss behavior, and preserves the
selected platform filter and count when dismissed.

Each room row can show only data actually supplied or safely derived from the
room identifier:

- instance access type and openness treatment;
- current occupancy and capacity when available;
- region and group identity when available;
- whether the room is joinable for the signed-in user; and
- the existing guarded **Join** action when joinable.

Unavailable, private, full, or non-joinable rooms do not receive an enabled
Join action. The existing join confirmation and platform launch behavior
remain authoritative.

## Data and Process Boundaries

Implementation will add pure shared Explore values for world summaries, room
summaries, filters, and result state. Platform adapters remain responsible for
translating their external API shapes into that shared contract. The main
process owns authentication, request pacing, caching, and orchestration; the
renderer receives only plain, token-free values through trusted IPC.

The initial load should use the smallest bounded request set each platform can
support. Prefer an active-world response that already includes partial visible
room data. Fetch richer room details only when the user opens a world, cache
them, and deduplicate concurrent requests. Do not fan out across every world on
initial render merely to populate optional details.

The implementation must reuse existing adapter, query, store, IPC, stepper,
platform-filter, world-card, and sheet surfaces where their contracts fit.
Any new callable surface must be catalogued in `docs/INTERNAL-API.md`.

## Refresh and Failure Behavior

- Cache the last successful results per platform and use stale-while-revalidate
  behavior so a transient failure does not erase useful cards.
- Refresh on initial entry, explicit user refresh, and an appropriate app-focus
  transition, subject to the existing request queue and a minimum 60-second
  discovery cooldown.
- Do not poll friend presence or build a continuous public-instance crawler.
- Treat platform failures independently. If one platform fails, keep the other
  platform's results visible and show a localized inline error for the failed
  source.
- A single-platform filter shows that platform's own loading, empty, stale, or
  error state without borrowing cards from the other platform.
- Unknown enum values and missing optional fields degrade safely instead of
  rejecting the complete result set.
- Preserve the user's selected filter and Worlds shown value through refresh,
  navigation, and restart.

## VRChat Feasibility Boundary

VRChat discovery relies on unofficial, volatile API behavior. Current evidence
supports an active-world source with aggregate activity and partial visible
instance data, but implementation must begin with a live, keys-only feasibility
probe against the signed-in user's normal session.

If partial instances are not present or are insufficient, retain the approved
world cards using aggregate activity and fetch visible room details only after
the user opens a card. If the live source cannot provide a truthful public-room
drill-in at all, stop before shipping and return to the owner; do not substitute
friend locations or scrape occupant identities to make the design appear
complete.

Record verified response shapes, omissions, and changed assumptions in
`docs/api-volatility.md`. A policy or pacing change also updates
`docs/api-policy.md`.

## Privacy and Security

- Never expose credentials, cookies, tokens, or raw platform responses to the
  renderer.
- Never enumerate, retain, or display occupant identities merely to power
  public discovery.
- Never surface private or invisible rooms that the signed-in user is not
  authorized to see.
- Keep BrowserWindow and IPC protections unchanged; every new IPC handler uses
  `isTrustedIpcSender`.
- Keep URL handling and external launch behavior behind existing allowlists and
  confirmation surfaces.
- Log fixed diagnostic categories and counts only, never PII or room-member
  lists.

## Accessibility and Visual Parity

- Platform identity remains blue for VRChat and orange for ChilloutVR only
  through the established tint, spine, and glyph locations.
- Cards and sheets must remain legible in dark, light, and grayscale modes.
- The stepper exposes an accessible name, announces its current value, and
  disables decrement at 2 and increment at 6.
- Card disclosure and room Join actions are keyboard reachable with visible
  focus states.
- Loading, empty, stale, and failure states cannot rely on color alone.
- Layout reflows without changing platform treatment or ordering rules.

## Verification Contract

Implementation is not complete until it proves:

- unit coverage for values 2, 4, and 6; persistence; filters; balanced lists;
  VRC-heavy lists; CVR-heavy lists; one empty list; both empty; and exact
  backfill limits;
- a symmetry check showing that swapping the platform inputs swaps platform
  ownership without otherwise changing the merge behavior;
- parser fixtures for both external sources, including unknown and missing
  fields;
- request pacing, cache reuse, concurrent-request deduplication, drill-in lazy
  loading, stale fallback, and independent platform failures;
- renderer interaction coverage for filters, the stepper, card disclosure,
  sheet dismissal, keyboard use, guarded Join actions, and the Dashboard order
  of stats → two-card Popular now preview → Hot Instances;
- dark, light, grayscale, narrow-window, and uneven-data runtime renders in the
  real Electron app through the `verify-electron` workflow; and
- the full repository typecheck, lint, format, build, review, CI, and external
  review gates required by the repository contract.

The implementation DOX pass must update all three design artifacts,
`docs/INTERNAL-API.md`, the API volatility record, and `CHANGELOG.md`. Update
the API policy only if verified pacing or etiquette changes.

## Non-Goals

- Replacing or duplicating Dashboard Hot Instances.
- Showing friends, private rooms, every occupant, or a complete global instance
  directory.
- Comparing raw population counts to rank one platform above the other.
- Hiding legitimate results solely to fabricate equal platform populations.
- Building Activity, Groups, account actions, mass invites, or the post-1.0
  overlay as part of Explore.
- Starting Explore implementation before the already-prioritized
  cross-platform friend-linking work is complete.
