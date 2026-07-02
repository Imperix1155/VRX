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

    it('parses a real location into a non-null InstanceInfo', async () => {
      const fetcher = buildFetcher(
        [
          [
            {
              ...makeFriend(1),
              location: 'wrld_abc:12345~hidden(usr_x)~region(us)'
            }
          ]
        ],
        []
      )
      const result = await fetchFriends(fetcher)
      const f = result.friends[0]
      expect(f.instance).not.toBeNull()
      expect(f.instance!.worldId).toBe('wrld_abc')
      expect(f.instance!.instanceId).toBe('12345~hidden(usr_x)~region(us)')
      expect(f.instance!.type).toBe('friends-plus')
      expect(f.instance!.openness).toBe('friends-plus')
      expect(f.instance!.isGroup).toBe(false)
      expect(f.instance!.region).toBe('us')
      expect(f.instance!.worldName).toBeNull()
    })

    it('sets instance to null for location="private"', async () => {
      const fetcher = buildFetcher(
        [
          [
            {
              ...makeFriend(1),
              location: 'private'
            }
          ]
        ],
        []
      )
      const result = await fetchFriends(fetcher)
      expect(result.friends[0].instance).toBeNull()
    })

    it('sets instance to null when location is absent', async () => {
      const fetcher = buildFetcher(
        [
          [
            {
              id: 'usr_00000001',
              displayName: 'Carol',
              tags: []
              // no location field
            }
          ]
        ],
        []
      )
      const result = await fetchFriends(fetcher)
      expect(result.friends[0].instance).toBeNull()
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
    it('returns collected friends plus failedPages count on page fetch errors', async () => {
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
      // W4 skip-and-continue: a persistently-failing pass retries up to the
      // consecutive-failure cap (3) before giving up — was 1 under break-on-first.
      expect(result.failedPages).toBe(3)
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
      expect(result.skippedRecords).toBe(0)
    })
  })

  // ─── 2026-07 audit W4: skip-and-continue (the doc's promise, now real) ────────

  describe('malformed-record and failed-page tolerance (W4)', () => {
    it('skips a malformed record and keeps the other 99 (1-bad-of-100)', async () => {
      const page: unknown[] = makePage(1, PAGE_SIZE)
      page[42] = { id: 'usr_bad' } // no displayName → fails rawFriendSchema
      const fetcher = buildFetcher([page], [])

      const result = await fetchFriends(fetcher)

      expect(result.friends).toHaveLength(PAGE_SIZE - 1)
      expect(result.skippedRecords).toBe(1)
      expect(result.failedPages).toBe(0)
      // The survivors are the real ones, in order, without the poisoned slot.
      expect(result.friends.some((f) => f.platformUserId === 'usr_bad')).toBe(false)
    })

    it('skips non-object garbage elements in a page', async () => {
      const fetcher = buildFetcher([[makeFriend(1), null, 42, 'nope', makeFriend(2)]], [])
      const result = await fetchFriends(fetcher)
      expect(result.friends).toHaveLength(2)
      expect(result.skippedRecords).toBe(3)
    })

    it('continues to the next page after a single failed page (transient blip)', async () => {
      // offset=0 succeeds (full page), offset=100 FAILS, offset=200 succeeds (partial).
      const fetcher: VrcFetcher = <T>(path: string): Promise<T> => {
        if (path === '/auth/user') return Promise.resolve(BUCKETS as T)
        if (path.includes('offline=true')) return Promise.resolve([] as T)
        const offset = parseInt(new URLSearchParams(path.split('?')[1]).get('offset') ?? '0')
        if (offset === 0) return Promise.resolve(makePage(1, PAGE_SIZE) as T)
        if (offset === PAGE_SIZE) return Promise.reject(new Error('blip'))
        return Promise.resolve(makePage(500, 10) as T)
      }

      const result = await fetchFriends(fetcher)

      // Pages 1 and 3 survive; the failed window is counted, not fatal.
      expect(result.friends).toHaveLength(PAGE_SIZE + 10)
      expect(result.failedPages).toBe(1)
    })

    it('stops a pass after 3 consecutive page failures (dead API is not hammered)', async () => {
      let onlineAttempts = 0
      const fetcher: VrcFetcher = <T>(path: string): Promise<T> => {
        if (path === '/auth/user') return Promise.resolve(BUCKETS as T)
        if (path.includes('offline=true')) return Promise.resolve([] as T)
        onlineAttempts++
        return Promise.reject(new Error('down'))
      }

      const result = await fetchFriends(fetcher)

      expect(onlineAttempts).toBe(3)
      expect(result.failedPages).toBe(3)
      expect(result.friends).toHaveLength(0)
    })

    it('terminates (bounded requests) when every full page is all-drifted records', async () => {
      // The nasty case: transport succeeds (no failure count, circuit reset) yet
      // every record fails the schema — `existing` never grows. A misbehaving
      // endpoint (or systematic field-rename drift) returning full pages forever
      // must NOT be hammered forever: the pass is bounded by offset, at
      // MAX_FRIENDS/PAGE_SIZE requests (adversarial-review Critical, W4).
      let onlineRequests = 0
      const badFullPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `usr_bad_${i}` }))
      const fetcher: VrcFetcher = <T>(path: string): Promise<T> => {
        if (path === '/auth/user') return Promise.resolve(BUCKETS as T)
        if (path.includes('offline=true')) return Promise.resolve([] as T)
        onlineRequests++
        return Promise.resolve(badFullPage as T)
      }

      const result = await fetchFriends(fetcher)

      expect(onlineRequests).toBe(MAX_FRIENDS / PAGE_SIZE) // 50, not unbounded
      expect(result.friends).toHaveLength(0)
      expect(result.skippedRecords).toBe(MAX_FRIENDS)
      expect(result.failedPages).toBe(0)
    })

    it('resets the consecutive-failure count on a successful page', async () => {
      // fail, ok(full), fail, ok(full), fail, ok(partial) — never 3 in a row.
      const script = ['fail', 'ok-full', 'fail', 'ok-full', 'fail', 'ok-partial']
      let call = 0
      const fetcher: VrcFetcher = <T>(path: string): Promise<T> => {
        if (path === '/auth/user') return Promise.resolve(BUCKETS as T)
        if (path.includes('offline=true')) return Promise.resolve([] as T)
        const step = script[call++] ?? 'ok-partial'
        if (step === 'fail') return Promise.reject(new Error('blip'))
        if (step === 'ok-full') return Promise.resolve(makePage(call * 1000, PAGE_SIZE) as T)
        return Promise.resolve(makePage(call * 1000, 5) as T)
      }

      const result = await fetchFriends(fetcher)

      expect(result.friends).toHaveLength(PAGE_SIZE * 2 + 5)
      expect(result.failedPages).toBe(3)
    })
  })
})
