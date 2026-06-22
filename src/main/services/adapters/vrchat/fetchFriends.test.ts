import { describe, expect, it } from 'vitest'
import type { VrcFetcher } from './fetchFriends'
import { fetchFriends } from './fetchFriends'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100
const MAX_FRIENDS = 5000

interface RawFriendFixture {
  id: string
  displayName: string
  currentAvatarThumbnailImageUrl: string
  status: string
  statusDescription: null
  tags: string[]
}

function makeFriend(n: number): RawFriendFixture {
  return {
    id: `usr_${String(n).padStart(8, '0')}`,
    displayName: `User${n}`,
    currentAvatarThumbnailImageUrl: `https://example.com/avatar${n}.png`,
    status: 'active',
    statusDescription: null,
    tags: ['system_trust_known']
  }
}

function makePage(startN: number, count: number): RawFriendFixture[] {
  return Array.from({ length: count }, (_, i) => makeFriend(startN + i))
}

const BUCKETS: { onlineFriends: string[]; activeFriends: string[]; offlineFriends: string[] } = {
  onlineFriends: [`usr_${String(1).padStart(8, '0')}`],
  activeFriends: [`usr_${String(2).padStart(8, '0')}`],
  offlineFriends: []
}

/**
 * Build a mock fetcher. Maps paths to pre-canned responses.
 * The fetcher schema-parses the returned value via zod on the real path,
 * but in tests we return already-parsed values (the injected layer).
 */
