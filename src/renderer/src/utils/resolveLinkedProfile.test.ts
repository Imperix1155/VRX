import { describe, expect, it } from 'vitest'
import type { LinkedProfile } from '@shared/linkedProfiles'
import { fullFriend } from '../test-utils/friendFixture'
import { resolveLinkedProfile } from './projectLinkedFriends'

const vrc = fullFriend('VRC', 'vrchat')
const cvr = fullFriend('CVR', 'chilloutvr')
const profile: LinkedProfile = {
  id: 'pair',
  members: [
    { platform: 'vrchat', platformAccountId: 'v', friendId: vrc.platformUserId },
    { platform: 'chilloutvr', platformAccountId: 'c', friendId: cvr.platformUserId }
  ],
  preferredPlatform: 'vrchat',
  customName: 'Together',
  defaultName: 'VRC',
  pictureMode: 'preferred',
  sharedNote: 'shared',
  revision: 1
}
const target = {
  kind: 'person' as const,
  personId: 'pair',
  anchor: { platform: 'vrchat' as const, friendId: vrc.platformUserId }
}
const input = {
  friends: [vrc, cvr],
  profiles: [profile],
  accountIds: { vrchat: 'v', chilloutvr: 'c' }
}
describe('durable linked profile navigation', () => {
  it('retains the person and name when the opening account disappears', () => {
    const resolved = resolveLinkedProfile(target, { ...input, friends: [cvr] })
    expect(resolved?.profile?.id).toBe('pair')
    expect(resolved?.header.platform).toBe('chilloutvr')
    expect(resolved?.name).toBe('Together')
  })
  it('changes the header with presence without changing person ownership', () => {
    const resolved = resolveLinkedProfile(target, {
      ...input,
      friends: [{ ...vrc, presence: { state: 'offline' } }, cvr]
    })
    expect(resolved?.header.platform).toBe('chilloutvr')
    expect(resolved?.target.kind).toBe('person')
  })
  it('keeps an explicitly selected account pinned regardless of presence', () => {
    const resolved = resolveLinkedProfile(
      { kind: 'account', personId: 'pair', account: target.anchor },
      { ...input, friends: [{ ...vrc, presence: { state: 'offline' } }, cvr] }
    )
    expect(resolved?.header.platform).toBe('vrchat')
    expect(resolved?.name).toBe('VRC')
  })
  it('never hydrates a linked member from the wrong signed-in account', () => {
    const resolved = resolveLinkedProfile(target, {
      ...input,
      accountIds: { vrchat: 'different', chilloutvr: 'c' }
    })
    expect(resolved?.accounts.map((friend) => friend.platform)).toEqual(['chilloutvr'])
  })
  it('falls back to the opening account after unlink without recreating a person', () => {
    const resolved = resolveLinkedProfile(target, { ...input, profiles: [] })
    expect(resolved?.target).toEqual({ kind: 'account', personId: null, account: target.anchor })
    expect(resolved?.profile).toBeNull()
  })
})
