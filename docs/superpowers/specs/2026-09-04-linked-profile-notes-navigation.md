# Linked profile notes and navigation

Status: owner-approved design decision, September 4, 2026. Implementation is deferred.

## Interactive mock approval

After testing the interactive mock in Safari, the owner approved this version as
the current design baseline: "Let's lock this in, so far." Preserve its layout,
control placement, and reviewed flows for subsequent implementation. Further
owner feedback may refine it; this approval does not authorize app implementation
or certify production readiness.

The exact eight-file mock is preserved locally at
`.superpowers/brainstorm/approved-linking-baseline-2026-09-04/`. Its source was
`.superpowers/brainstorm/94974-1788568275/content/`. The snapshot includes the
HTML, interaction script, mock CSS, compiled app CSS, two fonts, and two sample
portraits. Do not publish the captured fixture artwork without owner approval.

Snapshot fingerprint, SHA-256 over sorted filenames and file bytes, each followed
by a NUL separator:
`58ac04f4ccac32d8e273327b045e5b87761e1c61581352b346e49f363c5f4882`.

The approved reference retains the 372px drawer, bottom-left Identities control,
single visible notes editor, and image-overlay instance pills. The latter use
10px backdrop blur, a 42% base backing, and 13% semantic tint. Rule-context pills
appear in the join dialog rather than the initial profile view. The Identities
control retains its thin blue-to-orange outline and gradient text.

Mock interaction checks covered note isolation, custom-name protection,
confirmation gating, cancellation, single and double replacement, failed-save
preservation, reload persistence, unlinking, hidden locations, and continued use
of the connected platform. Chromium computed-style checks confirmed drawer width
and frosting values. The owner's Safari feedback supplies the visual approval;
no fresh automated Safari pixel comparison was performed. The earlier intermittent
frosting report remains an unproven rendering issue, not a resolved defect.

Earlier references below to exact copy or layout needing review preceded this
mock approval. The preserved mock is the reviewed wording/layout reference.
Production accessibility, localization, persistence, API, and renderer testing
are still required when implementing. The mock's demo controls and fixtures are
not production features.

## Approved behavior

The linked profile opens in the combined view. It brings together the linked
accounts' information and has its own private shared note.

For the first release, a linked person has one VRChat main and one ChilloutVR
main. There are three independently stored notes, but only one editor is visible
at a time.

| View               | Note being displayed and edited                    |
| ------------------ | -------------------------------------------------- |
| Combined profile   | Shared note belonging to the linked person         |
| VRChat profile     | Original note belonging to that VRChat account     |
| ChilloutVR profile | Original note belonging to that ChilloutVR account |

Linking starts the shared note blank and preserves both existing account notes.
Do not concatenate notes, wipe originals, or copy changes between note owners.
Switching views must not lose unsaved edits or save them against a different
person or account. The editor must clearly identify which note it edits.

## Navigation

- The bottom-left Identities control is the primary, explicit route to the
  linked accounts. Each account has an action to view its profile inside VRX.
- The existing VRChat and ChilloutVR header pills are shortcuts to those same
  account-specific views. Both routes must reach the same view and note.
- Every account-specific view offers an obvious return to the combined profile.
- Do not add a three-way Combined / VRChat / ChilloutVR header selector for this
  decision. The owner chose the existing pills plus Identities instead.
- Profile navigation does not unlink accounts or launch either game.

The intentional redundancy gives users a clear route through Identities and a
shortcut through the platform pills. The combined view stays the default.

## Combined display name

Initialize the combined name from the preferred account selected at link
confirmation, which defaults to the account where linking begins. Keep that
name stable when presence changes or the displayed avatar/status source changes.
The user can rename the combined profile in Identities. This changes only the
local VRX name, never either platform account's display name. Account-specific
views retain their respective platform names. This behavior is owner-approved.

When the preferred platform changes later, the combined name follows the newly
preferred account only if the user has not set a custom VRX name. A custom name
always takes precedence and must never be overwritten by a preference change.
Keep default-name and custom-name modes distinct rather than inferring intent
from whether two name strings happen to match. Presence changes do not select a
different name in either mode.

## Preferred platform and combined header

Owner approved this behavior after the notes/navigation decision. The account
from which linking starts establishes the initial preferred platform for this
linked person. The VRX user can change that preference in Identities. This is
the local user's display preference, not a claim about the friend's preference.

The linking confirmation screen must expose this choice near the account/name
summary rather than silently applying it. Preselect the initiating account's
platform, label it as the preferred platform, and allow switching to the other
linked platform before confirming. Explain that this is the user's selection
for the linked profile, not a preference discovered from either platform's API.
Reflect the selected account's name in the combined-name preview. The owner
explicitly requested this choice at linking time as well as later in Identities.
Exact explanatory copy and control layout still need mock review.

