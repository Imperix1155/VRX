# Linked friends design brief

Status: consolidated review copy, September 5, 2026. The interactions listed as
approved below come from the owner's reviewed mock and decisions. Production
implementation and an overnight run have not been authorized.

## Purpose and boundaries

Treat a manually linked VRChat friend and ChilloutVR friend as one person,
without losing either account's presence, privacy restrictions, or private notes.
Keep the existing Friends row and drawer recognizable. Linking is local VRX
data, not a platform account operation or a public identity claim.

The first release supports one main account per platform. Alternate accounts
remain undecided. Do not add alt controls or promise migration-free future alts.
Explore, Dashboard discovery, Activity, Groups, notifications, tags, favorites,
export/import, and releases are outside this implementation plan. Existing
account data for those features must remain untouched.

The detailed decision ledger is
[Linked profile notes and navigation](2026-09-04-linked-profile-notes-navigation.md).
This brief consolidates it; later owner-approved decisions override older mock
proposals, including the original always-combined roster proposal.

## Approved presentation

### Friends roster

Keep the existing left platform rail, 42px avatar, name and world line, right
instance action, and 60px compact row. Do not move platform identity beside the
name. The existing VRC / All / CVR filter controls the displayed view.

| View and presence                          | Rows                                          | Platform rail          |
| ------------------------------------------ | --------------------------------------------- | ---------------------- |
| All, both in-game                          | Combined, with two world names                | VRX                    |
| All, one in-game and the other online-only | Separate account rows in In-game and Active   | Respective VRC and CVR |
| All, one active and the other offline      | Combined                                      | Active platform        |
| All, both online-only                      | Combined in Active, no world or Join          | VRX                    |
| All, both offline                          | Combined in Offline, no Join                  | VRX                    |
| VRC or CVR                                 | Only that account, using only its information | Selected platform      |

In every filter, count unique represented people, not rows or accounts. A linked
person appearing in two sections contributes one to the overall total. Section
counts represent entries and must not be added to calculate people. A filter
never changes a saved link.

The VRX rail keeps 10.5px semibold text, 0.09em tracking, 13% platform tint and
36% border strength. Its orange-to-blue text gradient has no white midpoint.
Labels must remain intelligible without color. Unlinked rows stay unchanged.

Each of two world names gets a small platform badge and its own ellipsis. Keep
the line 16px high. The approved caps are 145px per name, 370px for the pair,
8px between groups and 4px inside each group. Badges are 14px high with 10px
semibold text and 6px corners. Narrow rows shrink both name slots equally.

With two eligible destinations, use the approved diagonal instance-color
"2 locations" button. It is 28px high with 10px corners, 13% tint and 36% border.
VRChat's instance type occupies the upper-right half and ChilloutVR's the
lower-left. These are instance-type colors, not platform colors. The label
remains neutral. Both roster and drawer open the same destination chooser.

### Drawer

Keep the 372px drawer and existing hierarchy: header, status, Where, Join,
Notes, then quiet trust information and bottom-left Identities. Identities is
an outlined pill with blue-to-orange text and border, not a filled banner.

The combined header has both platform pills. They are shortcuts to the same
account views available through Identities. Each account view offers "Back to
combined profile". Split mixed-presence roster rows open their account view.

One in-game location uses a full world image with the platform-colored outline.
Its instance pill anchors top right, with the world name beneath. Two in-game
locations split diagonally from top left to bottom right. VRChat is upper
right, name below its pill; ChilloutVR is lower left, name above its pill.
The corner offset in the approved prototype is 14px.

Names stay horizontal on one line and truncate. Use the approved soft image
fade and layered text shadow, not black caption boxes. Instance pills retain
10px backdrop blur, 42% base backing and 13% semantic tint. Rule-context pills
belong in the Join flow, not the initial drawer. A hidden location shows
"Hidden" with neutral artwork and no stale world details or Join action.

### Name, picture and status

Link confirmation visibly offers Preferred platform, initially the account
where the user started. They can change it there or later in Identities.
This is a local display preference, not a preference reported by their friend.

Default combined name follows the preferred account. A custom VRX name overrides
it and survives later preference changes. Neither platform account is renamed.
Presence changes never change the combined name.

Choose the header's account by in-game, then online-only, then offline. Preferred
platform breaks ties. Optional merged picture overrides only the picture.
Keep any status type attributed to its platform. Do not invent or borrow a
status type from the other account. Keep the existing presence/status distinction.

