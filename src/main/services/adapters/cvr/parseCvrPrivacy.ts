/**
 * CVR instance privacy → platform-true InstanceType + openness (VRX-147).
 *
 * Pure parser (directory contract: no electron/node imports, never throws).
 * The wire values come from CVR's `instanceSettingPrivacy` / WS instance
 * `privacy` field — 6 values verified against CVRX source, 4 more reported
 * but never captured live (api-volatility.md; VRX-130 tracks them).
 *
 * Unknown values degrade to the MOST RESTRICTIVE friend-ladder type
 * (`owner-must-invite`) — the api-volatility convention for access types:
 * unknown-open would invite join attempts that can't succeed; unknown-locked
 * merely understates access.
 */
import type { InstanceType, OpennessTier } from '@shared/types'

export interface CvrInstanceAccess {
  type: InstanceType
  openness: OpennessTier
  /** Group-family types get the §6 Group chip modifier. */
  isGroup: boolean
}

/**
 * Verified wire value → platform-true type (CVRX `instanceSettingPrivacy`).
 * The shared `openness` ladder has NO group tiers — group-family types
 * normalize into the friend ladder (same convention as VRChat's `opennessFor`:
 * `group` → 'invite') with `isGroup` as the §6 chip modifier; the UI's pill
 * COLOR map reads the platform-true `type`, not `openness`.
 */
const PRIVACY_MAP: Record<string, CvrInstanceAccess> = {
  public: { type: 'public', openness: 'public', isGroup: false },
  friendsoffriends: { type: 'friends-of-friends', openness: 'friends-plus', isGroup: false },
  friends: { type: 'friends', openness: 'friends', isGroup: false },
  everyonecaninvite: { type: 'everyone-can-invite', openness: 'invite-plus', isGroup: false },
  ownermustinvite: { type: 'owner-must-invite', openness: 'invite', isGroup: false },
  groupsonly: { type: 'members-only', openness: 'invite', isGroup: true }
}

const UNKNOWN_ACCESS: CvrInstanceAccess = {
  type: 'owner-must-invite',
  openness: 'invite',
  isGroup: false
}

/**
 * The WS wire (and `/1/instances/{id}`) sends privacy as an INTEGER enum.
 * Mapping follows the owner's prior WORKING app (Social-VR-Companion
 * `cvrx-friends-reader.js`): 0=public, 1|2=friends, 3|6=group, 4|5=private.
 * `0`, `2`, `7` are additionally confirmed LIVE 2026-07-08 (a known public,
 * friends, and group instance rendered correctly); `7` is a group value newer
 * than the prior app knew (0–6). Values without live confirmation follow the
 * reference and understate on doubt (friends narrower than friends-of-friends,
 * private narrower than everyone-can-invite) — the safe direction. Unknown
 * numbers degrade restrictive, same convention as unknown strings.
 */
const PRIVACY_MAP_NUMERIC: Record<number, CvrInstanceAccess> = {
  0: PRIVACY_MAP['public']!, // live-confirmed
  1: PRIVACY_MAP['friends']!, // reference (1|2=friends); no live capture
  2: PRIVACY_MAP['friends']!, // live-confirmed
  3: PRIVACY_MAP['groupsonly']!, // reference (3|6=group)
  4: PRIVACY_MAP['ownermustinvite']!, // reference (4|5=private)
  5: PRIVACY_MAP['ownermustinvite']!, // reference (4|5=private)
  6: PRIVACY_MAP['groupsonly']!, // reference
  7: PRIVACY_MAP['groupsonly']! // live-confirmed (newer than the prior app)
}

export function parseCvrPrivacy(privacy: string | number | null | undefined): CvrInstanceAccess {
  if (privacy == null) return UNKNOWN_ACCESS
  if (typeof privacy === 'number') return PRIVACY_MAP_NUMERIC[privacy] ?? UNKNOWN_ACCESS
  // Case/punctuation-insensitive: wire captures show PascalCase ("FriendsOfFriends");
  // normalize so casing drift can't silently unknown-ify a verified value.
  // Digits stay significant — a future "Friends2" must NOT alias to 'friends'
  // (that would overstate access; unknowns must degrade restrictive).
  const key = privacy.toLowerCase().replace(/[^a-z0-9]/g, '')
  return PRIVACY_MAP[key] ?? UNKNOWN_ACCESS
}
