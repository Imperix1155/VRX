import type { InstanceType } from '@shared/types'

/**
 * Maps each platform-true InstanceType to its pill-label i18n key (DESIGN.md §6).
 * Using a lookup map avoids dot-notation issues with hyphenated keys.
 *
 * BASELINE = the VRChat naming scheme for BOTH platforms (VRX-182, owner-decided):
 * one vocabulary keeps merged friend lists consistent, and the VRChat terms are
 * far more widely known. CVR types therefore resolve to their openness-tier's
 * VRChat label ("Friends of Friends" → "Friends+") — the DATA stays platform-true
 * (`InstanceInfo.type` is untouched), only the words consolidate. CVR `offline`
 * has no VRChat counterpart and keeps its own label. A user-selectable scheme
 * (VRChat / CVR / platform-native) is VRX-183.
 */
export const INSTANCE_TYPE_LABEL_KEYS: Record<InstanceType, string> = {
  // VRChat types
  public: 'friends.instance.type.public',
  'friends-plus': 'friends.instance.type.friends-plus',
  friends: 'friends.instance.type.friends',
  'invite-plus': 'friends.instance.type.invite-plus',
  invite: 'friends.instance.type.invite',
  'group-public': 'friends.instance.type.group-public',
  'group-plus': 'friends.instance.type.group-plus',
  group: 'friends.instance.type.group',
  // CVR types → the tier's VRChat label (VRX-182 baseline)
  'friends-of-friends': 'friends.instance.type.friends-plus',
  'everyone-can-invite': 'friends.instance.type.invite-plus',
  'owner-must-invite': 'friends.instance.type.invite',
  'friends-of-members': 'friends.instance.type.group-plus',
  'members-only': 'friends.instance.type.group',
  offline: 'friends.instance.type.offline'
}
