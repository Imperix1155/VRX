import { describe, expect, it } from 'vitest'
import type { CvrFetcher } from './fetchCvrFriends'
import { fetchCvrFriends } from './fetchCvrFriends'

interface RawCvrFriendFixture {
  id: string
  name: string
  imageUrl: string | null
  categories: string[]
}

const ALICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const BOB_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'

function makeFriend(id: string, name: string): RawCvrFriendFixture {
  return {
    id,
    name,
    imageUrl: `https://example.com/${name.toLowerCase()}.png`,
    categories: ['favorites']
  }
}

function buildFetcher(roster: unknown[]): CvrFetcher {
  return <T>(path: string): Promise<T> => {
    if (path !== '/friends') return Promise.reject(new Error(`Unexpected path: ${path}`))
    return Promise.resolve(roster as T)
  }
}

describe('fetchCvrFriends (VRX-57)', () => {
  it('fetches one flat roster and maps CVR friends to the shared Friend shape', async () => {
    let calls = 0
    const fetcher: CvrFetcher = <T>(path: string): Promise<T> => {
      calls++
      expect(path).toBe('/friends')
      return Promise.resolve([
        makeFriend('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE', 'Alice'),
        makeFriend(BOB_ID, 'Bob')
      ] as T)
    }

    const result = await fetchCvrFriends(fetcher)

    expect(calls).toBe(1)
    expect(result.skippedRecords).toBe(0)
    expect(result.friends).toHaveLength(2)
    expect(result.friends[0]).toEqual({
      platform: 'chilloutvr',
      platformUserId: ALICE_ID,
      displayName: 'Alice',
      avatarUrl: 'https://example.com/alice.png',
      presence: { state: 'offline' },
      status: null,
      statusDescription: null,
      trustRank: null,
      instance: null,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    })
  })

  it('ignores unknown fields and defaults missing optional fields', async () => {
    const fetcher = buildFetcher([
      {
        id: ALICE_ID,
        name: 'Alice',
        extraWireField: { nested: true }
      },
      {
        id: BOB_ID,
        name: 'Bob',
        imageUrl: 42,
        categories: 'not-an-array',
        anotherUnknownField: 'ignored'
      }
    ])

    const result = await fetchCvrFriends(fetcher)

    expect(result.skippedRecords).toBe(0)
    expect(result.friends).toHaveLength(2)
    expect(result.friends[0]!.avatarUrl).toBeNull()
    expect(result.friends[1]!.avatarUrl).toBeNull()
  })

  it('skips malformed entries and reports the skip count', async () => {
    const fetcher = buildFetcher([
      makeFriend(ALICE_ID, 'Alice'),
      { id: 'not-a-guid', name: 'Bad Id', imageUrl: null, categories: [] },
      { id: BOB_ID, imageUrl: null, categories: [] },
      null,
      makeFriend(BOB_ID, 'Bob')
    ])

    const result = await fetchCvrFriends(fetcher)

    expect(result.friends.map((friend) => friend.platformUserId)).toEqual([ALICE_ID, BOB_ID])
    expect(result.skippedRecords).toBe(3)
  })

  it('throws on a total fetch failure instead of returning a misleading empty list', async () => {
    const fetcher: CvrFetcher = () => Promise.reject(new Error('network down'))

    await expect(fetchCvrFriends(fetcher)).rejects.toThrow('network down')
  })

  it('returns an empty roster with zero skipped records when the user has no friends', async () => {
    const result = await fetchCvrFriends(buildFetcher([]))

    expect(result.friends).toEqual([])
    expect(result.skippedRecords).toBe(0)
  })
})
