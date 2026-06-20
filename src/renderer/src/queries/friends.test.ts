import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFriends, friendsQueryKey } from './friends'

describe('friendsQueryKey', () => {
  it('is namespaced per platform', () => {
    expect(friendsQueryKey('vrchat')).toEqual(['friends', 'vrchat'])
    expect(friendsQueryKey('chilloutvr')).toEqual(['friends', 'chilloutvr'])
  })
})

describe('fetchFriends', () => {
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
