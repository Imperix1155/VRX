import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_CACHE_MS,
  COMMUNITY_SEARCH_COOLDOWN_MS,
  type CommunityGroup,
  type PersonProfile,
  type PersonSummary
} from '@shared/community'
import type { ExploreWorld } from '@shared/explore'
import type { Platform } from '@shared/types'
import type { CommunityAdapter } from './adapters/CommunityAdapter'
import type { ExploreWorldEvidence } from './adapters/ExploreAdapter'
import { AuthError, NetworkError, RateLimitError } from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import { COMMUNITY_REFRESH_MIN_MS, CommunityService } from './communityService'

const FRIEND = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const STRANGER = 'usr_5a3c1e2d-0000-4000-8000-000000000002'
const CVR_PERSON = 'B81D5892-5119-4F44-B473-7BF4FFDA0458'
const MISSING = 'usr_00000000-0000-4000-8000-00000000dead'
const WORLD = 'wrld_5a3c1e2d-0000-4000-8000-000000000003'

function person(platform: Platform, userId: string): PersonSummary {
  return { platform, userId, displayName: userId.slice(-4), imageUrl: null, isFriend: null }
}

function profile(platform: Platform, userId: string): PersonProfile {
  return { ...person(platform, userId), pronouns: null, bio: 'hi', rank: null, badges: [] }
}

function world(platform: Platform, worldId: string): ExploreWorldEvidence {
  return {
    platform,
    worldId,
    name: 'World',
    thumbnailUrl: null,
    activity: { state: 'unknown', value: null, source: 'unknown' },
    visibleRoomCount: { state: 'unknown', value: null, source: 'unknown' },
    popularity: null,
    sourceOrder: 0
  }
}

const group: CommunityGroup = {
  platform: 'vrchat',
  groupId: 'grp_5a3c1e2d-0000-4000-8000-000000000004',
  name: 'Group',
  code: 'GRP.0001',
  description: null,
  imageUrl: null,
  bannerUrl: null,
  memberCount: 3,
  role: 'owner'
}

class FakeAdapter implements CommunityAdapter {
  generation = 1
  signedIn = true
  error: Error | null = null
  players: number | null = 1234
  people: PersonSummary[] = []
  readonly getProfile = vi.fn(async (userId: string) => {
    if (this.error) throw this.error
    return userId === MISSING ? null : profile(this.platform, userId)
  })
  readonly getProfileWorlds = vi.fn(async () => ({ items: [], complete: true }))
  readonly getProfileGroups = vi.fn(async () => ({ items: [group], complete: true }))
  readonly search = vi.fn(async () => {
    if (this.error) throw this.error
    return { people: this.people, worlds: [world(this.platform, WORLD)] }
  })
  readonly getWorldList = vi.fn(async () => [world(this.platform, WORLD)])
  readonly getPlayersOnline = vi.fn(async () => {
    if (this.error) throw this.error
    return this.players
  })
  readonly getMyGroups = vi.fn(async () => ({ items: [group], complete: true }))

  constructor(readonly platform: Platform) {}

  captureCommunityLease(): RequestLease {
    if (!this.signedIn) throw new AuthError()
    const generation = this.generation
    return {
      generation,
      signal: new AbortController().signal,
      isCurrent: () => this.signedIn && generation === this.generation
    }
  }
}

function setup(): {
  vrc: FakeAdapter
  cvr: FakeAdapter
  service: CommunityService
  now: { value: number }
  adopt: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn>
} {
  const vrc = new FakeAdapter('vrchat')
  const cvr = new FakeAdapter('chilloutvr')
  const now = { value: 100_000 }
  const adopt = vi.fn((platform: Platform, evidence: readonly ExploreWorldEvidence[]) =>
    evidence.map((item): ExploreWorld => ({ ...item, worldRef: `ref-${platform}-${item.worldId}` }))
  )
  const log = vi.fn()
  const service = new CommunityService({
    adapters: new Map<Platform, CommunityAdapter>([
      ['vrchat', vrc],
      ['chilloutvr', cvr]
    ]),
    adoptWorlds: adopt,
    isFriend: (platform, userId) =>
      platform === 'vrchat' && (userId === FRIEND || userId === MISSING),
    clock: () => now.value,
    wallClock: () => 1_700_000_000_000,
    log
  })
  return { vrc, cvr, service, now, adopt, log }
}