function buildFetcher(
  onlineFriendPages: unknown[][],
  offlineFriendPages: unknown[][],
  buckets = BUCKETS
): VrcFetcher {
  let onlineIdx = 0
  let offlineIdx = 0

  return <T>(path: string): Promise<T> => {
    if (path === '/auth/user') {
      return Promise.resolve(buckets as T)
    }
    if (path.includes('offline=false')) {
      const page = onlineFriendPages[onlineIdx++] ?? []
      return Promise.resolve(page as T)
    }
    if (path.includes('offline=true')) {
      const page = offlineFriendPages[offlineIdx++] ?? []
      return Promise.resolve(page as T)
    }
    return Promise.reject(new Error(`Unexpected path: ${path}`))
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('fetchFriends', () => {
  describe('pagination stops when a page < PAGE_SIZE items', () => {
    it('stops the online pass when a page has fewer than 100 items', async () => {
      const fetcher = buildFetcher(
        [makePage(1, 50)], // only one partial page → done
        [makePage(1000, 3)]
      )
      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(53)
      expect(result.failedPages).toBe(0)
    })

    it('stops the offline pass when a page has fewer than 100 items', async () => {
      const fetcher = buildFetcher(
        [], // no online friends
        [makePage(1000, 25)]
      )
      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(25)
    })

    it('continues pagination while pages are exactly PAGE_SIZE', async () => {
      const fetcher = buildFetcher(
        [
          makePage(1, PAGE_SIZE),
          makePage(PAGE_SIZE + 1, PAGE_SIZE),
          makePage(PAGE_SIZE * 2 + 1, 5)
        ],
        []
      )
      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(PAGE_SIZE * 2 + 5)
    })
  })

  describe('online + offline merge', () => {
    it('merges online and offline friends into a single list', async () => {
      const fetcher = buildFetcher([makePage(1, 3)], [makePage(100, 4)])
      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(7)
      // Online friends come first (in-game or active), then offline
      const ids = result.friends.map((f) => f.platformUserId)
      expect(ids.slice(0, 3)).toEqual(['usr_00000001', 'usr_00000002', 'usr_00000003'])
      expect(ids.slice(3, 7)).toEqual([
        'usr_00000100',
        'usr_00000101',
        'usr_00000102',
        'usr_00000103'
      ])
    })
  })

  describe('normalization via parsers', () => {
    it('derives presence state from buckets (in-game, active, offline)', async () => {
      const bucketsWithAll = {
        onlineFriends: ['usr_00000001'],
        activeFriends: ['usr_00000002'],
        offlineFriends: ['usr_00000003']
      }
      const fetcher = buildFetcher(
        [
          [
            { ...makeFriend(1), status: 'join me' },
            { ...makeFriend(2), status: 'active' }
          ]
        ],
        [[{ ...makeFriend(3), status: 'offline' }]],
        bucketsWithAll
      )
      const result = await fetchFriends(fetcher)
      const [f1, f2, f3] = result.friends

      expect(f1.presence.state).toBe('in-game')
      expect(f1.status).toBe('join-me')

      expect(f2.presence.state).toBe('active')
      expect(f2.status).toBe('online')

      expect(f3.presence.state).toBe('offline')
      expect(f3.status).toBeNull()
    })

    it('parses trust rank from tags', async () => {
      const fetcher = buildFetcher(
        [
          [
            { ...makeFriend(1), tags: ['system_trust_veteran'] },
            { ...makeFriend(2), tags: ['system_probable_troll'] },
            { ...makeFriend(3), tags: [] }
          ]
        ],
        []
      )
      const result = await fetchFriends(fetcher)
      expect(result.friends[0].trustRank).toBe('trusted')
      expect(result.friends[1].trustRank).toBe('nuisance')
      expect(result.friends[2].trustRank).toBe('visitor')
    })

    it('maps VrcFriend fields correctly (avatarUrl, platform, defaults)', async () => {
      const fetcher = buildFetcher(
        [
          [
            {
              id: 'usr_00000001',
              displayName: 'Alice',
              currentAvatarThumbnailImageUrl: 'https://example.com/img.png',
              status: 'active',
              statusDescription: 'Having fun!',
              tags: ['system_trust_basic']
            }
          ]
        ],
        []
      )
      const result = await fetchFriends(fetcher)
      const f = result.friends[0]

      expect(f.platform).toBe('vrchat')
      expect(f.platformUserId).toBe('usr_00000001')
      expect(f.displayName).toBe('Alice')
      expect(f.avatarUrl).toBe('https://example.com/img.png')
      expect(f.statusDescription).toBe('Having fun!')
      expect(f.trustRank).toBe('new')
      expect(f.instance).toBeNull()
      expect(f.isFavorite).toBe(false)
      expect(f.favoriteGroupIds).toEqual([])
      expect(f.linkedPersonId).toBeNull()
    })

    it('coerces missing optional fields to null', async () => {
      const fetcher = buildFetcher(
        [
          [
            {
              id: 'usr_00000001',
              displayName: 'Bob',
              // no avatarUrl, no status, no statusDescription
              tags: []
            }
          ]
        ],
        []
      )
      const result = await fetchFriends(fetcher)
      const f = result.friends[0]
      expect(f.avatarUrl).toBeNull()
      expect(f.status).toBeNull()
      expect(f.statusDescription).toBeNull()
    })
  })

  describe('MAX_FRIENDS cap', () => {
    it('stops fetching once MAX_FRIENDS friends are collected', async () => {
      // Generate enough pages to exceed MAX_FRIENDS if uncapped
      const pageCount = Math.ceil(MAX_FRIENDS / PAGE_SIZE) + 2
      const onlinePages = Array.from({ length: pageCount }, (_, i) =>
        makePage(i * PAGE_SIZE, PAGE_SIZE)
      )
      const fetcher = buildFetcher(onlinePages, [makePage(99000, PAGE_SIZE)])
      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(MAX_FRIENDS)
    })

    it('does not start the offline pass when MAX_FRIENDS already reached', async () => {
      let offlineCalled = false
      const pageCount = Math.ceil(MAX_FRIENDS / PAGE_SIZE)
      const onlinePages = Array.from({ length: pageCount }, (_, i) =>
        makePage(i * PAGE_SIZE, PAGE_SIZE)
      )

      const fetcher: VrcFetcher = <T>(path: string): Promise<T> => {
        if (path === '/auth/user') return Promise.resolve(BUCKETS as T)
        if (path.includes('offline=true')) {
          offlineCalled = true
          return Promise.resolve([] as T)
        }
        const idx = Math.floor(
          parseInt(new URLSearchParams(path.split('?')[1]).get('offset') ?? '0') / PAGE_SIZE
        )
        return Promise.resolve((onlinePages[idx] ?? []) as T)
      }

      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(MAX_FRIENDS)
      expect(offlineCalled).toBe(false)
    })
  })

  describe('partial-failure tolerance', () => {
    it('returns collected friends plus failedPages count on a page fetch error', async () => {
      let callCount = 0
      const fetcher: VrcFetcher = <T>(path: string): Promise<T> => {
        if (path === '/auth/user') return Promise.resolve(BUCKETS as T)
        if (path.includes('offline=false')) {
          callCount++
          if (callCount === 1) return Promise.resolve(makePage(1, PAGE_SIZE) as T)
          return Promise.reject(new Error('Network error'))
        }
        return Promise.resolve([] as T)
      }

      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(PAGE_SIZE) // got first page
      expect(result.failedPages).toBe(1)
    })

    it('gracefully degrades when /auth/user bucket fetch fails (all offline state)', async () => {
      const fetcher: VrcFetcher = <T>(path: string): Promise<T> => {
        if (path === '/auth/user') return Promise.reject(new Error('auth fetch failed'))
        if (path.includes('offline=false')) {
          return Promise.resolve([{ ...makeFriend(1) }] as T)
        }
        return Promise.resolve([] as T)
      }

      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(1)
      // Without buckets, all friends default to 'offline'
      expect(result.friends[0].presence.state).toBe('offline')
    })

    it('returns empty list with 0 failedPages when there are no friends', async () => {
      const fetcher = buildFetcher([], [])
      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(0)
      expect(result.failedPages).toBe(0)
    })
  })
})
