import { QueryClient } from '@tanstack/react-query'
import {
  applyOrderedFriendEvent,
  shareFriendReplayResult,
  withFriendEventReplay
} from './friendEventReplay'
import type { Friend } from '@shared/types'
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

it.each([
  { coveredIds: ['usr_alice', 'usr_bob'], overrides: [] },
  { coveredIds: [], overrides: [] },
  { coveredIds: ['usr_alice'], overrides: [{ revision: 6, friendIds: ['usr_bob'] }] },
  { coveredIds: ['usr_alice', 'usr_alice'], overrides: [] }
])('rejects inconsistent coverage and preserves cache AND prior fences: %j', async (coverage) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const alice = fullFriend('Alice', 'vrchat'),
    bob = fullFriend('Bob', 'vrchat'),
    key = friendsQueryKey('vrchat')
  const getFriends = vi
    .fn()
    .mockResolvedValueOnce({
      friends: [alice],
      completeness: 'complete',
      provenance: { baseRevision: 1, overrides: [] }
    })
    .mockResolvedValueOnce({
      friends: [alice],
      completeness: 'partial',
      provenance: { baseRevision: 5, ...coverage }
    })
  vi.stubGlobal('window', { vrx: { getFriends } })
  const read = (): Promise<Friend[]> =>
    client.fetchQuery({
      queryKey: key,
      structuralSharing: shareFriendReplayResult,
      queryFn: ({ signal }) =>
        withFriendEventReplay(client, signal, () =>
          fetchFriendRoster('vrchat', () => client.getQueryData(key))
        )
    })
  try {
    await read()
    await expect(read()).rejects.toThrow('invalid_roster_response')
    const cached = client.getQueryData<Friend[]>(key)!
    expect(cached).toEqual([alice])
    expect(
      applyOrderedFriendEvent(client, cached, {
        type: 'friend-added',
        platform: 'vrchat',
        friend: bob,
        rosterRevision: 3
      })
    ).toEqual([alice, bob])
    expect(
      applyOrderedFriendEvent(client, cached, {
        type: 'friend-added',
        platform: 'vrchat',
        friend: bob,
        rosterRevision: 0
      })
    ).toEqual([alice])
  } finally {
    client.clear()
    vi.unstubAllGlobals()
  }
})
