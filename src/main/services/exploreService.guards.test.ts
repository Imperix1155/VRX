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
const cvrRoom = (n: number): string =>
  `i+000000000000${String(n).padStart(4, '0')}-000000-000000-00000000`
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
function defer<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise((done) => {
      resolve = done
    }),
    resolve
  }
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
    ReturnType<
      typeof defer<{
        world: Omit<ExploreWorld, 'worldRef'>
        roomIds: string[]
        roomsComplete: boolean
      } | null>
    >
  >()
  holdRoom = new Map<string, ReturnType<typeof defer<ExploreRoomEvidence | null>>>()
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
  vi.useRealTimers()
})

describe('ExploreService guard rails', () => {
  it('caps a sheet at one world refresh plus six rooms and reports incomplete coverage', async () => {
    const h = make()
    const entry = world(1)
    const ids = Array.from({ length: 101 }, (_, i) => `r${i}~public`)
    h.adapter.candidates = [entry]
    h.adapter.details.set(entry.worldId, { world: entry, roomIds: ids, roomsComplete: true })
    const [ref] = await candidate(h)
    await h.service.getWorld('vrchat', ref!, 'manual')
    await vi.waitFor(() => expect(h.adapter.worldPhysical + h.adapter.roomPhysical).toBe(7))
    expect(h.adapter.worldPhysical).toBe(1)
    expect(h.adapter.roomPhysical).toBe(6)
    expect((await h.service.getWorld('vrchat', ref!, 'snapshot'))!.roomsComplete).toBe(false)
  })

  it('replaces a selected world job without letting cancellation of A abort B', async () => {
    const h = make()
    const a = world(1)
    const b = world(2)
    h.adapter.candidates = [a, b]
    const held = defer<{
      world: Omit<ExploreWorld, 'worldRef'>
      roomIds: string[]
      roomsComplete: boolean
    } | null>()
    h.adapter.holdWorld.set(a.worldId, held)
    const [aRef, bRef] = await candidate(h)
    await h.service.getWorld('vrchat', aRef!, 'manual')
    await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(1))
    const aSignal = h.adapter.contexts.at(-1)!.signal
    h.adapter.details.set(b.worldId, { world: b, roomIds: [], roomsComplete: true })
    await h.service.getWorld('vrchat', bRef!, 'manual')
    await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(2))
    const bSignal = h.adapter.contexts.at(-1)!.signal
    h.service.cancelWorld('vrchat', aRef!)
    expect(aSignal.aborted).toBe(true)
    expect(bSignal.aborted).toBe(false)
    held.resolve(null)
    await waitReady(h.service)
  })

  it('captures one fresh lease per job and passes that identical lease to every operation in the job', async () => {
    const h = make()
    const entry = world(1)
    h.adapter.candidates = [entry]
    h.adapter.details.set(entry.worldId, {
      world: entry,
      roomIds: ['r~public'],
      roomsComplete: true
    })
    await candidate(h)
    expect(h.adapter.captures).toBe(1)
    expect(new Set(h.adapter.contexts.map((context) => context.lease)).size).toBe(1)
    const ref = (await h.service.getSnapshot('vrchat', 'snapshot')).worlds[0]!.worldRef
    h.now.value = 60_001
    await h.service.getWorld('vrchat', ref, 'manual')
    await vi.waitFor(async () =>
      expect((await h.service.getWorld('vrchat', ref, 'snapshot'))!.status).toBe('ready')
    )
    expect(h.adapter.captures).toBe(2)
    const sheetContexts = h.adapter.contexts.slice(1)
    expect(sheetContexts).toHaveLength(2)
    expect(new Set(sheetContexts.map((context) => context.lease)).size).toBe(1)
    expect(sheetContexts[0]!.lease).not.toBe(h.adapter.contexts[0]!.lease)
  })

  it('stops a successful CVR candidate batch before its detail tail when shared admission receives Retry-After: 0', async () => {
    const h = make('chilloutvr')
    const entry = world(1, null, 'chilloutvr')
    h.adapter.candidates = [entry]
    h.adapter.details.set(entry.worldId, {
      world: entry,
      roomIds: ['r~public'],
      roomsComplete: true
    })
    const original = h.adapter.getExploreCandidates.bind(h.adapter)
    h.adapter.getExploreCandidates = async (context) => {
      const result = await original(context)
      h.admission.rateLimited('0')
      return result
    }
    await h.service.getSnapshot('chilloutvr', 'manual')
    await waitReady(h.service, 'chilloutvr')
    expect(h.adapter.candidatePhysical).toBe(1)
    expect(h.adapter.worldPhysical).toBe(0)
    expect(h.adapter.roomPhysical).toBe(0)
    expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds).toEqual([])
  })

  async function sharedCvrRead(): Promise<{
    h: Harness
    ref: string
    detail: NonNullable<Awaited<ReturnType<Adapter['getExploreWorld']>>>
    room: ExploreRoomEvidence
    heldWorld: ReturnType<typeof defer<Awaited<ReturnType<Adapter['getExploreWorld']>>>>
    heldRoom: ReturnType<typeof defer<ExploreRoomEvidence | null>>
  }> {
    const h = make('chilloutvr')
    const entry = world(1, null, 'chilloutvr')
    const roomId = cvrRoom(1)
    const detail = { world: entry, roomIds: [roomId], roomsComplete: true }
    const room: ExploreRoomEvidence = {
      platform: 'chilloutvr',
      worldId: entry.worldId,
      roomId,
      access: 'public',
      region: null,
      groupName: null,
      occupancy: unknown(),
      capacity: null,
      full: false,
      joinEligibility: 'eligible'
    }
    h.adapter.candidates = [entry]
    h.adapter.details.set(entry.worldId, detail)
    h.adapter.rooms.set(`${entry.worldId}/${roomId}`, room)
    const [ref] = await candidate(h)
    h.now.value = 60_001
    const heldWorld = defer<Awaited<ReturnType<Adapter['getExploreWorld']>>>()
    const heldRoom = defer<ExploreRoomEvidence | null>()
    h.adapter.holdWorld.set(entry.worldId, heldWorld)
    h.adapter.holdRoom.set(`${entry.worldId}/${roomId}`, heldRoom)
    return { h, ref: ref!, detail, room, heldWorld, heldRoom }
  }

  it.each(['candidate', 'sheet'] as const)(
    'shares concurrent CVR world and room reads when the %s starts first',
    async (first) => {
      const { h, ref, detail, room, heldWorld, heldRoom } = await sharedCvrRead()
      try {
        const start = (kind: typeof first): Promise<unknown> =>
          kind === 'candidate'
            ? h.service.getSnapshot('chilloutvr', 'manual')
            : h.service.getWorld('chilloutvr', ref, 'open')
        await start(first)
        await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(2))
        const owner = h.adapter.contexts.at(-1)!
        await start(first === 'candidate' ? 'sheet' : 'candidate')
        await vi.waitFor(() => expect(h.adapter.candidatePhysical).toBe(2))
        // Flush pending continuations while the first world request remains held.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(h.adapter.worldPhysical).toBe(2)
        heldWorld.resolve(detail)
        await vi.waitFor(() => expect(h.adapter.roomPhysical).toBe(2))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(h.adapter.roomPhysical).toBe(2)
        expect(h.adapter.contexts.filter((context) => context.lease === owner.lease)).toHaveLength(
          first === 'candidate' ? 3 : 2
        )
        heldRoom.resolve(room)
        await waitReady(h.service, 'chilloutvr')
        await vi.waitFor(async () => {
          const sheet = await h.service.getWorld('chilloutvr', ref, 'snapshot')
          expect(sheet?.status).toBe('ready')
          expect(sheet?.roomsComplete).toBe(true)
          expect(sheet?.rooms[0]?.action.state).toBe('available')
        })
        expect(h.adapter.candidatePhysical + h.adapter.worldPhysical + h.adapter.roomPhysical).toBe(
          6
        )
      } finally {
        h.service.dispose()
      }
    }
  )

  it('cancels a following sheet without aborting the candidate-owned shared read', async () => {
    const { h, ref, detail, room, heldWorld, heldRoom } = await sharedCvrRead()
    try {
      await h.service.getSnapshot('chilloutvr', 'manual')
      await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(2))
      const ownerSignal = h.adapter.contexts.at(-1)!.signal
      await h.service.getWorld('chilloutvr', ref, 'open')
      h.service.cancelWorld('chilloutvr', ref)
      expect(ownerSignal.aborted).toBe(false)
      heldWorld.resolve(detail)
      await vi.waitFor(() => expect(h.adapter.roomPhysical).toBe(2))
      heldRoom.resolve(room)
      await waitReady(h.service, 'chilloutvr')
      expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).status).toBe('ready')
      expect(h.adapter.worldPhysical).toBe(2)
      expect(h.adapter.roomPhysical).toBe(2)
    } finally {
      h.service.dispose()
    }
  })

  it('keeps a candidate follower alive when the first sheet consumer is cancelled', async () => {
    const { h, ref, detail, room, heldWorld, heldRoom } = await sharedCvrRead()
    try {
      await h.service.getWorld('chilloutvr', ref, 'open')
      await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(2))
      await h.service.getSnapshot('chilloutvr', 'manual')
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      h.service.cancelWorld('chilloutvr', ref)
      heldWorld.resolve(detail)
      await vi.waitFor(() => expect(h.adapter.roomPhysical).toBe(2))
      heldRoom.resolve(room)
      await waitReady(h.service, 'chilloutvr')
      expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).status).toBe('ready')
      expect(h.adapter.worldPhysical).toBe(2)
      expect(h.adapter.roomPhysical).toBe(2)
    } finally {
      h.service.dispose()
    }
  })

  it.each(['hidden', 'deadline', 'rate-limit'] as const)(
    'ends shared reads without follow-up requests after %s',
    async (boundary) => {
      const { h, ref, detail, heldWorld } = await sharedCvrRead()
      try {
        await h.service.getSnapshot('chilloutvr', 'manual')
        await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(2))
        const sharedSignal = h.adapter.contexts.at(-1)!.signal
        await h.service.getWorld('chilloutvr', ref, 'open')
        if (boundary === 'hidden') h.service.setActive([])
        else if (boundary === 'deadline') h.now.value += 45_000
        else h.admission.rateLimited('0')
        if (boundary === 'hidden') expect(sharedSignal.aborted).toBe(true)
        heldWorld.resolve(detail)
        await waitReady(h.service, 'chilloutvr')
        await vi.waitFor(async () =>
          expect((await h.service.getWorld('chilloutvr', ref, 'snapshot'))?.status).not.toBe(
            'loading'
          )
        )
        expect(h.adapter.worldPhysical).toBe(2)
        expect(h.adapter.roomPhysical).toBe(1)
      } finally {
        h.service.dispose()
      }
    }
  )

  it('keeps the first read deadline when a later consumer is still within its own deadline', async () => {
    const { h, ref } = await sharedCvrRead()
    vi.useFakeTimers()
    try {
      await h.service.getWorld('chilloutvr', ref, 'open')
      await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(2))
      const sharedSignal = h.adapter.contexts.at(-1)!.signal
      await vi.advanceTimersByTimeAsync(10_000)
      h.now.value += 10_000
      await h.service.getSnapshot('chilloutvr', 'manual')
      await vi.waitFor(() => expect(h.adapter.candidatePhysical).toBe(2))
      await vi.advanceTimersByTimeAsync(35_000)
      h.now.value += 35_000
      expect(sharedSignal.aborted).toBe(true)
      await waitReady(h.service, 'chilloutvr')
      expect((await h.service.getSnapshot('chilloutvr', 'snapshot')).status).toBe('error')
      expect(h.adapter.worldPhysical).toBe(2)
      expect(h.adapter.roomPhysical).toBe(1)
    } finally {
      h.service.dispose()
    }
  })

  it('aborts all shared consumers when the original adapter lease expires', async () => {
    const { h, ref } = await sharedCvrRead()
    const controller = new AbortController()
    vi.spyOn(h.adapter, 'captureExploreLease').mockReturnValue({
      generation: 8,
      signal: controller.signal,
      isCurrent: () => !controller.signal.aborted
    })
    try {
      await h.service.getSnapshot('chilloutvr', 'manual')
      await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(2))
      const sharedSignal = h.adapter.contexts.at(-1)!.signal
      await h.service.getWorld('chilloutvr', ref, 'open')
      controller.abort()
      expect(sharedSignal.aborted).toBe(true)
      await waitReady(h.service, 'chilloutvr')
      expect(h.adapter.worldPhysical).toBe(2)
      expect(h.adapter.roomPhysical).toBe(1)
    } finally {
      h.service.dispose()
    }
  })

  it('does not share a pending world read with a replacement account', async () => {
    const { h, detail, heldWorld } = await sharedCvrRead()
    try {
      await h.service.getSnapshot('chilloutvr', 'manual')
      await vi.waitFor(() => expect(h.adapter.worldPhysical).toBe(2))
      h.account.setIdentity('chilloutvr', 'replacement')
      h.adapter.holdWorld.clear()
      h.adapter.holdRoom.clear()
      await h.service.getSnapshot('chilloutvr', 'manual')
      await waitReady(h.service, 'chilloutvr')
      expect(h.adapter.worldPhysical).toBe(3)
      expect(h.adapter.roomPhysical).toBe(2)
      const newRef = (await h.service.getSnapshot('chilloutvr', 'snapshot')).worlds[0]!.worldRef
      heldWorld.resolve({ ...detail, world: { ...detail.world, name: 'outgoing account' } })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect((await h.service.getWorld('chilloutvr', newRef, 'snapshot'))?.world.name).toBe('W1')
    } finally {
      h.service.dispose()
    }
  })

  it('discards an image that resolves after its account boundary', async () => {
    const h = make()
    const entry = world(1, 'https://files.vrchat.cloud/image.png')
    h.adapter.candidates = [entry]
    const pending = defer<string | null>()
    h.images.mockImplementation(() => pending.promise)
    const [ref] = await candidate(h)
    const first = h.service.getImage('vrchat', ref!)
    await vi.waitFor(() => expect(h.images).toHaveBeenCalledTimes(1))
    h.account.setIdentity('vrchat', 'next')
    pending.resolve('data:image/png;base64,a')
    await expect(first).resolves.toBeNull()
  })

  it('coalesces a pending visible image and reuses its successful URL cache without charging again', async () => {
    const h = make()
    const entry = world(1, 'https://files.vrchat.cloud/image.png')
    h.adapter.candidates = [entry]
    const pending = defer<string | null>()
    h.images.mockImplementation(() => pending.promise)
    const [ref] = await candidate(h)
    const first = h.service.getImage('vrchat', ref!)
    const second = h.service.getImage('vrchat', ref!)
    await vi.waitFor(() => expect(h.images).toHaveBeenCalledTimes(1))
    pending.resolve('data:image/png;base64,a')
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, dataUrl: 'data:image/png;base64,a' },
      { ok: true, dataUrl: 'data:image/png;base64,a' }
    ])
    await expect(h.service.getImage('vrchat', ref!)).resolves.toEqual({
      ok: true,
      dataUrl: 'data:image/png;base64,a'
    })
    expect(h.images).toHaveBeenCalledTimes(1)
  })

  it('renews a world reference after five minutes and rejects the expired reference', async () => {
    const h = make()
    h.adapter.candidates = [world(1)]
    const [oldRef] = await candidate(h)
    h.now.value = 300_001
    const renewed = (await h.service.getSnapshot('vrchat', 'snapshot')).worlds[0]!.worldRef
    expect(renewed).not.toBe(oldRef)
    await expect(h.service.getWorld('vrchat', oldRef!, 'snapshot')).resolves.toBeNull()
  })

  it('caps physical JSON starts at 20 across a CVR cold batch, incomplete sheets, and an account switch', async () => {
    const h = make('chilloutvr')
    const worlds = Array.from({ length: 6 }, (_, index) => world(index, null, 'chilloutvr'))
    h.adapter.candidates = worlds
    for (const [index, entry] of worlds.entries()) {
      const ids =
        index === 0
          ? Array.from({ length: 20 }, (_, value) => cvrRoom(value))
          : [cvrRoom(index + 40)]
      h.adapter.details.set(entry.worldId, { world: entry, roomIds: ids, roomsComplete: true })
      for (const roomId of ids)
        h.adapter.rooms.set(`${entry.worldId}/${roomId}`, {
          platform: 'chilloutvr',
          worldId: entry.worldId,
          roomId,
          access: 'public',
          region: null,
          groupName: null,
          occupancy: { state: 'complete', value: 1, source: 'cvr-room-current-player-count' },
          capacity: null,
          full: null,
          joinEligibility: 'eligible'
        })
    }
    const refs = await candidate(h)
    expect(h.adapter.candidatePhysical + h.adapter.worldPhysical + h.adapter.roomPhysical).toBe(13)
    await h.service.getWorld('chilloutvr', refs[0]!, 'open')
    await vi.waitFor(() => expect(h.adapter.roomPhysical).toBe(12))
    await h.service.getWorld('chilloutvr', refs[1]!, 'open')
    await h.service.getWorld('chilloutvr', refs[0]!, 'open')
    await vi.waitFor(() =>
      expect(h.adapter.candidatePhysical + h.adapter.worldPhysical + h.adapter.roomPhysical).toBe(
        20
      )
    )
    h.account.setIdentity('chilloutvr', 'next')
    await h.service.getSnapshot('chilloutvr', 'manual')
    await waitReady(h.service, 'chilloutvr')
    expect(h.adapter.candidatePhysical + h.adapter.worldPhysical + h.adapter.roomPhysical).toBe(20)
  })

  it('does not launch a stale VRC revalidation after settings turn joining off or the account changes', async () => {
    const setup = async (): Promise<{
      h: Harness
      ref: string
      selection: string
      held: ReturnType<typeof defer<ExploreRoomEvidence | null>>
    }> => {
      const h = make()
      const entry = world(1)
      const roomId = 'r~public'
      h.adapter.url = `vrchat://launch?ref=vrchat.com&id=${entry.worldId}:${roomId}`
      h.adapter.candidates = [entry]
      h.adapter.details.set(entry.worldId, { world: entry, roomIds: [roomId], roomsComplete: true })
      const evidence: ExploreRoomEvidence = {
        platform: 'vrchat',
        worldId: entry.worldId,
        roomId,
        access: 'public',
        region: null,
        groupName: null,
        occupancy: unknown(),
        capacity: null,
        full: false,
        joinEligibility: 'eligible'
      }
      h.adapter.rooms.set(`${entry.worldId}/${roomId}`, evidence)
      const [ref] = await candidate(h)
      await h.service.getWorld('vrchat', ref!, 'manual')
      await vi.waitFor(async () =>
        expect((await h.service.getWorld('vrchat', ref!, 'snapshot'))!.status).toBe('ready')
      )
      const action = (await h.service.getWorld('vrchat', ref!, 'snapshot'))!.rooms[0]!.action
      if (action.state !== 'available') throw new Error('expected selection')
      h.now.value = 60_001
      const held = defer<ExploreRoomEvidence | null>()
      h.adapter.holdRoom.set(`${entry.worldId}/${roomId}`, held)
      return { h, ref: ref!, selection: action.selectionRef, held }
    }
    const settings = await setup()
    const settingsJoin = settings.h.service.joinRoom('vrchat', settings.selection, 'desktop')
    await vi.waitFor(() => expect(settings.h.adapter.roomPhysical).toBe(2))
    settings.h.allowed.value = false
    settings.held.resolve(settings.h.adapter.rooms.values().next().value!)
    await expect(settingsJoin).resolves.toEqual({ ok: false, reason: 'joining-disabled' })
    expect(settings.h.launched).not.toHaveBeenCalled()
    const boundary = await setup()
    const boundaryJoin = boundary.h.service.joinRoom('vrchat', boundary.selection, 'desktop')
    await vi.waitFor(() => expect(boundary.h.adapter.roomPhysical).toBe(2))
    boundary.h.account.setIdentity('vrchat', 'next')
    boundary.held.resolve(boundary.h.adapter.rooms.values().next().value!)
    await expect(boundaryJoin).resolves.toEqual({ ok: false, reason: 'stale' })
    expect(boundary.h.launched).not.toHaveBeenCalled()
  })

  it('keeps two outstanding and six rolling image operations across an account boundary', async () => {
    const h = make()
    const entries = Array.from({ length: 7 }, (_, index) =>
      world(index, `https://files.vrchat.cloud/${index}.png`)
    )
    h.adapter.candidates = entries
    const pending = [defer<string | null>(), defer<string | null>()]
    h.images
      .mockImplementationOnce(() => pending[0]!.promise)
      .mockImplementationOnce(() => pending[1]!.promise)
    const refs = await candidate(h)
    const first = h.service.getImage('vrchat', refs[0]!)
    const second = h.service.getImage('vrchat', refs[1]!)
    await vi.waitFor(() => expect(h.images).toHaveBeenCalledTimes(2))
    h.account.setIdentity('vrchat', 'next')
    await h.service.getSnapshot('vrchat', 'manual')
    await waitReady(h.service)
    const newRefs = (await h.service.getSnapshot('vrchat', 'snapshot')).worlds.map(
      (entry) => entry.worldRef
    )
    await expect(h.service.getImage('vrchat', newRefs[2]!)).resolves.toBeNull()
    pending[0]!.resolve('data:image/png;base64,a')
    pending[1]!.resolve('data:image/png;base64,b')
    await Promise.all([first, second])
    for (let index = 2; index < 6; index++) {
      h.images.mockResolvedValueOnce(`data:image/png;base64,${index}`)
      await h.service.getImage('vrchat', newRefs[index]!)
    }
    expect(h.images).toHaveBeenCalledTimes(6)
    await expect(h.service.getImage('vrchat', newRefs[6]!)).resolves.toBeNull()
  })
})
