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
import { RateLimitError } from './adapters/errors'
import { JoinCoordinator } from './joinCoordinator'
import { ExploreService } from './exploreService'

const countUnknown = (): ExploreCount => ({ state: 'unknown', value: null, source: 'unknown' })
const worldId = (index: number): string =>
  `wrld_00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
const cvrWorldId = (index: number): string =>
  `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
const cvrRoomId = (index: number): string =>
  `i+000000000000${String(index).padStart(4, '0')}-000000-000000-00000000`

function vrcWorld(index: number): Omit<ExploreWorld, 'worldRef'> {
  return {
    platform: 'vrchat',
    worldId: worldId(index),
    name: `world ${index}`,
    thumbnailUrl: null,
    activity: countUnknown(),
    visibleRoomCount: countUnknown(),
    popularity: null,
    sourceOrder: index
  }
}
function cvrWorld(index: number): Omit<ExploreWorld, 'worldRef'> {
  return {
    platform: 'chilloutvr',
    worldId: cvrWorldId(index),
    name: `world ${index}`,
    thumbnailUrl: null,
    activity: countUnknown(),
    visibleRoomCount: countUnknown(),
    popularity: null,
    sourceOrder: index
  }
}
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  return {
    promise: new Promise<T>((done, fail) => {
      resolve = done
      reject = fail
    }),
    resolve,
    reject
  }
}

class FakeExploreAdapter implements ExploreAdapter {
  readonly contexts: ExploreRequestContext[] = []
  readonly physical = { candidates: 0, worlds: 0, rooms: 0 }
  candidates: Omit<ExploreWorld, 'worldRef'>[] = []
  readonly details = new Map<
    string,
    { world: Omit<ExploreWorld, 'worldRef'>; roomIds: string[]; roomsComplete: boolean }
  >()
  readonly rooms = new Map<string, ExploreRoomEvidence | null>()
  nextCandidate: Promise<Omit<ExploreWorld, 'worldRef'>[]> | null = null
  nextWorld: Promise<{
    world: Omit<ExploreWorld, 'worldRef'>
    roomIds: string[]
    roomsComplete: boolean
  } | null> | null = null
  nextRoom: Promise<ExploreRoomEvidence | null> | null = null
  readonly lease = { generation: 9, signal: new AbortController().signal, isCurrent: () => true }

  constructor(readonly platform: Platform) {}
  captureExploreLease(): typeof this.lease {
    return this.lease
  }
  async getExploreCandidates(
    context: ExploreRequestContext
  ): Promise<Omit<ExploreWorld, 'worldRef'>[]> {
    this.contexts.push(context)
    context.beforeDispatch()
    this.physical.candidates++
    if (this.nextCandidate) return this.nextCandidate
    return this.candidates
  }
  async getExploreWorld(
    world: string,
    context: ExploreRequestContext
  ): Promise<{
    world: Omit<ExploreWorld, 'worldRef'>
    roomIds: string[]
    roomsComplete: boolean
  } | null> {
    this.contexts.push(context)
    context.beforeDispatch()
    this.physical.worlds++
    if (this.nextWorld) return this.nextWorld
    return this.details.get(world) ?? null
  }
  async getExploreRoom(
    target: { worldId: string; instanceId: string },
    context: ExploreRequestContext
  ): Promise<ExploreRoomEvidence | null> {
    this.contexts.push(context)
    context.beforeDispatch()
    this.physical.rooms++
    if (this.nextRoom) return this.nextRoom
    const found = this.rooms.get(`${target.worldId}/${target.instanceId}`)
    return found === undefined ? null : found
  }
  buildJoinUrl(): string | null {
    return 'vrchat://launch?ref=vrchat.com&id=wrld_00000000-0000-0000-0000-000000000000:1~public'
  }
}