| Account activity       | Combined header picture and status source            |
| ---------------------- | ---------------------------------------------------- |
| Only VRChat active     | VRChat account                                       |
| Only ChilloutVR active | ChilloutVR account                                   |
| Both active            | Account on the preferred platform                    |
| Both offline           | Preferred account picture, with an Offline indicator |

The user can choose the merged diagonal picture instead. That choice overrides
only the picture and remains in effect regardless of which account is active.
It does not change the selected status source.

Keep any displayed status type visibly associated with its source platform.
If the selected platform does not supply a status type, show none. Do not borrow
the other account's status or invent a ChilloutVR equivalent. Presence state and
platform status type remain separate concepts.

The preference selects the combined header's presentation. It must not hide
either account's presence or join restrictions, change note ownership, choose a
join destination automatically, or change the account-specific profile views.
Future uses of the preference require their own approved behavior.

The owner subsequently clarified the selection hierarchy: in-game outranks
online-only, which outranks offline, matching the friends list. Select the
account at the higher presence level regardless of the preferred platform.
Preferred platform breaks ties at the same level. This refines "both active"
above: an in-game account beats an online-only preferred account.

Do not treat missing presence as confirmed offline. See connection availability
below for the owner's approved handling direction.

## Connection availability and single-platform use

Using only VRChat or only ChilloutVR remains fully supported. Do not show a
missing-platform warning merely because the user has not enabled both platforms.

For an existing linked person, a platform disconnect or logout does not unlink
the accounts. Keep both identity references. In Identities, show a quiet
unavailable entry for the disconnected account, identifying its platform without
presenting stale world or presence data as current. The owner suggested wording
such as "Data unavailable". Exact copy remains subject to review. Avoid
"Previously linked" while the relationship still exists.

The connected account remains usable. Its available information and permitted
actions must not be blocked by the other platform's failure. Missing connection
data is not evidence that the friend went offline. A temporary interruption
should not cause the header picture to jump solely because of that interruption;
any retained picture is last-known presentation, not a claim of live presence.

The owner can explicitly unlink from Identities even when one platform is
unavailable, with the shared-note deletion warning described below. A disconnect
alone does not authorize deleting notes or identity references. The unavailable
entry is a display state, not approval of a new cache-deletion policy.

Identity references must retain the existing signed-in-account scope as well as
platform and friend identifiers. Do not reconnect a saved link using display
names or another signed-in user's friend data. Detailed reconnect and cache
behavior still needs implementation review.

## Superseded proposals

This replaces the proposal to expose preserved account notes only through a
Previous notes archive. They remain active account-specific notes, accessible
through the original account views. It also replaces the proposal for a new
three-way header selector. No destructive reset of individual account notes is approved.

## Implementation checks

- Editing the shared note changes neither account note.
- Editing either account note changes neither the other account note nor the
  shared note.
- Both navigation routes select the same account and note, including accounts
  that are offline.
- Returning to the combined profile restores its shared note.
- Repeated navigation and application restart preserve each note independently.
- Ordinary navigation and first-time linking discard no existing notes. Explicit
  unlinking or link replacement may delete only the affected shared note after
  the required destructive confirmation.

## Hidden locations

For an in-game account whose location is hidden, show "Hidden" with neutral
hidden-location artwork in that account's image half. Do not show stale world
details or offer Join for that account. Keep its presence visible. Exact artwork
is still a design choice. This behavior is owner-approved but not implemented.

## Unlinking and shared-note deletion

The owner chose deletion rather than an archive of previous shared notes.
Before unlinking, explicitly warn that the shared note will be permanently lost
and that the user must save any wanted text elsewhere before proceeding.
The user must be able to cancel without losing the link or any note. Only an
explicit confirmation proceeds with unlinking and shared-note deletion.
The two original account notes remain unchanged. Do not create a Previous
shared notes archive. Exact confirmation copy still needs review.

This decision concerns cleanup and retention. Retaining notes would not require
a separate text file per note, so file-count or storage pressure is not its
technical justification.

## Replacing an existing link

The owner approved inline replacement when an account selected during linking
already belongs to another linked person. Do not silently move it or require a
separate trip to unlink first.

Before replacing the link, require an explicit confirmation identifying the
existing relationship and explaining the exact effects:

- Remove the old link and permanently delete its shared note. Warn the user to
  save any wanted shared-note text elsewhere before proceeding.
- Preserve all original account notes, including the account left behind.
- Start the new link with a blank shared note and the combined name and preferred
  platform chosen during its confirmation flow. Do not silently transfer the old
  combined profile's custom name or preferences.