## Approved workflows and data rules

1. Open Identities from any friend. Search the other platform's friends,
   including offline friends. Linking is always explicit, never inferred.
2. Confirm both accounts and preferred platform. Show the resulting name.
3. Create a blank shared note. Preserve both original account notes.
4. Combined view edits shared notes; account views edit their respective notes.
   Show one editor at a time. Preserve the existing 500-character account-note
   limit and save-on-blur/retry behavior in production. The prototype persists
   sample notes immediately and is not the persistence implementation.
5. Unlink only after explaining that the shared note will be permanently lost,
   offering cancellation and telling the user to save wanted text elsewhere.
   Account notes remain unchanged. No historical-note archive is included.
6. Inline replacement shows old pair or pairs, selected new pair, every shared
   note to be deleted, and accounts left unlinked. Explicit confirmation is
   required. The new shared note starts blank; chosen name/preference apply.
7. Cancel or a failed replacement preserves all old relationships and notes.
   Revalidate the reviewed state before committing. Never silently replace a
   relationship that changed after confirmation.

Search matches either platform name and any custom VRX name. It never bypasses
the selected platform filter or establishes a link.

Disconnecting does not mean a friend went offline. Keep the link and notes;
show the unavailable member quietly in Identities and allow the healthy side
to work. Ordinary single-platform use gets no missing-platform warning. Scope
references to the signed-in account as well as platform and friend ID. Do not
expose another signed-in user's data after an account switch.

## Transition safeguards

Approved: live updates must not switch the open profile or note owner, erase
text, reset the cursor, or move a row under active interaction. Join eligibility
and destination validation must remain current throughout.

The completed prototype demonstrates one proposed timing policy: defer roster
structure while hovered/focused, then apply on interaction end, with a five-second
maximum. Disable an affected destination action immediately and show that activity
changed while its position is held. Restore focus by stable identity when rows
split or combine; use the search field if no corresponding row remains. The five
seconds and interim wording are review proposals, not earlier visual approvals.

The implementation plan keeps the notes editor mounted and keyed by note owner.
It does not copy the prototype's document-rebuild mechanism. A location change
while the chooser is open invalidates that old target; never join the new world
under an old confirmation.

## Verified source baseline and proposed architecture

At local commit `7bbcc21`, `LinkGraphStore` already stores account-qualified
two-member people with a nullable custom display name. It rejects invalid and
future-format data and conflicting members. It is not instantiated by production
code; both adapters emit `linkedPersonId: null`. This is foundation, not a
finished linking feature.

Account notes already live in `SocialStore`, protected by signed-in-account
epochs. Leave those records and their existing write path alone.

Technical direction, delegated to Codex's judgment by the owner: extend the main-owned link document with preferred
platform, picture mode, stable default name and shared note. One validated write
must replace the affected relationships and shared notes together. Do not put
shared notes in another file and simulate a transaction with separate deletes.
Migrate the strict version-one document explicitly; preserve unknown future
versions read-only. The owner authorized technical judgment for this safeguard,
not production execution or an unattended run.

Project linked rows from the untouched platform friend data plus a scoped link
snapshot. Never make the adapters emit fabricated combined friends. Reuse the
existing join predicate, main-owned target validation, note hooks, virtualization,
keyboard navigation, and theme tokens.

## Prototype coverage and limits

The local build-preparation prototype contains the approved visual comparisons
and a shared-state interactive roster. It includes linking, unlinking, single
and double conflicts, name/preference changes, account/shared notes, aliases,
platform filters, hidden locations, disconnects, delayed presence events and
stale destination checks. The controls under "Prototype controls" are not app UI.

All accounts and actions are fixtures. It does not authenticate, poll platforms,
launch games or write real social data. Original captured artwork remains local;
do not publish it in a PR. Browser tests do not prove Electron persistence,
screen-reader behavior, or real-platform behavior.

## Ready-for-build gates

- Owner reviews this consolidated brief, the new transition test view, and the
  proposed persistence approach.
- The implementation plan maps every requirement to files and tests, including
  migration, stale confirmations, session changes and write failures.
- An overnight run gets explicit implementation authority and a stopping point.
  No automatic merge, release, real-account test or unattended screen capture.

Production design guides, changelog and API catalog remain unchanged during
planning. The implementation must update them alongside the real feature.
