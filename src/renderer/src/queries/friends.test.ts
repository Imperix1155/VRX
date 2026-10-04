import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFriendRoster, fetchFriends, friendsQueryKey } from './friends'
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

describe('roster envelope contract', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each([
    null,
    { baseRevision: NaN, overrides: [] },
    { baseRevision: -1, overrides: [] },
    { baseRevision: 1, overrides: [{ revision: 0, friendIds: ['usr_a'] }] },
    { baseRevision: 1, overrides: [{ revision: 2, friendIds: null }] }
  ])(
    'rejects malformed provenance instead of silently dropping live updates: %j',
    async (provenance) => {
      vi.stubGlobal('window', {
        vrx: {
          getFriends: vi
            .fn()
            .mockResolvedValue({ friends: [], completeness: 'complete', provenance })
        }
      })
      await expect(fetchFriendRoster('vrchat')).rejects.toThrow('invalid_roster_response')
    }
  )
  it('preserves legacy partial merging and does not merge omissions into a complete envelope', async () => {
    const old = fullFriend('Old', 'vrchat')
    const getFriends = vi
      .fn()
      .mockResolvedValueOnce({ friends: [], completeness: 'partial' })
      .mockResolvedValueOnce({
        friends: [],
        completeness: 'complete',
        provenance: { baseRevision: 4, overrides: [] }
      })
    vi.stubGlobal('window', { vrx: { getFriends } })
    expect((await fetchFriendRoster('vrchat', () => [old])).friends).toEqual([old])
    expect(await fetchFriendRoster('vrchat', () => [old])).toEqual({
      friends: [],
      completeness: 'complete',
      provenance: { baseRevision: 4, overrides: [] }
    })
  })
})