Cancel leaves the existing relationship and all notes unchanged. Selecting an
already-linked result is not consent to replace it. The change must be atomic:
failure to create the new relationship must not leave the old one or its shared
note deleted. Revalidate the affected relationship before committing; if it has
changed since confirmation, do not apply a destructive reset the user did not
review.

The owner also approved replacing two different existing linked people in the
same screen. The required confirmation must identify both old account pairs,
identify the selected new pair, and explain that both old links and both shared
notes will be deleted. All individual account notes remain unchanged. Explicitly
show that the two accounts not selected for the new pair become unlinked; they
are not deleted or silently linked to each other. The new shared note starts
blank. Offer cancellation and warn users to save wanted shared-note text before
confirming. Apply the entire change atomically or preserve both original links
and their notes. This must not be reduced to a generic "Are you sure?" prompt.

Exact action and editor labels and saving behavior still need review.
Future alternate accounts need account-keyed notes, not one global note per
platform. This document does not authorize the alternate-account UI.

## Friends roster platform filter and linked pill

Owner-approved on September 5, 2026. The platform filter and presence rules
apply together; neither replaces the other.

| Selected filter | Linked person's account activity       | Card and platform pill                                             |
| --------------- | -------------------------------------- | ------------------------------------------------------------------ |
| All             | Both active                            | One combined person card, VRX gradient pill                        |
| All             | Only VRChat active, ChilloutVR offline | One combined person card, VRC pill                                 |
| All             | Only ChilloutVR active, VRChat offline | One combined person card, CVR pill                                 |
| All             | Both offline                           | One combined person card, VRX gradient pill                        |
| VRC             | Any combination                        | Only the VRChat account card, VRC pill and VRChat activity         |
| CVR             | Any combination                        | Only the ChilloutVR account card, CVR pill and ChilloutVR activity |

The mixed in-game/online-only exception under Friends counts and presence
grouping below overrides the combined-card rows above. "Both active" must not
be interpreted as combining accounts across those two different sections.

A platform-filtered account remains that account even if it is offline while
the other platform is active. Do not borrow the other platform's presence,
world, name, or destination action. Filtering changes presentation, never the
saved relationship. In All, changing the pill does not split the combined card
or change its shared-note ownership. Ordinary unlinked accounts retain their
existing platform treatment. Missing connection data is not confirmed offline;
the connection-availability contract above still applies.

Keep the platform pill in its existing position and geometry. The VRX label
uses the original 10.5px semibold lettering and 0.09em tracking. Its text blends
directly between the platform orange and blue tokens without a white midpoint;
the mock retains the original 13% tint and 36% border treatment. The long
CVR+VRC label, twin tabs, stacked segments, and relocated labels were rejected.

The reviewed behavior is demonstrated locally in
`.superpowers/brainstorm/5568-1788591987/content/roster-options.html` and its
matching script and styles. Chromium checks passed all 24 combinations of two
themes, four presence fixtures, and three platform filters, with 60px row
heights. No Safari pixel capture was taken for this revision. The owner also
approved the four-state comparison displayed together in the later local mock
at `.superpowers/brainstorm/5904-1788592116/content/roster-options.html`.

When both accounts have joinable destinations, the compact card's "2 locations"
button opens the same platform-and-world chooser as the drawer's Join button.
Do not automatically choose a destination. Both entry points must share the
same destination eligibility checks and rule-context presentation. This flow
is owner-approved. The world subline decision is recorded below. These
design approvals do not authorize production implementation.

The owner subsequently approved the split instance-color treatment for the
"2 locations" button. Preserve its existing size, 28px height and 10px corner
radius. Divide its tint and outline diagonally from top-left to bottom-right:
VRChat's instance type occupies the upper-right half and ChilloutVR's the
lower-left. Use each destination's instance-type tokens, not platform colors,
with 13% tint and 36% border strength. Keep the shared "2 locations" label in
neutral readable text; do not print instance-type names inside the halves.
The chooser must still name both platform destinations and instance types,
so understanding and selection do not depend on color alone.

The reviewed local reference is
`.superpowers/brainstorm/6561-1788592380/content/roster-options.html` and its
matching CSS/script. Its Group Public purple and Public green are sample
instance types, not fixed colors for all linked friends. The diagonal treatment
must use the actual types when implemented. Single-destination controls retain
their existing treatment. The comparison selector is mock-only.

## Friends counts and presence grouping

Presence sections remain ordered in-game, then online-only, then offline. The
owner clarified an exception to the earlier highest-presence combined-card
proposal: if one linked account is in-game while the other is online-only,
All shows two account-specific rows in their respective sections. For example,
ChilloutVR in-game appears in In-game with its CVR pill, while VRChat online-only
appears in Active with its VRC pill. Do not present a combined VRX row in the
In-game section for that pair; it would imply both accounts are in-game.
The saved link remains intact. Apply this exception symmetrically when either
platform supplies those presence states; do not invent unsupported states.

