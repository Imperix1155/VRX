import type { InstanceType, LabelScheme } from '@shared/types'

/**
 * Instance-pill label i18n keys, per naming scheme (DESIGN.md §6 label rule).
 * Using lookup maps avoids dot-notation issues with hyphenated keys.
 *
 * The DATA is always platform-true (`InstanceInfo.type` — a CVR friend carries
 * `members-only`, never `group`); only the DISPLAYED WORDS change with the
 * user's `labelScheme` setting (VRX-183):
 * - `vrchat` (default — the VRX-182 baseline): both platforms use the VRChat
 *   terms; CVR types resolve to their openness-tier's VRChat label.
 * - `chilloutvr`: both platforms use the CVR terms; VRChat types resolve to
 *   their tier's CVR label (Group+ → "Friends of Members", Group → "Members
 *   Only"). Types CVR shares with VRChat (`public`/`friends`/`group-public`)
 *   have identical words in both schemes.
 * - `platform-native`: each type shows its own platform's term — the identity
 *   map, since the data is platform-true.
 * CVR `offline` ("Offline Instance") has no VRChat counterpart and renders the
 * same under every scheme.
 */
const VRCHAT_SCHEME: Record<InstanceType, string> = {
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

const CVR_SCHEME: Record<InstanceType, string> = {
  // VRChat types → the tier's CVR label
  public: 'friends.instance.type.public',
  'friends-plus': 'friends.instance.type.friends-of-friends',
  friends: 'friends.instance.type.friends',
  'invite-plus': 'friends.instance.type.everyone-can-invite',
  invite: 'friends.instance.type.owner-must-invite',
  'group-public': 'friends.instance.type.group-public',
  'group-plus': 'friends.instance.type.friends-of-members',
  group: 'friends.instance.type.members-only',
  // CVR types
  'friends-of-friends': 'friends.instance.type.friends-of-friends',
  'everyone-can-invite': 'friends.instance.type.everyone-can-invite',
  'owner-must-invite': 'friends.instance.type.owner-must-invite',
  'friends-of-members': 'friends.instance.type.friends-of-members',
  'members-only': 'friends.instance.type.members-only',
  offline: 'friends.instance.type.offline'
}

/** Each type keeps its own platform's term — identity, because the data is platform-true. */
const PLATFORM_NATIVE_SCHEME: Record<InstanceType, string> = {
  public: 'friends.instance.type.public',
  'friends-plus': 'friends.instance.type.friends-plus',
  friends: 'friends.instance.type.friends',
  'invite-plus': 'friends.instance.type.invite-plus',
  invite: 'friends.instance.type.invite',
  'group-public': 'friends.instance.type.group-public',
  'group-plus': 'friends.instance.type.group-plus',
  group: 'friends.instance.type.group',
  'friends-of-friends': 'friends.instance.type.friends-of-friends',
  'everyone-can-invite': 'friends.instance.type.everyone-can-invite',
  'owner-must-invite': 'friends.instance.type.owner-must-invite',
  'friends-of-members': 'friends.instance.type.friends-of-members',
  'members-only': 'friends.instance.type.members-only',
  offline: 'friends.instance.type.offline'
}

export const LABEL_KEYS_BY_SCHEME: Record<LabelScheme, Record<InstanceType, string>> = {
  vrchat: VRCHAT_SCHEME,
  chilloutvr: CVR_SCHEME,
  'platform-native': PLATFORM_NATIVE_SCHEME
}
