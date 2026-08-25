/**
 * Platform moderation context for an instance.
 *
 * This is deliberately separate from the openness ladder: the native instance
 * type says who can join, while this value tells the UI which broad platform
 * policy context applies. Unknown or impossible platform/type combinations are
 * never promoted to a confident claim.
 */
import type { InstanceInfo, Platform } from '@shared/types'

export type PolicySpace = 'public' | 'private' | 'unknown'

const VRC_PUBLIC_TYPES = new Set<InstanceInfo['type']>(['public', 'group-public'])
const VRC_PRIVATE_TYPES = new Set<InstanceInfo['type']>([
  'friends-plus',
  'friends',
  'invite-plus',
  'invite',
  'group-plus',
  'group'
])

const CVR_PUBLIC_TYPES = new Set<InstanceInfo['type']>([
  'public',
  'group-public',
  'friends-of-friends',
  'friends-of-members'
])
const CVR_PRIVATE_TYPES = new Set<InstanceInfo['type']>([
  'friends',
  'everyone-can-invite',
  'owner-must-invite'
])

export function policySpaceFor(
  platform: Platform,
  instance: Pick<InstanceInfo, 'type' | 'opennessUnknown'>
): PolicySpace {
  if (instance.opennessUnknown === true) return 'unknown'

  const publicTypes = platform === 'vrchat' ? VRC_PUBLIC_TYPES : CVR_PUBLIC_TYPES
  if (publicTypes.has(instance.type)) return 'public'

  const privateTypes = platform === 'vrchat' ? VRC_PRIVATE_TYPES : CVR_PRIVATE_TYPES
  if (privateTypes.has(instance.type)) return 'private'

  return 'unknown'
}
