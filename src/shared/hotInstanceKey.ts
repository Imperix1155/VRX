import type { Platform } from './types'

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