This exception does not change the approved one-active/other-offline or
both-offline combined-card behavior. It also does not change the combined
profile header's in-game-over-online hierarchy. In VRC or CVR views, show and
group only the selected platform account, regardless of the other's presence.
Missing platform data remains unavailable, not confirmed offline.

The owner confirmed the overall counting rule after discussing this exception:
Every platform filter counts unique people represented in that view. All counts
a linked person once, even when that person appears in two presence sections.
VRC and CVR each also count that linked person once when the person has an
account represented in the selected platform view. The count's unit remains
people, not accounts; the explicit saved link supplies the identity grouping.
Unlinked accounts remain distinct because VRX has no confirmed relationship
between them. Changing the filter does not unlink accounts. Do not derive the
overall total by summing visible rows across presence sections. Section
count labeling must make that distinction clear.

The owner approved opening the corresponding platform-specific profile when
clicking either account row in the mixed in-game/online-only case. Include the
existing explicit "Back to combined" action. The account view uses that
account's original note, not the shared note; returning to combined restores
the shared-note view. Row navigation does not change the saved relationship.

## Compact combined world-name line

The owner approved the capped world-name layout after viewing the mock. When
both accounts are in-game, keep both destinations on the existing 16px line,
each with a compact platform badge followed by its own world name. Use equal
name-width caps based on the displayed width of "Sample ChilloutVR world",
not a character-count limit. Long names truncate independently with ellipses.
Full names remain available in the shared destination chooser.

Approved mock values: each name is capped at 145px; the two-group region is
capped at 370px, with an 8px gap between groups and 4px between badge and name.
Badges are 14px high with 10px semibold text and 6px corners, using the existing
platform tint/border/text tokens. Keep both groups aligned to consistent slots
rather than stretching them across the entire row. If the row is narrower,
both groups shrink equally and names truncate further. Preserve 60px row height.
Single-platform views retain their existing single world line.

Approved local reference:
`.superpowers/brainstorm/7949-1788592907/content/roster-options.html` with its
matching script and CSS. Narrow-layout checks confirmed both names remain
visible at 119px each in the 520px row fixture, without horizontal overflow.
The owner's Safari feedback approved the visual spacing; no new screenshot was
taken after the cap adjustment.

## World-image pill anchoring

Owner clarified that a single-world view, on either platform, anchors the
instance pill at the image's top right with the world name beneath it. A split
image retains VRChat at top right with its name below, and ChilloutVR at bottom
left with its name above. The pill is the corner anchor, not the outer caption
container. Preserve the approved frosting, platform outline and image layout.

The interactive roster mock's CVR-only layout initially moved its container to
top right while retaining left alignment and name-before-pill ordering from
the split view. The correction right-aligns the CVR-only contents and orders
its instance badges before the caption. Dark/light position checks confirmed
14px pill-to-image corner offsets in both single-platform views and both split
halves. This fixes the prototype, not the production application.

## Search across linked names

Owner approved searching for a linked person by either platform account's
display name or the person's custom VRX name. Choosing a custom name must not
make the original account names stop matching. Apply the selected platform
filter to the displayed result; an alias match does not override that filter.
Keep the approved unique-person counting and mixed-state row rules. Search
does not establish links or infer identity from matching names.

## Stable interaction during presence updates

Owner approved protecting ongoing interaction from live presence changes.
Keep the currently opened person/account view and its note owner stable until
the user explicitly navigates. A presence update must not switch the editor,
discard text, reset the caret, or redirect an edit to another note. Continue
updating availability and destination eligibility; stability must not leave
stale Join actions enabled or imply that old presence is current.

Do not reorder or replace a roster row beneath the user's pointer or keyboard
focus during interaction. Defer the affected structural change until that
interaction ends while still reflecting safe live status information. The
implementation plan must define a bounded deferral and focus-restoration rule
so rows cannot stay stale indefinitely. This is not permission to freeze all
presence updates. These requirements are approved but not yet implemented in
production app. The build-preparation mock now includes alias search and incoming
event controls, with a proposed five-second placement deferral. See the
[consolidated brief](2026-09-05-linked-friends-design-brief.md) and
[implementation plan](../plans/2026-09-05-linked-friends.md). The owner delegated
the all-or-nothing persistence safeguard to Codex's technical judgment; they
will decide implementation authority after reviewing the finished plan.

## Scope

This records the approved notes, navigation, preferred-platform decisions,
roster filter/pill behavior, and interactive mock checkpoint. The mock demonstrates the reviewed flows with local
sample data; it is not application implementation. Existing production design
guides, API documentation, and changelog remain unchanged until implementation.