describe('CommunityService profiles', () => {
  it('reads a friend once and reuses the answer until it is 5 minutes old', async () => {
    const { vrc, service, now } = setup()
    expect(await service.getProfile('vrchat', FRIEND)).toEqual({
      ok: true,
      profile: profile('vrchat', FRIEND)
    })
    await service.getProfile('vrchat', FRIEND)
    expect(vrc.getProfile).toHaveBeenCalledTimes(1)
    now.value += COMMUNITY_CACHE_MS
    await service.getProfile('vrchat', FRIEND)
    expect(vrc.getProfile).toHaveBeenCalledTimes(2)
  })

  it('joins a second ask to the read already running', async () => {
    const { vrc, service } = setup()
    const [a, b] = await Promise.all([
      service.getProfile('vrchat', FRIEND),
      service.getProfile('vrchat', FRIEND)
    ])
    expect(a).toEqual(b)
    expect(vrc.getProfile).toHaveBeenCalledTimes(1)
  })

  it('refuses a stranger or a malformed ID without a request', async () => {
    const { vrc, service } = setup()
    expect(await service.getProfile('vrchat', STRANGER)).toEqual({
      ok: false,
      reason: 'unknown-person'
    })
    expect(await service.getProfile('vrchat', '../auth/user')).toEqual({
      ok: false,
      reason: 'unknown-person'
    })
    expect(await service.getProfileWorlds('vrchat', STRANGER)).toEqual({
      ok: false,
      reason: 'unknown-person'
    })
    expect(vrc.getProfile).not.toHaveBeenCalled()
    expect(vrc.getProfileWorlds).not.toHaveBeenCalled()
  })

  it('allows a person a search showed, case-insensitively on ChilloutVR', async () => {
    const { cvr, service } = setup()
    cvr.people = [person('chilloutvr', CVR_PERSON.toLowerCase())]
    expect((await service.search('chilloutvr', 'lop')).ok).toBe(true)
    const result = await service.getProfile('chilloutvr', CVR_PERSON)
    expect(result.ok).toBe(true)
    expect(cvr.getProfile).toHaveBeenCalledWith(CVR_PERSON.toLowerCase(), expect.anything())
  })

  it('says whether a search listed a person, for friend requests', async () => {
    const { cvr, service } = setup()
    expect(service.wasListed('chilloutvr', CVR_PERSON)).toBe(false)
    cvr.people = [person('chilloutvr', CVR_PERSON.toLowerCase())]
    expect((await service.search('chilloutvr', 'lop')).ok).toBe(true)
    expect(service.wasListed('chilloutvr', CVR_PERSON)).toBe(true)
    expect(service.wasListed('vrchat', CVR_PERSON)).toBe(false)
    expect(service.wasListed('chilloutvr', '../users')).toBe(false)
    service.clearPlatform('chilloutvr')
    expect(service.wasListed('chilloutvr', CVR_PERSON)).toBe(false)
  })

  it('reports a missing person as not found', async () => {
    const { service } = setup()
    expect(await service.getProfile('vrchat', MISSING)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('maps failures to typed reasons and logs no identifiers', async () => {
    const { vrc, service, log } = setup()
    vrc.error = new RateLimitError(1000)
    expect(await service.getProfile('vrchat', FRIEND)).toEqual({
      ok: false,
      reason: 'rate-limited'
    })
    vrc.error = new NetworkError('down')
    expect(await service.getProfile('vrchat', FRIEND)).toEqual({
      ok: false,
      reason: 'unavailable'
    })
    vrc.error = new AuthError('no', 401)
    expect(await service.getProfile('vrchat', FRIEND)).toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(FRIEND)
  })

  it('answers not-authenticated with no session', async () => {
    const { vrc, service } = setup()
    vrc.signedIn = false
    expect(await service.getProfile('vrchat', FRIEND)).toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
  })

  it('forgets everything at an account boundary', async () => {
    const { vrc, service } = setup()
    await service.getProfile('vrchat', FRIEND)
    vrc.generation++
    await service.getProfile('vrchat', FRIEND)
    expect(vrc.getProfile).toHaveBeenCalledTimes(2)
    service.clearPlatform('vrchat')
    await service.getProfile('vrchat', FRIEND)
    expect(vrc.getProfile).toHaveBeenCalledTimes(3)
  })

  it('reads groups and worlds on demand', async () => {
    const { vrc, service } = setup()
    expect(await service.getProfileGroups('vrchat', FRIEND)).toEqual({
      ok: true,
      groups: [group],
      complete: true
    })
    expect(await service.getProfileWorlds('vrchat', FRIEND)).toEqual({
      ok: true,
      worlds: [],
      complete: true
    })
    expect(vrc.getProfile).not.toHaveBeenCalled()
  })
})

describe('CommunityService search', () => {
  it('refuses too-short or too-long text without a request', async () => {
    const { vrc, service } = setup()
    for (const query of ['', ' a ', 'x'.repeat(65)]) {
      expect(await service.search('vrchat', query)).toEqual({ ok: false, reason: 'invalid-query' })
    }
    expect(vrc.search).not.toHaveBeenCalled()
  })

  it('normalizes the text, adopts world results, and spaces searches 2 s apart', async () => {
    const { vrc, service, now, adopt } = setup()
    const first = await service.search('vrchat', '  Cozy   Cafe ')
    expect(vrc.search).toHaveBeenCalledWith('Cozy Cafe', expect.anything())
    expect(first).toMatchObject({
      ok: true,
      query: 'Cozy Cafe',
      worlds: [{ worldRef: `ref-vrchat-${WORLD}` }]
    })
    expect(adopt).toHaveBeenCalledTimes(1)
    expect(await service.search('vrchat', 'other')).toEqual({ ok: false, reason: 'cooldown' })
    // The same text is answered from memory, cooldown or not.
    expect((await service.search('vrchat', 'cozy cafe')).ok).toBe(true)
    expect(vrc.search).toHaveBeenCalledTimes(1)
    now.value += COMMUNITY_SEARCH_COOLDOWN_MS
    expect((await service.search('vrchat', 'other')).ok).toBe(true)
    expect(vrc.search).toHaveBeenCalledTimes(2)
  })

  it('keeps each platform on its own cooldown', async () => {
    const { vrc, cvr, service } = setup()
    await service.search('vrchat', 'cats')
    expect((await service.search('chilloutvr', 'cats')).ok).toBe(true)
    expect(vrc.search).toHaveBeenCalledTimes(1)
    expect(cvr.search).toHaveBeenCalledTimes(1)
  })
})

describe('CommunityService lists, players and groups', () => {
  it('reuses a world list and lets Refresh re-read only after 30 s', async () => {
    const { vrc, service, now } = setup()
    await service.getWorldList('vrchat', 'new')
    await service.getWorldList('vrchat', 'new', true)
    expect(vrc.getWorldList).toHaveBeenCalledTimes(1)
    now.value += COMMUNITY_REFRESH_MIN_MS
    const result = await service.getWorldList('vrchat', 'new', true)
    expect(vrc.getWorldList).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ ok: true, list: 'new', worlds: [{ worldId: WORLD }] })
    await service.getWorldList('vrchat', 'updated')
    expect(vrc.getWorldList).toHaveBeenLastCalledWith('updated', expect.anything())
  })

  it('reads players online at most once per 5 minutes and never caches a missing count', async () => {
    const { vrc, service, now } = setup()
    expect(await service.getPlayersOnline('vrchat')).toEqual({
      ok: true,
      platform: 'vrchat',
      count: 1234,
      checkedAt: 1_700_000_000_000
    })
    await service.getPlayersOnline('vrchat')
    expect(vrc.getPlayersOnline).toHaveBeenCalledTimes(1)
    now.value += COMMUNITY_CACHE_MS
    vrc.players = null
    expect(await service.getPlayersOnline('vrchat')).toEqual({ ok: false, reason: 'unavailable' })
    vrc.players = 7
    expect(await service.getPlayersOnline('vrchat')).toMatchObject({ ok: true, count: 7 })
  })

  it('lists the user’s own groups and refreshes them on request', async () => {
    const { cvr, service, now } = setup()
    expect(await service.getMyGroups('chilloutvr')).toEqual({
      ok: true,
      platform: 'chilloutvr',
      groups: [group],
      complete: true
    })
    now.value += COMMUNITY_REFRESH_MIN_MS
    await service.getMyGroups('chilloutvr')
    expect(cvr.getMyGroups).toHaveBeenCalledTimes(1)
    await service.getMyGroups('chilloutvr', true)
    expect(cvr.getMyGroups).toHaveBeenCalledTimes(2)
  })
})