interface Harness {
  now: { value: number }
  account: AccountSession
  adapters: Map<Platform, FakeExploreAdapter>
  admissions: Map<Platform, ApiAdmissionController>
  changed: ReturnType<typeof vi.fn>
  images: ReturnType<typeof vi.fn>
  launched: ReturnType<typeof vi.fn>
  joins: { allowed: boolean }
  service: ExploreService
}
function harness(platform: Platform = 'vrchat'): Harness {
  const now = { value: 0 }
  const account = new AccountSession()
  account.setIdentity(platform, 'account')
  const adapter = new FakeExploreAdapter(platform)
  const adapters = new Map<Platform, FakeExploreAdapter>([[platform, adapter]])
  const admissions = new Map<Platform, ApiAdmissionController>([
    [
      platform,
      new ApiAdmissionController({ now: () => now.value, minimumIntervalMs: 0, random: () => 0 })
    ]
  ])
  const changed = vi.fn()
  const images = vi.fn(async () => null)
  const launched = vi.fn(async () => undefined)
  const joins = { allowed: true }
  const service = new ExploreService({
    adapters,
    accountSession: account,
    admissions,
    joinCoordinator: new JoinCoordinator(() => now.value),
    isJoinAllowed: () => joins.allowed,
    getImage: images,
    openExternal: launched,
    onChanged: changed,
    clock: () => now.value,
    wallClock: () => now.value
  })
  service.setActive([platform])
  return { now, account, adapters, admissions, changed, images, launched, joins, service }
}
async function settled(): Promise<void> {
  await vi.waitFor(() => undefined)
}
async function load(h: Harness, platform: Platform): Promise<void> {
  await h.service.getSnapshot(platform, 'manual')
  await vi.waitFor(async () =>
    expect((await h.service.getSnapshot(platform, 'snapshot')).status).not.toBe('loading')
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ExploreService integration bounds', () => {
  it('does no I/O for snapshot reads and coalesces 1,000 duplicate manual triggers', async () => {
    const h = harness()
    h.adapters.get('vrchat')!.candidates = [vrcWorld(1)]
    await h.service.getSnapshot('vrchat', 'snapshot')
    expect(h.adapters.get('vrchat')!.physical.candidates).toBe(0)
    await Promise.all(Array.from({ length: 1000 }, () => h.service.getSnapshot('vrchat', 'manual')))
    await vi.waitFor(() => expect(h.adapters.get('vrchat')!.physical.candidates).toBe(1))
    expect((await h.service.getSnapshot('vrchat', 'snapshot')).worlds).toHaveLength(1)
  })

  it('enforces explicit 60-second and automatic 5-minute candidate eligibility without timers', async () => {
    const h = harness()
    h.adapters.get('vrchat')!.candidates = [vrcWorld(1)]
    await load(h, 'vrchat')
    h.now.value = 59_999
    await h.service.getSnapshot('vrchat', 'manual')
    await settled()
    expect(h.adapters.get('vrchat')!.physical.candidates).toBe(1)
    h.now.value = 60_000
    await load(h, 'vrchat')
    expect(h.adapters.get('vrchat')!.physical.candidates).toBe(2)
    h.now.value = 299_999
    await h.service.getSnapshot('vrchat', 'automatic')
    await settled()
    expect(h.adapters.get('vrchat')!.physical.candidates).toBe(2)
    h.now.value = 360_000
    await h.service.getSnapshot('vrchat', 'automatic')
    await vi.waitFor(() => expect(h.adapters.get('vrchat')!.physical.candidates).toBe(3))
  })

  it('uses the original adapter lease for every bounded CVR cold-batch request and caps cold dispatch at 13', async () => {
    const h = harness('chilloutvr')
    const adapter = h.adapters.get('chilloutvr')!
    adapter.candidates = Array.from({ length: 12 }, (_, index) => cvrWorld(index))
    for (let index = 0; index < 6; index++) {
      const world = cvrWorld(index)
      const roomId = cvrRoomId(index)
      adapter.details.set(world.worldId, { world, roomIds: [roomId], roomsComplete: true })
      adapter.rooms.set(`${world.worldId}/${roomId}`, {
        platform: 'chilloutvr',
        worldId: world.worldId,
        roomId,
        access: 'public',
        region: null,
        groupName: null,
        occupancy: { state: 'complete', value: 1, source: 'cvr-room-current-player-count' },
        capacity: 1,
        full: true,
        joinEligibility: 'eligible'
      })
    }
    await load(h, 'chilloutvr')
    await vi.waitFor(() =>
      expect(adapter.physical.candidates + adapter.physical.worlds + adapter.physical.rooms).toBe(
        13
      )
    )
    expect(adapter.contexts).toHaveLength(13)
    expect(adapter.contexts.every((context) => context.lease === adapter.lease)).toBe(true)
    expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds).toHaveLength(6)
  })

  it('publishes only CVR worlds with actual qualifying room evidence and does not fabricate complete counts', async () => {
    const h = harness('chilloutvr')
    const adapter = h.adapters.get('chilloutvr')!
    const world = cvrWorld(1)
    const roomId = cvrRoomId(1)
    adapter.candidates = [world]
    adapter.details.set(world.worldId, { world, roomIds: [roomId], roomsComplete: false })
    adapter.rooms.set(`${world.worldId}/${roomId}`, null)
    await load(h, 'chilloutvr')
    expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds).toEqual([])
    adapter.rooms.set(`${world.worldId}/${roomId}`, {
      platform: 'chilloutvr',
      worldId: world.worldId,
      roomId,
      access: 'group-public',
      region: null,
      groupName: null,
      occupancy: countUnknown(),
      capacity: null,
      full: null,
      joinEligibility: 'eligible'
    })
    h.now.value = 60_001
    await load(h, 'chilloutvr')
    await vi.waitFor(async () =>
      expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds).toHaveLength(1)
    )
    const published = (await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds[0]!
    expect(published.activity).toEqual({
      state: 'partial',
      value: null,
      source: 'cvr-public-rooms'
    })
    expect(published.visibleRoomCount.state).not.toBe('complete')
  })

  it('does not publish an old-account result that resolves after a session boundary', async () => {
    const h = harness()
    const adapter = h.adapters.get('vrchat')!
    const held = deferred<Omit<ExploreWorld, 'worldRef'>[]>()
    adapter.nextCandidate = held.promise
    await h.service.getSnapshot('vrchat', 'manual')
    await vi.waitFor(() => expect(adapter.physical.candidates).toBe(1))
    h.account.setIdentity('vrchat', 'next')
    held.resolve([vrcWorld(7)])
    await settled()
    expect((await h.service.getSnapshot('vrchat', 'snapshot')).worlds).toEqual([])
  })

  it('aborts a candidate operation still pending at its 45-second deadline and ignores late output', async () => {
    vi.useFakeTimers()
    const h = harness()
    const adapter = h.adapters.get('vrchat')!
    const held = deferred<Omit<ExploreWorld, 'worldRef'>[]>()
    adapter.nextCandidate = held.promise
    await h.service.getSnapshot('vrchat', 'manual')
    await vi.waitFor(() => expect(adapter.contexts).toHaveLength(1))
    h.now.value = 45_001
    await vi.advanceTimersByTimeAsync(45_001)
    expect(adapter.contexts[0]!.signal.aborted).toBe(true)
    held.resolve([vrcWorld(99)])
    await vi.runAllTimersAsync()
    expect((await h.service.getSnapshot('vrchat', 'snapshot')).worlds).toEqual([])
  })

  it('treats a zero-delay shared 429 as a batch stop and starts no detail tail', async () => {
    const h = harness('chilloutvr')
    const adapter = h.adapters.get('chilloutvr')!
    adapter.candidates = [cvrWorld(1)]
    adapter.nextCandidate = Promise.reject(new RateLimitError(0))
    await h.service.getSnapshot('chilloutvr', 'manual')
    await vi.waitFor(() => expect(adapter.physical.candidates).toBe(1))
    await settled()
    expect(adapter.physical.worlds).toBe(0)
    expect(adapter.physical.rooms).toBe(0)
    await vi.waitFor(async () =>
      expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).status).toBe('error')
    )
  })

  it('joins a fresh VRC selection without an extra revalidation fetch', async () => {
    const h = harness()
    const adapter = h.adapters.get('vrchat')!
    const world = vrcWorld(0)
    const roomId = '1~public'
    adapter.candidates = [world]
    adapter.details.set(world.worldId, { world, roomIds: [roomId], roomsComplete: true })
    adapter.rooms.set(`${world.worldId}/${roomId}`, {
      platform: 'vrchat',
      worldId: world.worldId,
      roomId,
      access: 'public',
      region: null,
      groupName: null,
      occupancy: { state: 'complete', value: 1, source: 'vrc-room-n-users' },
      capacity: 16,
      full: false,
      joinEligibility: 'eligible'
    })
    await load(h, 'vrchat')
    const ref = (await h.service.getSnapshot('vrchat', 'snapshot')).worlds[0]!.worldRef
    await h.service.getWorld('vrchat', ref, 'manual')
    await vi.waitFor(() => expect(adapter.physical.rooms).toBe(1))
    const room = (await h.service.getWorld('vrchat', ref, 'snapshot'))!.rooms[0]!
    expect(room.action.state).toBe('available')
    if (room.action.state !== 'available') throw new Error('fresh room should be actionable')
    await expect(
      h.service.joinRoom('vrchat', room.action.selectionRef, 'desktop')
    ).resolves.toEqual({ ok: true })
    expect(adapter.physical.rooms).toBe(1)
    expect(h.launched).toHaveBeenCalledTimes(1)
  })

  it('rejects forged and prior-account opaque world references without I/O', async () => {
    const h = harness()
    const adapter = h.adapters.get('vrchat')!
    adapter.candidates = [vrcWorld(1)]
    await load(h, 'vrchat')
    const ref = (await h.service.getSnapshot('vrchat', 'snapshot')).worlds[0]!.worldRef
    await expect(h.service.getWorld('vrchat', 'forged', 'open')).resolves.toBeNull()
    expect(adapter.physical.worlds).toBe(0)
    h.account.setIdentity('vrchat', 'next')
    await expect(h.service.getWorld('vrchat', ref, 'open')).resolves.toBeNull()
    expect(adapter.physical.worlds).toBe(0)
  })

  it('retains a renewed world reference when an older staged candidate refresh commits', async () => {
    const h = harness('chilloutvr')
    const adapter = h.adapters.get('chilloutvr')!
    const world = cvrWorld(1)
    const roomId = cvrRoomId(1)
    const detail = { world, roomIds: [roomId], roomsComplete: true }
    adapter.candidates = [world]
    adapter.details.set(world.worldId, detail)
    adapter.rooms.set(`${world.worldId}/${roomId}`, {
      platform: 'chilloutvr',
      worldId: world.worldId,
      roomId,
      access: 'public',
      region: null,
      groupName: null,
      occupancy: countUnknown(),
      capacity: null,
      full: null,
      joinEligibility: 'eligible'
    })
    await load(h, 'chilloutvr')
    const original = (await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds[0]!.worldRef
    const held = deferred<typeof detail | null>()
    adapter.nextWorld = held.promise
    h.now.value = 299_999
    await h.service.getSnapshot('chilloutvr', 'manual')
    await vi.waitFor(() => expect(adapter.physical.worlds).toBe(2))
    h.now.value = 300_001
    const renewed = (await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds[0]!.worldRef
    expect(renewed).not.toBe(original)
    held.resolve(detail)
    await vi.waitFor(async () =>
      expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).status).toBe('ready')
    )
    expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds[0]!.worldRef).toBe(
      renewed
    )
    await expect(h.service.getWorld('chilloutvr', renewed, 'snapshot')).resolves.not.toBeNull()
    await expect(h.service.getWorld('chilloutvr', original, 'snapshot')).resolves.toBeNull()
  })

  it('cancels work attached to an expired sheet reference before publishing its replacement', async () => {
    const h = harness()
    const adapter = h.adapters.get('vrchat')!
    const world = vrcWorld(1)
    adapter.candidates = [world]
    await load(h, 'vrchat')
    const original = (await h.service.getSnapshot('vrchat', 'snapshot')).worlds[0]!.worldRef
    const detail = { world, roomIds: ['1~public'], roomsComplete: true }
    const held = deferred<typeof detail | null>()
    adapter.nextWorld = held.promise
    h.now.value = 299_999
    await h.service.getWorld('vrchat', original, 'open')
    await vi.waitFor(() => expect(adapter.physical.worlds).toBe(1))
    h.now.value = 300_001
    const renewed = (await h.service.getSnapshot('vrchat', 'snapshot')).worlds[0]!.worldRef
    expect(renewed).not.toBe(original)
    expect(adapter.contexts.at(-1)!.signal.aborted).toBe(true)
    held.resolve(detail)
    await vi.waitFor(async () =>
      expect((await h.service.getWorld('vrchat', renewed, 'snapshot'))!.status).not.toBe('loading')
    )
    expect(adapter.physical.rooms).toBe(0)
  })

  it('does not request inactive/offscreen images and limits visible image work to two outstanding operations', async () => {
    const h = harness()
    const adapter = h.adapters.get('vrchat')!
    const imageA = deferred<string | null>()
    const imageB = deferred<string | null>()
    adapter.candidates = [
      { ...vrcWorld(1), thumbnailUrl: 'https://files.vrchat.cloud/a.png' },
      { ...vrcWorld(2), thumbnailUrl: 'https://files.vrchat.cloud/b.png' },
      { ...vrcWorld(3), thumbnailUrl: 'https://files.vrchat.cloud/c.png' }
    ]
    h.images
      .mockImplementationOnce(() => imageA.promise)
      .mockImplementationOnce(() => imageB.promise)
    await load(h, 'vrchat')
    const worlds = (await h.service.getSnapshot('vrchat', 'snapshot')).worlds
    h.service.setActive([])
    await h.service.getImage('vrchat', worlds[0]!.worldRef)
    expect(h.images).not.toHaveBeenCalled()
    h.service.setActive(['vrchat'])
    void h.service.getImage('vrchat', worlds[0]!.worldRef)
    void h.service.getImage('vrchat', worlds[1]!.worldRef)
    await vi.waitFor(() => expect(h.images).toHaveBeenCalledTimes(2))
    await expect(h.service.getImage('vrchat', worlds[2]!.worldRef)).resolves.toBeNull()
    imageA.resolve('data:image/png;base64,a')
    imageB.resolve('data:image/png;base64,b')
  })
})
