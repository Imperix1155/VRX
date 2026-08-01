import type { Friend, InstanceInfo, Platform, PresenceState } from './types'

/**
 * The structural minimum the hot-membership law reads. A full `Friend`
 * satisfies it directly (dashboard), and the alert engine's snapshot path —
 * whose wire entries carry no Friend object — can supply it without a cast.
 */
export interface HotMembershipView {
  platform: Platform
  presence: { state: PresenceState }
  status: Friend['status']
  instance: InstanceInfo | null
}

/**
 * The §5/R6 privacy gate (VRX-69), now THE ONE shared source (VRX-237): Ask
 * Me / DND hide the location. The renderer's row util
 * (`utils/statusRing.isWorldHidden`) delegates here, and hot-instance
 * membership consumes it. VRChat-only (CVR has no status) and only while IN
 * A WORLD — an offline friend with a retained ask-me/dnd status has no world
 * to hide.
 */
export function isWorldHidden(friend: HotMembershipView): boolean {
  return (
    friend.presence.state === 'in-game' &&
    friend.platform === 'vrchat' &&
    (friend.status === 'ask-me' || friend.status === 'dnd')
  )
}

/**
 * THE one hot-instance MEMBERSHIP predicate (VRX-237) — consumed by BOTH the
 * dashboard's `getHotInstances` and the main-process `FriendAlerts` engine,
 * so the toast and the cards count exactly the same people. A friend counts
 * toward "hot" iff ALL of:
 *
 * - `presence.state === 'in-game'` — the state axis is the in-world truth.
 *   (A swallowed /auth/user bucket read can leave every friend 'offline'
 *   with a stale populated `instance` — that must never render a hot card of
 *   "offline" friends.)
 * - `instance` is non-null.
 * - NOT hidden-location — OWNER PRIVACY LAW (2026-08-01): Ask Me / DND
 *   friends are INVISIBLE to the entire hot system. They never count toward
 *   the threshold, never appear in members/names/aria, never contribute
 *   world/openness. A card exists iff VISIBLE members alone ≥ threshold —
 *   and the alert engine's toast obeys the same law.
 */
export function isHotInstanceMember(friend: HotMembershipView): boolean {
  return friend.presence.state === 'in-game' && friend.instance !== null && !isWorldHidden(friend)
}

/**
 * THE one hot-instance grouping key (VRX-237) — shared by the main-process
 * alert engine (`FriendAlerts`) and the renderer dashboard (`getHotInstances`)
 * so "hot" can never drift between the toast and the cards.
 *
 * THE LAW (owner, 2026-08-01): a hot instance is multiple friends in the SAME
 * instance — exact `instanceId` equality, never same-world, never same-type.
 * World-grouping manufactured a false social signal (it implied friends were
 * hanging out together who were in different instances of one world).
 *
 * Key shape is platform-aware: VRChat's instance suffix is only unique inside
 * a world, so its key is `[worldId, instanceId]`; CVR instance ids are
 * globally unique and must remain stable while world metadata enriches
 * asynchronously, so its key is the instance id alone. Callers namespace by
 * platform (the alert engine keys per-platform maps; the dashboard prefixes
 * the platform) — cross-platform collision is impossible by construction.
 *
 * Membership (WHO counts) lives in `isHotInstanceMember` above; this is only
 * the key shape (WHICH instance they are in).
 *
 * NUL separator: cheap and collision-free for the API's id charsets (the
 * alert engine runs this once per presence entry on EVERY event —
 * JSON.stringify was the hot spot that timed CI out at 10k events).
 */
export function hotInstanceKey(
  platform: Platform,
  instanceId: string | null,
  worldId: string | null
): string | null {
  if (instanceId === null) return null
  return platform === 'vrchat' ? `${worldId ?? ''}\u0000${instanceId}` : instanceId
}
