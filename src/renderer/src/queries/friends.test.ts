import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFriends, friendsQueryKey } from './friends'
import { fullFriend } from '../test-utils/friendFixture'

describe('friendsQueryKey', () => {
  it('is namespaced per platform', () => {
    expect(friendsQueryKey('vrchat')).toEqual(['friends', 'vrchat'])
    expect(friendsQueryKey('chilloutvr')).toEqual(['friends', 'chilloutvr'])
  })
})

describe('fetchFriends', () => {
  it('keeps cached friends omitted by a partial roster without changing their presence', async () => {
    const omitted = { ...fullFriend('Omitted', 'vrchat'), presence: { state: 'in-game' as const } }
    const old = fullFriend('Old', 'vrchat')
    const fresh = { ...old, displayName: 'Fresh' }
    const getFriends = vi.fn().mockResolvedValue({ friends: [fresh], completeness: 'partial' })
    vi.stubGlobal('window', { vrx: { getFriends } })
    const result = await fetchFriends('vrchat', () => [old, omitted])
    expect(result).toEqual([fresh, omitted])
    expect(result[1]).toBe(omitted)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when window is undefined (pure node context)', async () => {
    // no window stub — exercises the `typeof window === 'undefined'` guard
    await expect(fetchFriends('vrchat')).rejects.toThrow('bridge_unavailable')
  })

  it('throws when the bridge is unavailable', async () => {
    vi.stubGlobal('window', {})
    await expect(fetchFriends('vrchat')).rejects.toThrow('bridge_unavailable')
  })

  it('returns friends from the bridge and forwards the platform', async () => {
    const friends = [{ platformUserId: 'usr_1', platform: 'vrchat', displayName: 'A' }]
    const getFriends = vi.fn().mockResolvedValue(friends)
    vi.stubGlobal('window', { vrx: { getFriends } })
    await expect(fetchFriends('vrchat')).resolves.toBe(friends)
    expect(getFriends).toHaveBeenCalledWith({ platform: 'vrchat' })
  })
})
