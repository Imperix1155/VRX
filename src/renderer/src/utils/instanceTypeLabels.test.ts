import { describe, expect, it } from 'vitest'
import { LABEL_SCHEMES } from '@shared/types'
import { LABEL_KEYS_BY_SCHEME } from './instanceTypeLabels'

const key = (leaf: string): string => `friends.instance.type.${leaf}`

describe('LABEL_KEYS_BY_SCHEME', () => {
  it('covers every scheme', () => {
    expect(Object.keys(LABEL_KEYS_BY_SCHEME).sort()).toEqual([...LABEL_SCHEMES].sort())
  })

  it('vrchat scheme: CVR types resolve to their tier’s VRChat label (VRX-182 baseline)', () => {
    const m = LABEL_KEYS_BY_SCHEME.vrchat
    expect(m['friends-of-friends']).toBe(key('friends-plus'))
    expect(m['everyone-can-invite']).toBe(key('invite-plus'))
    expect(m['owner-must-invite']).toBe(key('invite'))
    expect(m['friends-of-members']).toBe(key('group-plus'))
    expect(m['members-only']).toBe(key('group'))
  })

  it('chilloutvr scheme: VRChat types resolve to their tier’s CVR label', () => {
    const m = LABEL_KEYS_BY_SCHEME.chilloutvr
    expect(m['friends-plus']).toBe(key('friends-of-friends'))
    expect(m['invite-plus']).toBe(key('everyone-can-invite'))
    expect(m.invite).toBe(key('owner-must-invite'))
    expect(m['group-plus']).toBe(key('friends-of-members'))
    expect(m.group).toBe(key('members-only'))
  })

  it('platform-native scheme: every type keeps its own key (identity)', () => {
    for (const [type, labelKey] of Object.entries(LABEL_KEYS_BY_SCHEME['platform-native'])) {
      expect(labelKey).toBe(key(type))
    }
  })

  it('shared literals and offline are identical under every scheme', () => {
    for (const scheme of LABEL_SCHEMES) {
      const m = LABEL_KEYS_BY_SCHEME[scheme]
      expect(m.public).toBe(key('public'))
      expect(m.friends).toBe(key('friends'))
      expect(m['group-public']).toBe(key('group-public'))
      expect(m.offline).toBe(key('offline'))
    }
  })
})
