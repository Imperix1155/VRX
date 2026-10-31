import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExploreCount, ExploreWorld } from '@shared/explore'
import type { Platform } from '@shared/types'
import { AccountSession } from './accountSession'
import { ApiAdmissionController } from './adapters/ApiAdmissionController'
import type {
  ExploreAdapter,
  ExploreRequestContext,
  ExploreRoomEvidence
} from './adapters/ExploreAdapter'
import type { RequestLease } from './adapters/RequestLease'
import { JoinCoordinator } from './joinCoordinator'
import { ExploreService } from './exploreService'

const unknown = (): ExploreCount => ({ state: 'unknown', value: null, source: 'unknown' })
const id = (n: number): string => `wrld_00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const cvrId = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const world = (
  n: number,
  thumbnailUrl: string | null = null,
  platform: Platform = 'vrchat'
): Omit<ExploreWorld, 'worldRef'> => ({
  platform,
  worldId: platform === 'vrchat' ? id(n) : cvrId(n),
  name: `W${n}`,
  thumbnailUrl,
  activity: unknown(),
  visibleRoomCount: unknown(),
  popularity: null,
  sourceOrder: n
})
interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

class Adapter implements ExploreAdapter {
  candidates: Omit<ExploreWorld, 'worldRef'>[] = []
  details = new Map<
    string,
    { world: Omit<ExploreWorld, 'worldRef'>; roomIds: string[]; roomsComplete: boolean }
  >()
  rooms = new Map<string, ExploreRoomEvidence | null>()
  contexts: ExploreRequestContext[] = []
  candidatePhysical = 0
  worldPhysical = 0
  roomPhysical = 0
  captures = 0
  holdWorld = new Map<
    string,
    Deferred<{
      world: Omit<ExploreWorld, 'worldRef'>
      roomIds: string[]
      roomsComplete: boolean
    } | null>
  >()
  holdRoom = new Map<string, Deferred<ExploreRoomEvidence | null>>()
  url: string | null = null
  constructor(readonly platform: Platform = 'vrchat') {}
  captureExploreLease(): RequestLease {
    this.captures++
    const controller = new AbortController()
    return { generation: this.captures, signal: controller.signal, isCurrent: () => true }
  }
  async getExploreCandidates(
    context: ExploreRequestContext
  ): Promise<Omit<ExploreWorld, 'worldRef'>[]> {
    this.contexts.push(context)
    context.beforeDispatch()
    this.candidatePhysical++
    return this.candidates
  }
  async getExploreWorld(
    worldId: string,
    context: ExploreRequestContext
  ): Promise<{
    world: Omit<ExploreWorld, 'worldRef'>
    roomIds: string[]
    roomsComplete: boolean
  } | null> {
    this.contexts.push(context)
    context.beforeDispatch()
    this.worldPhysical++
    return this.holdWorld.get(worldId)?.promise ?? this.details.get(worldId) ?? null
  }
  async getExploreRoom(
    target: { worldId: string; instanceId: string },
    context: ExploreRequestContext
  ): Promise<ExploreRoomEvidence | null> {
    this.contexts.push(context)
    context.beforeDispatch()
    this.roomPhysical++
    return (
      this.holdRoom.get(`${target.worldId}/${target.instanceId}`)?.promise ??
      this.rooms.get(`${target.worldId}/${target.instanceId}`) ??
      null
    )
  }
  buildJoinUrl(): string | null {
    return this.url
  }
}
interface Harness {
  platform: Platform
  now: { value: number }
  account: AccountSession
  adapter: Adapter
  admission: ApiAdmissionController
  images: ReturnType<typeof vi.fn>
  launched: ReturnType<typeof vi.fn>
  allowed: { value: boolean }
  service: ExploreService
}
function make(platform: Platform = 'vrchat'): Harness {
  const now = { value: 0 }
  const account = new AccountSession()
  account.setIdentity(platform, 'account')
  const adapter = new Adapter(platform)
  const admission = new ApiAdmissionController({
    now: () => now.value,
    minimumIntervalMs: 0,
    random: () => 0
  })
  const images = vi.fn(async () => null)
  const launched = vi.fn(async () => undefined)
  const allowed = { value: true }
  const service = new ExploreService({
    adapters: new Map([[platform, adapter]]),
    accountSession: account,
    admissions: new Map([[platform, admission]]),
    joinCoordinator: new JoinCoordinator(() => now.value),
    isJoinAllowed: () => allowed.value,
    getImage: images,
    openExternal: launched,
    onChanged: vi.fn(),
    clock: () => now.value,
    wallClock: () => now.value
  })
  service.setActive([platform])
  return { platform, now, account, adapter, admission, images, launched, allowed, service }
}
async function waitReady(service: ExploreService, platform: Platform = 'vrchat'): Promise<void> {
  await vi.waitFor(async () =>
    expect((await service.getSnapshot(platform, 'snapshot')).status).not.toBe('loading')
  )
}
async function candidate(h: ReturnType<typeof make>): Promise<string[]> {
  await h.service.getSnapshot(h.platform, 'manual')
  await waitReady(h.service, h.platform)
  return (await h.service.getSnapshot(h.platform, 'snapshot')).worlds.map((entry) => entry.worldRef)
}
afterEach(() => {
  vi.restoreAllMocks()
})

describe('ExploreService adopted worlds', () => {
  it('issues references for search and list worlds without any request', async () => {
    const h = make()
    const [a, b] = h.service.adoptWorlds('vrchat', [world(1), world(2), world(1)])
    expect([a?.worldId, b?.worldId]).toEqual([id(1), id(2)])
    expect(a?.worldRef).toMatch(/^[0-9a-f-]{36}$/)
    expect(h.adapter.candidatePhysical + h.adapter.worldPhysical).toBe(0)
    // The same world keeps its reference when adopted again.
    expect(h.service.adoptWorlds('vrchat', [world(1)])[0]?.worldRef).toBe(a?.worldRef)
    // A world named for another platform is ignored.
    expect(h.service.adoptWorlds('vrchat', [world(3, null, 'chilloutvr')])).toEqual([])
  })

  it('opens an adopted world in the same sheet, and keeps it through a candidate refresh', async () => {
    const h = make()
    const entry = world(5)
    h.adapter.details.set(entry.worldId, {
      world: entry,
      roomIds: ['r~public'],
      roomsComplete: true
    })
    const [adopted] = h.service.adoptWorlds('vrchat', [entry])
    const ref = adopted!.worldRef
    await h.service.getWorld('vrchat', ref, 'open')
    await vi.waitFor(async () =>
      expect((await h.service.getWorld('vrchat', ref, 'snapshot'))!.status).toBe('ready')
    )
    expect(h.adapter.worldPhysical).toBe(1)
    h.adapter.candidates = [world(9)]
    await candidate(h)
    expect(await h.service.getWorld('vrchat', ref, 'snapshot')).not.toBeNull()
  })

  it('moves an adopted world into the candidates without changing its reference', async () => {
    const h = make()
    const entry = world(4)
    const ref = h.service.adoptWorlds('vrchat', [entry])[0]!.worldRef
    h.adapter.candidates = [entry]
    expect(await candidate(h)).toEqual([ref])
  })

  it('stays bounded, forgets at an account boundary, and adopts nothing without a session', async () => {
    const h = make()
    const many = Array.from({ length: 70 }, (_, n) => world(100 + n))
    const first = h.service.adoptWorlds('vrchat', many.slice(0, 40))[0]!.worldRef
    h.service.adoptWorlds('vrchat', many.slice(40))
    // 60 kept: the oldest uses went first.
    expect(await h.service.getWorld('vrchat', first, 'snapshot')).toBeNull()
    const kept = h.service.adoptWorlds('vrchat', [many[69]!])[0]!.worldRef
    h.service.clearPlatform('vrchat')
    expect(await h.service.getWorld('vrchat', kept, 'snapshot')).toBeNull()
    h.account.setIdentity('vrchat', null)
    expect(h.service.adoptWorlds('vrchat', [world(1)])).toEqual([])
  })
})
