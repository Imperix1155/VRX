import { beforeEach, describe, expect, it } from 'vitest'
import type { Platform } from '@shared/types'
import {
  GAME_FAVORITE_FAILURE_BACKOFF_MS,
  GAME_FAVORITE_REFRESH_COOLDOWN_MS,
  GAME_FAVORITE_WRITE_SPACING_MS
} from '@shared/gameFavorites'
import { AccountSession } from './accountSession'
import { GameFavoritesService } from './gameFavorites'
import type {
  GameFavoriteChange,
  GameFavoriteMembership,
  GameFavoritesAdapter,
  GameFavoritesRead
} from './adapters/GameFavoritesAdapter'
import type { ExploreWorldEvidence } from './adapters/ExploreAdapter'
import type { RequestLease } from './adapters/RequestLease'
import { RateLimitError } from './adapters/errors'

const ME = 'usr_12345678-1234-1234-1234-123456789abc'
const FRIEND = 'usr_aaaaaaaa-1234-1234-1234-123456789abc'
const OTHER = 'usr_bbbbbbbb-1234-1234-1234-123456789abc'
const WORLD = 'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b'

function evidence(worldId: string): ExploreWorldEvidence {
  return {
    platform: 'vrchat',
    worldId,
    name: 'Sky',
    thumbnailUrl: null,
    activity: { state: 'unknown', value: null, source: 'unknown' },
    visibleRoomCount: { state: 'unknown', value: null, source: 'unknown' },
    popularity: null,
    sourceOrder: 0
  }
}

class FakeAdapter implements GameFavoritesAdapter {
  readonly platform: Platform = 'vrchat'
  reads = 0
  writes: GameFavoriteChange[] = []
  readError: Error | null = null
  writeError: Error | null = null
  generation = 1
  signedIn = true
  priorities: Array<string | undefined> = []

  captureFavoritesLease(): RequestLease {
    if (!this.signedIn) throw new Error('no session')
    return {
      generation: this.generation,
      signal: new AbortController().signal,
      isCurrent: () => true
    }
  }
  async readGameFavorites(_lease: RequestLease, priority?: string): Promise<GameFavoritesRead> {
    this.reads += 1
    this.priorities.push(priority)
    if (this.readError) throw this.readError
    return {
      oneGroupPerItem: true,
      groups: {
        friend: [
          { key: 'friend:group_0', name: 'Besties', capacity: 2 },
          { key: 'friend:group_1', name: 'Group 2', capacity: 150 }
        ],
        world: [{ key: 'world:worlds1', name: 'Chill', capacity: 100 }]
      },
      friends: new Map([[OTHER, [{ key: 'friend:group_0', entryId: null }]]]),
      worlds: new Map(),
      worldEvidence: []
    }
  }
  async writeGameFavorite(change: GameFavoriteChange): Promise<GameFavoriteMembership[]> {
    this.writes.push(change)
    if (this.writeError) throw this.writeError
    return change.on ? [{ key: change.group.key, entryId: null }] : []
  }
}

