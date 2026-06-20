/**
 * VRChat instance-type detector (VRX-45)
 *
 * Parses the access-control tags appended to a VRChat instanceId and maps them
 * to the canonical VrcInstanceType union defined in @shared/types.
 *
 * instanceId format (from the VRChat API location field):
 *   "<worldId>:<nonce>[~tag(value)]..."
 *
 * VrcInstanceType → OpennessTier mapping (for shared-UI grouping):
 *   public       → public
 *   friends-plus → friends-plus
 *   friends      → friends
 *   invite-plus  → invite-plus
 *   invite       → invite
 *   group-public → public        (group modifier + public openness)
 *   group-plus   → friends-plus  (group modifier + friends-extended openness)
 *   group        → invite        (group modifier + members-only openness)
 *
 * VRChat API tag reference (verified 2026):
 *   ~hidden(usr_x)                          → Friends+  (counterintuitive; this is the API name)
 *   ~friends(usr_x)                         → Friends
 *   ~private(usr_x)                         → Invite
 *   ~private(usr_x)~canRequestInvite        → Invite+
 *   ~group(grp_x)~groupAccessType(public)   → Group Public
 *   ~group(grp_x)~groupAccessType(plus)     → Group+
 *   ~group(grp_x)~groupAccessType(members)  → Group (members-only)
 *   (no access tag)                         → Public
 */

import type { VrcInstanceType } from '@shared/types'

/** Splits a raw instanceId into its tag names and values. */
function parseTags(instanceId: string): Map<string, string> {
  const tags = new Map<string, string>()
  // Tags appear after the first `~`; each is `tagname` or `tagname(value)`.
  const tagRe = /~([a-zA-Z]+)(?:\(([^)]*)\))?/g
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(instanceId)) !== null) {
    tags.set(match[1], match[2] ?? '')
  }
  return tags
}

/**
 * Parses a VRChat instanceId (or location string) and returns the
 * platform-true VrcInstanceType.
 *
 * Never throws. Returns `'public'` for null / empty / unrecognised input.
 */
export function parseInstanceType(instanceId: string | null | undefined): VrcInstanceType {
  if (!instanceId) return 'public'

  const tags = parseTags(instanceId)

  // Group instances are identified first; sub-type from groupAccessType.
  if (tags.has('group')) {
    const access = tags.get('groupAccessType')
    if (access === 'public') return 'group-public'
    if (access === 'plus') return 'group-plus'
    // 'members' OR missing/unknown groupAccessType → most-restrictive default.
    return 'group'
  }

  if (tags.has('private')) {
    return tags.has('canRequestInvite') ? 'invite-plus' : 'invite'
  }

  if (tags.has('hidden')) return 'friends-plus'
  if (tags.has('friends')) return 'friends'

  // No recognised access tag (public instance, possibly with ~region only).
  return 'public'
}
