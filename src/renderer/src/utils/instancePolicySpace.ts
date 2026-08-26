/**
 * Platform moderation context for an instance.
 *
 * This is deliberately separate from the openness ladder: the native instance
 * type says who can join, while this value tells the UI which broad platform
 * policy context applies. Unknown or impossible platform/type combinations are
 * never promoted to a confident claim.
 */
import type { CvrInstanceType, InstanceInfo, Platform, VrcInstanceType } from '@shared/types'

export type PolicySpace = 'public' | 'private' | 'unknown'
type KnownPolicySpace = Exclude<PolicySpace, 'unknown'>

const VRC_POLICY_SPACE = {
  public: 'public',
  'friends-plus': 'private',
  friends: 'private',
  'invite-plus': 'private',
  invite: 'private',
  'group-public': 'public',
  'group-plus': 'private',
  group: 'private'
} satisfies Record<VrcInstanceType, KnownPolicySpace>

const CVR_POLICY_SPACE = {
  public: 'public',
  'friends-of-friends': 'public',
  friends: 'private',
  'everyone-can-invite': 'private',
  'owner-must-invite': 'private',
  'group-public': 'public',
  'friends-of-members': 'public',
  'members-only': 'private',
  offline: 'private'
} satisfies Record<CvrInstanceType, KnownPolicySpace>

export function policySpaceFor(
  platform: Platform,
  instance: Pick<InstanceInfo, 'type' | 'opennessUnknown'>
): PolicySpace {
  if (instance.opennessUnknown === true) return 'unknown'

  let policySpaceByType: Partial<Record<InstanceInfo['type'], KnownPolicySpace>>
  if (platform === 'vrchat') {
    policySpaceByType = VRC_POLICY_SPACE
  } else if (platform === 'chilloutvr') {
    policySpaceByType = CVR_POLICY_SPACE
  } else {
    return 'unknown'
  }
  const policySpace = Object.hasOwn(policySpaceByType, instance.type)
    ? policySpaceByType[instance.type]
    : undefined
  return policySpace ?? 'unknown'
}