describe('GameFavoritesService', () => {
  let session: AccountSession
  let adapter: FakeAdapter
  let enabled: boolean
  let friends: Set<string>
  let now: number
  let slept: number[]
  let service: GameFavoritesService

  function revision(): { platformAccountId: string; epoch: number } {
    const resolution = session.resolve('vrchat')
    if ('status' in resolution) throw new Error('signed out')
    return { platformAccountId: ME, epoch: resolution.epoch }
  }
  function write(groupKey: string, on: boolean, id = FRIEND): ReturnType<typeof service.set> {
    return service.set({
      platform: 'vrchat',
      kind: 'friend',
      id,
      groupKey,
      on,
      revision: revision()
    })
  }

  beforeEach(() => {
    session = new AccountSession()
    session.setIdentity('vrchat', ME)
    adapter = new FakeAdapter()
    enabled = true
    friends = new Set([FRIEND, OTHER])
    now = 0
    slept = []
    service = new GameFavoritesService({
      adapters: new Map([['vrchat', adapter]]),
      accountSession: session,
      isFriend: (_platform, id) => friends.has(id),
      isEnabled: () => enabled,
      clock: () => now,
      sleep: async (ms) => {
        slept.push(ms)
        now += ms
      }
    })
  })

  it('reads once per sign-in in the background, and answers from memory after', async () => {
    const first = await service.get('vrchat')
    expect(first.state).toBe('ready')
    if (first.state !== 'ready') return
    expect(first.view.groups.friend.map((g) => g.count)).toEqual([1, 0])
    expect(first.view.friends[OTHER]).toEqual(['friend:group_0'])
    await service.get('vrchat')
    await service.get('vrchat')
    expect(adapter.reads).toBe(1)
    expect(adapter.priorities).toEqual(['background'])
  })

  it('reads again on a Refresh press only after the cooldown', async () => {
    await service.get('vrchat')
    await service.get('vrchat', true)
    expect(adapter.reads).toBe(1)
    now += GAME_FAVORITE_REFRESH_COOLDOWN_MS
    await service.get('vrchat', true)
    expect(adapter.reads).toBe(2)
    expect(adapter.priorities[1]).toBe('interactive')
  })

  it('keeps the Refresh cooldown after a failed Refresh, showing what it had', async () => {
    await service.get('vrchat')
    now += GAME_FAVORITE_REFRESH_COOLDOWN_MS
    adapter.readError = new RateLimitError(1000)
    expect((await service.get('vrchat', true)).state).toBe('ready')
    expect((await service.get('vrchat', true)).state).toBe('ready')
    expect((await service.get('vrchat', true)).state).toBe('ready')
    expect(adapter.reads).toBe(2)
    adapter.readError = null
    now += GAME_FAVORITE_REFRESH_COOLDOWN_MS
    await service.get('vrchat', true)
    expect(adapter.reads).toBe(3)
  })

  it('backs off after a failed read instead of asking again on its own', async () => {
    adapter.readError = new RateLimitError(1000)
    expect(await service.get('vrchat')).toEqual({ state: 'rate-limited' })
    expect(await service.get('vrchat')).toEqual({ state: 'rate-limited' })
    expect(adapter.reads).toBe(1)
    adapter.readError = null
    now += GAME_FAVORITE_FAILURE_BACKOFF_MS
    expect((await service.get('vrchat')).state).toBe('ready')
    expect(adapter.reads).toBe(2)
  })

  it('reads and writes nothing while the setting is off', async () => {
    enabled = false
    expect(await service.get('vrchat')).toEqual({ state: 'off' })
    expect(await write('friend:group_0', true)).toEqual({ ok: false, reason: 'off' })
    expect(adapter.reads + adapter.writes.length).toBe(0)
  })

  it('writes one change per press and spaces writes apart', async () => {
    await service.get('vrchat')
    expect(await write('friend:group_1', true)).toEqual({ ok: true, groups: ['friend:group_1'] })
    expect(await write('friend:group_1', false)).toEqual({ ok: true, groups: [] })
    expect(adapter.writes).toHaveLength(2)
    expect(slept).toEqual([GAME_FAVORITE_WRITE_SPACING_MS])
    // Asking for what is already true sends nothing.
    expect(await write('friend:group_1', false)).toEqual({ ok: true, groups: [] })
    expect(adapter.writes).toHaveLength(2)
  })

  it('keeps VRChat rules: one group per friend, and a full group refuses', async () => {
    await service.get('vrchat')
    await write('friend:group_1', true)
    expect(await write('friend:group_0', true)).toEqual({ ok: false, reason: 'other-group' })
    friends.add('usr_cccccccc-1234-1234-1234-123456789abc')
    await write('friend:group_0', true, 'usr_cccccccc-1234-1234-1234-123456789abc')
    // Besties holds two: OTHER and the new one.
    friends.add('usr_dddddddd-1234-1234-1234-123456789abc')
    expect(await write('friend:group_0', true, 'usr_dddddddd-1234-1234-1234-123456789abc')).toEqual(
      { ok: false, reason: 'full' }
    )
    expect(adapter.writes).toHaveLength(2)
  })

  it('refuses a stranger, an unknown group, a stale view and a bad id', async () => {
    await service.get('vrchat')
    friends.delete(FRIEND)
    expect(await write('friend:group_0', true)).toEqual({ ok: false, reason: 'not-friend' })
    friends.add(FRIEND)
    expect(await write('friend:nope', true)).toEqual({ ok: false, reason: 'invalid' })
    expect(await write('friend:group_0', true, 'usr_bad/../x')).toEqual({
      ok: false,
      reason: 'invalid'
    })
    expect(
      await service.set({
        platform: 'vrchat',
        kind: 'friend',
        id: FRIEND,
        groupKey: 'friend:group_0',
        on: true,
        revision: { platformAccountId: 'someone-else', epoch: 0 }
      })
    ).toEqual({ ok: false, reason: 'stale' })
    expect(adapter.writes).toHaveLength(0)
  })

  it('needs a read first, and forgets everything at an account boundary', async () => {
    expect(await write('friend:group_0', true)).toEqual({ ok: false, reason: 'stale' })
    await service.get('vrchat')
    service.clearPlatform('vrchat')
    expect(await write('friend:group_0', true)).toEqual({ ok: false, reason: 'stale' })
    expect(adapter.writes).toHaveLength(0)
  })

  it('reports a failed write without resending it', async () => {
    await service.get('vrchat')
    adapter.writeError = new RateLimitError(1000)
    expect(await write('friend:group_1', true)).toEqual({ ok: false, reason: 'rate-limited' })
    expect(adapter.writes).toHaveLength(1)
  })

  it('lists a world it just added, newest first', async () => {
    await service.get('vrchat')
    const result = await service.set({
      platform: 'vrchat',
      kind: 'world',
      id: WORLD,
      groupKey: 'world:worlds1',
      on: true,
      revision: revision(),
      world: evidence(WORLD)
    })
    expect(result).toEqual({ ok: true, groups: ['world:worlds1'] })
    const after = await service.get('vrchat')
    if (after.state !== 'ready') throw new Error('not ready')
    expect(after.view.worldEvidence.map((w) => w.worldId)).toEqual([WORLD])
    expect(after.view.groups.world[0]!.count).toBe(1)
  })
})
