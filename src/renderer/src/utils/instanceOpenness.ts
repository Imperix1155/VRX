/**
 * Openness assessment shared by surfaces that speak the VRX-245 open/closed axis.
 *
 * The join dialog and the friend drawer both need to tell the user whether an
 * instance is effectively open or closed without guessing. This collapses the
 * platform/instance-type ladder into the three assessment buckets the UI copy
 * uses: open, closed, or unknown.
 */
import type { InstanceInfo } from '@shared/types'

export type OpennessAssessment = 'open' | 'closed' | 'unknown'

/**
 * Assess an instance's effective openness for user-facing copy.
 *
 * - `opennessUnknown: true` (VRX-240 degraded CVR privacy) → 'unknown'; NEVER a
 *   guessed tier.
 * - Public / Friends+ instances are considered open.
 * - Friends / Invite+ / Invite instances are considered closed.
 * - Group instances follow the same ladder: public/friends-plus → open,
 *   members-only (openness `invite`) → closed; 'offline' or any unrecognized
 *   group value falls through to 'unknown' so the helper never guesses.
 */
export function opennessAssessmentFor(instance: InstanceInfo): OpennessAssessment {
  if (instance.opennessUnknown === true) return 'unknown'

  if (instance.isGroup) {
    if (instance.openness === 'public' || instance.openness === 'friends-plus') return 'open'
    if (instance.openness === 'invite') return 'closed'
    return 'unknown'
  }

  if (instance.openness === 'public' || instance.openness === 'friends-plus') return 'open'
  if (
    instance.openness === 'friends' ||
    instance.openness === 'invite-plus' ||
    instance.openness === 'invite'
  ) {
    return 'closed'
  }

  return 'unknown'
}
