import { randomUUID } from 'node:crypto'
import type {
  ExplorePlatformSnapshot,
  ExploreRefreshReason,
  ExploreRoom,
  ExploreWorld,
  ExploreWorldReason,
  ExploreWorldSnapshot
} from '@shared/explore'
import type { InstanceActionResult } from '@shared/ipc'
import type { InstanceInfo, JoinMode, Platform } from '@shared/types'
import { hotInstanceKey } from '@shared/hotInstanceKey'
import { aggregateCvrExploreQualifiedRooms } from './adapters/cvr/parseExplore'
import type { ApiAdmissionController } from './adapters/ApiAdmissionController'
import type { IPlatformAdapter } from './adapters/IPlatformAdapter'
import {
  AuthError,
  RateLimitError,
  RequestCancelledError,
  RequestQueueFullError
} from './adapters/errors'
import type {
  ExploreAdapter,
  ExploreRequestContext,
  ExploreRoomEvidence,
  ExploreWorldEvidence
} from './adapters/ExploreAdapter'
import { ExploreDataError } from './adapters/ExploreAdapter'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'
import type { AccountSession, ResolvedAccountSession } from './accountSession'
import type { JoinCoordinator } from './joinCoordinator'
import { isAllowedLaunchUrl } from '../ipc/url-allowlist'

const FRESH_MS = 60_000
const RETAIN_MS = 300_000
const DEADLINE_MS = 45_000
const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']
type MainAdapter = ExploreAdapter & Pick<IPlatformAdapter, 'buildJoinUrl'>
type LoadStatus = ExplorePlatformSnapshot['status']
type Problem = ExplorePlatformSnapshot['problem']

interface RoomRecord {
  evidence: ExploreRoomEvidence | null
  checkedAt: number
  selectionRef: string | null
}
interface Detail {
  ids: string[]
  enumerationComplete: boolean
  rooms: Map<string, RoomRecord>
  fetchedAt: number
  updatedAt: number
}
interface WorldRecord {
  evidence: ExploreWorldEvidence
  ref: string
  refExpiresAt: number
  generation: number
  detail: Detail | null
  status: LoadStatus
  problem: Problem
  lastUsedAt: number
  lastAttemptAt: number | null
}
interface Selection {
  world: WorldRecord
  roomId: string
  generation: number
  expiresAt: number
}
interface State {
  session: ResolvedAccountSession | null
  worlds: Map<string, WorldRecord>
  candidateIds: string[]
  selections: Map<string, Selection>
  images: Map<string, string>
  imagePending: Map<string, Promise<string | null>>
  status: LoadStatus
  problem: Problem
  refreshedAt: number | null
  updatedAt: number | null
  candidateAttemptAt: number | null
  candidateJob: Job | null
  worldJob: Job | null
  selectedRef: string | null
}
interface Job {
  platform: Platform
  state: State
  session: ResolvedAccountSession
  lease: RequestLease
  controller: AbortController
  signal: AbortSignal
  revision: number
  deadline: number
  timedOut: boolean
  timer: ReturnType<typeof setTimeout>
  worldRef?: string
  attempts: number
  maxAttempts: number
}
export interface ExploreServiceOptions {
  adapters: ReadonlyMap<Platform, MainAdapter>
  accountSession: Pick<AccountSession, 'resolve'>
  admissions: ReadonlyMap<Platform, ApiAdmissionController>
  joinCoordinator: JoinCoordinator
  isJoinAllowed: () => boolean
  getImage: (url: string) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  onChanged: (platform: Platform) => void
  clock?: () => number
  wallClock?: () => number
}

/** Account-owned discovery caches with event-driven loads and bounded physical attempts. */
export class ExploreService {
  private readonly clock: () => number
  private readonly wallClock: () => number
  private readonly active = new Set<Platform>()
  private readonly states = new Map<Platform, State>()
  // Process-lifetime ledgers survive account changes. They never schedule work.
  private readonly jsonStarts = new Map<Platform, number[]>()
  private readonly imageStarts = new Map<Platform, number[]>()
  private readonly imageOutstanding = new Map<Platform, number>()
  private readonly joinJobs = new Set<Job>()
  private disposed = false

  constructor(private readonly options: ExploreServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.wallClock = options.wallClock ?? Date.now
  }

  setActive(platforms: readonly Platform[]): void {
    const next = new Set(platforms)
    for (const platform of this.active) {
      if (!next.has(platform)) {
        const state = this.states.get(platform)
        if (state) {
          this.cancelJob(state.candidateJob)
          this.cancelJob(state.worldJob)
          state.candidateJob = null
          state.worldJob = null
          state.selectedRef = null
          this.publish(platform)
        }
      }
    }
    this.active.clear()
    if (!this.disposed) for (const platform of next) this.active.add(platform)
  }

  getSnapshot(platform: Platform, reason: ExploreRefreshReason): Promise<ExplorePlatformSnapshot> {
    const state = this.state(platform)
    this.expireDetails(state)
    if (reason !== 'snapshot') this.startCandidates(platform, state, reason)
    return Promise.resolve(this.snapshot(platform, state))
  }

  getWorld(
    platform: Platform,
    worldRef: string,
    reason: ExploreWorldReason
  ): Promise<ExploreWorldSnapshot | null> {
    const state = this.state(platform)
    this.expireDetails(state)
    const world = this.findWorld(state, worldRef)
    if (!world) return Promise.resolve(null)
    world.lastUsedAt = this.clock()
    if (reason !== 'snapshot') this.startWorld(platform, state, world, reason)
    return Promise.resolve(this.worldSnapshot(platform, state, world))
  }

  cancelWorld(platform: Platform, worldRef: string): void {
    const state = this.state(platform)
    if (state.selectedRef !== worldRef) return
    state.selectedRef = null
    if (state.worldJob?.worldRef === worldRef) {
      this.cancelJob(state.worldJob)
      state.worldJob = null
      this.publish(platform)
    }
  }

  async getImage(
    platform: Platform,
    worldRef: string
  ): Promise<{ ok: true; dataUrl: string } | null> {
    const state = this.state(platform)
    const world = this.findWorld(state, worldRef)
    if (this.disposed || !this.active.has(platform) || !world || !state.session) return null
    const url = this.imageUrl(world.evidence.thumbnailUrl)
    if (!url) return null
    const cached = state.images.get(url)
    if (cached) return { ok: true, dataUrl: cached }
    let pending = state.imagePending.get(url)
    if (!pending) {
      if ((this.imageOutstanding.get(platform) ?? 0) >= 2) return null
      if (!this.take(this.imageStarts, platform, 6)) return null
      this.imageOutstanding.set(platform, (this.imageOutstanding.get(platform) ?? 0) + 1)
      pending = Promise.resolve()
        .then(() => this.options.getImage(url))
        .catch(() => null)
      state.imagePending.set(url, pending)
      const owned = pending
      void pending.then(() => {
        this.imageOutstanding.set(platform, (this.imageOutstanding.get(platform) ?? 1) - 1)
        if (state.imagePending.get(url) === owned) state.imagePending.delete(url)
      })
    }
    const dataUrl = await pending
    if (!dataUrl || !this.current(platform, state) || !this.findWorld(state, worldRef)) return null
    state.images.delete(url)
    state.images.set(url, dataUrl)
    while (state.images.size > 12) state.images.delete(state.images.keys().next().value!)
    return { ok: true, dataUrl }
  }

  async joinRoom(
    platform: Platform,
    selectionRef: string,
    mode: JoinMode
  ): Promise<InstanceActionResult> {
    if (!this.options.isJoinAllowed()) return { ok: false, reason: 'joining-disabled' }
    const state = this.state(platform)
    const selection = this.findSelection(state, selectionRef)
    if (this.disposed || !selection || !state.session) return { ok: false, reason: 'stale' }
    const { world, roomId } = selection
    const room = world.detail?.rooms.get(roomId)
    if (!room?.evidence || room.evidence.joinEligibility !== 'eligible')
      return { ok: false, reason: 'not-joinable' }
    const key = hotInstanceKey(platform, roomId, world.evidence.worldId)
    if (!key) return { ok: false, reason: 'stale' }
    const permit = this.options.joinCoordinator.acquire(platform, key)
    if (!permit) return { ok: false, reason: 'cooldown' }
    let job: Job | null = null
    try {
      let evidence = room.evidence
      if (!this.fresh(room.checkedAt)) {
        if (platform === 'chilloutvr') return { ok: false, reason: 'stale' }
        job = this.newJob(platform, state, 1)
        this.joinJobs.add(job)
        evidence =
          (await this.request(job, 'interactive', (adapter, context) =>
            adapter.getExploreRoom({ worldId: world.evidence.worldId, instanceId: roomId }, context)
          )) ?? evidenceWithDenial(evidence)
        if (evidence.joinEligibility !== 'eligible') return { ok: false, reason: 'not-joinable' }
      }
      if (!this.options.isJoinAllowed()) return { ok: false, reason: 'joining-disabled' }
      if (!this.current(platform, state) || this.findSelection(state, selectionRef) !== selection) {
        return { ok: false, reason: 'stale' }
      }
      if (job) this.check(job)
      // Identity comes only from this account's retained target and verified adapter evidence.
      if (
        evidence.platform !== platform ||
        evidence.worldId !== world.evidence.worldId ||
        evidence.roomId !== roomId
      ) {
        return { ok: false, reason: 'target-changed' }
      }
      const url = this.options.adapters
        .get(platform)
        ?.buildJoinUrl(this.instance(world, evidence), mode)
      if (!url || !isAllowedLaunchUrl(url)) return { ok: false, reason: 'invalid-url' }
      try {
        await this.options.openExternal(url)
      } catch {
        return { ok: false, reason: 'launch-failed' }
      }
      permit.complete()
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof RateLimitError || error instanceof RequestQueueFullError
            ? 'rate-limited'
            : 'stale'
      }
    } finally {
      if (job) {
        this.finishJob(job)
        this.joinJobs.delete(job)
      }
      permit.release()
    }
  }

  clearPlatform(platform: Platform): void {
    const old = this.states.get(platform)
    if (old) {
      this.cancelJob(old.candidateJob)
      this.cancelJob(old.worldJob)
    }
    for (const job of this.joinJobs) if (job.platform === platform) this.cancelJob(job)
    this.states.delete(platform)
    this.publish(platform)
  }

  dispose(): void {
    this.disposed = true
    this.setActive([])
    for (const platform of PLATFORMS) this.clearPlatform(platform)
    for (const job of this.joinJobs) this.cancelJob(job)
  }

  private state(platform: Platform): State {
    const resolved = this.options.accountSession.resolve(platform)
    const session = 'ready' in resolved ? resolved : null
    const previous = this.states.get(platform)
    if (
      previous &&
      previous.session?.accountKey === session?.accountKey &&
      previous.session?.epoch === session?.epoch
    )
      return previous
    if (previous) {
      this.cancelJob(previous.candidateJob)
      this.cancelJob(previous.worldJob)
    }
    const state: State = {
      session,
      worlds: new Map(),
      candidateIds: [],
      selections: new Map(),
      images: new Map(),
      imagePending: new Map(),
      status: session ? 'idle' : 'unavailable',
      problem: session ? null : 'unavailable',
      refreshedAt: null,
      updatedAt: null,
      candidateAttemptAt: null,
      candidateJob: null,
      worldJob: null,
      selectedRef: null
    }
    this.states.set(platform, state)
    return state
  }

  private current(platform: Platform, state: State): boolean {
    if (this.disposed || this.states.get(platform) !== state || !state.session) return false
    const session = this.options.accountSession.resolve(platform)
    return (
      'ready' in session &&
      session.accountKey === state.session.accountKey &&
      session.epoch === state.session.epoch
    )
  }

  private startCandidates(
    platform: Platform,
    state: State,
    reason: Exclude<ExploreRefreshReason, 'snapshot'>
  ): void {
    if (!this.active.has(platform) || !this.current(platform, state) || state.candidateJob) return
    const wait = reason === 'automatic' ? RETAIN_MS : FRESH_MS
    if (reason === 'automatic' && state.refreshedAt !== null && this.fresh(state.refreshedAt))
      return
    if (state.candidateAttemptAt !== null && this.clock() - state.candidateAttemptAt < wait) return
    state.candidateAttemptAt = this.clock()
    let job: Job
    try {
      job = this.newJob(platform, state, platform === 'vrchat' ? 1 : 13)
    } catch (error) {
      this.failState(state, error)
      this.publish(platform)
      return
    }
    state.candidateJob = job
    this.publish(platform)
    void this.runCandidates(job)
      .catch((error: unknown) => {
        if (
          this.current(platform, state) &&
          state.candidateJob === job &&
          (!job.signal.aborted || job.timedOut)
        )
          this.failState(state, error)
      })
      .finally(() => {
        this.finishJob(job)
        if (state.candidateJob === job) {
          state.candidateJob = null
          this.publish(platform)
        }
      })
  }

  private async runCandidates(job: Job): Promise<void> {
    const { platform, state } = job
    const candidates = await this.request(job, 'background', (adapter, context) =>
      adapter.getExploreCandidates(context)
    )
    const staged = new Map<string, WorldRecord>()
    for (const evidence of candidates.slice(0, 12)) {
      if (evidence.platform !== platform || staged.has(evidence.worldId)) continue
      const existing = state.worlds.get(evidence.worldId)
      staged.set(
        evidence.worldId,
        existing
          ? { ...existing, evidence: { ...evidence }, detail: this.cloneDetail(existing.detail) }
          : this.newWorld(evidence)
      )
    }
    if (platform === 'chilloutvr') {
      let worldReads = 0
      const qualified: WorldRecord[] = []
      for (const world of staged.values()) {
        if (!world.detail || !this.fresh(world.detail.fetchedAt)) {
          if (worldReads >= 6) continue
          worldReads++
          await this.readWorld(job, world, 'background')
        }
        world.lastUsedAt = this.clock()
        qualified.push(world)
      }
      // Each pass gives each world at most one new qualification request.
      let roomReads = 0
      for (let round = 0; roomReads < 6 && round < 100; round++) {
        let found = false
        for (const world of qualified) {
          const id = world.detail?.ids[round]
          if (!id) continue
          found = true
          const known = world.detail!.rooms.get(id)
          if (known && this.fresh(known.checkedAt)) continue
          await this.readRoom(job, world, id, 'background')
          roomReads++
          if (roomReads >= 6) break
        }
        if (!found) break
      }
      for (const world of staged.values()) this.recomputeCvr(world)
    }
    this.check(job)
    // Candidate refresh owns membership. A more recent sheet read retains its evidence.
    for (const [id, world] of staged) {
      const live = state.worlds.get(id)
      if (live?.detail && (!world.detail || live.detail.fetchedAt > world.detail.fetchedAt)) {
        world.detail = live.detail
      } else if (live?.detail && world.detail) {
        for (const id of world.detail.ids) {
          const current = live.detail.rooms.get(id)
          const stagedRoom = world.detail.rooms.get(id)
          if (current && (!stagedRoom || current.checkedAt > stagedRoom.checkedAt))
            world.detail.rooms.set(id, current)
        }
      }
      if (platform === 'chilloutvr') this.recomputeCvr(world)
      // Preserve record identity for an open sheet and existing selections.
      if (live) {
        // A concurrent snapshot may have renewed its reference, or a sheet may
        // have started since staging. Candidate evidence cannot rewind either.
        const newerSheetAttempt = live.lastAttemptAt !== world.lastAttemptAt
        live.evidence = world.evidence
        live.detail = world.detail
        live.lastUsedAt = Math.max(live.lastUsedAt, world.lastUsedAt)
        if (!newerSheetAttempt) {
          live.status = world.status
          live.problem = world.problem
        }
        staged.set(id, live)
      }
    }
    state.worlds = staged
    state.candidateIds = [...staged.values()]
      .filter((world) => platform === 'vrchat' || this.qualifiedRooms(world).length > 0)
      .map((world) => world.evidence.worldId)
    this.pruneSelections(state)
    state.status = 'ready'
    state.problem = null
    state.refreshedAt = this.clock()
    state.updatedAt = this.wallClock()
  }

  private startWorld(
    platform: Platform,
    state: State,
    world: WorldRecord,
    reason: Exclude<ExploreWorldReason, 'snapshot'>
  ): void {
    if (!this.active.has(platform) || !this.current(platform, state)) return
    const alreadySelected = state.selectedRef === world.ref
    if (state.worldJob?.worldRef === world.ref) return
    if (state.worldJob) {
      this.cancelJob(state.worldJob)
      state.worldJob = null
    }
    state.selectedRef = world.ref
    const fresh =
      world.detail !== null && this.fresh(world.detail.fetchedAt) && world.problem === null
    if (reason === 'open' && fresh && (alreadySelected || this.coverage(world))) return
    if (
      reason === 'manual' &&
      world.lastAttemptAt !== null &&
      this.clock() - world.lastAttemptAt < FRESH_MS
    )
      return
    world.lastAttemptAt = this.clock()
    let job: Job
    try {
      job = this.newJob(platform, state, 7, world.ref)
    } catch (error) {
      world.status = 'error'
      world.problem = this.problem(error)
      this.publish(platform)
      return
    }
    state.worldJob = job
    this.publish(platform)
    void this.runWorld(job, world)
      .catch((error: unknown) => {
        if (
          this.current(platform, state) &&
          state.worldJob === job &&
          (!job.signal.aborted || job.timedOut)
        ) {
          world.status = error instanceof AuthError ? 'unavailable' : 'error'
          world.problem = this.problem(error)
        }
      })
      .finally(() => {
        this.finishJob(job)
        if (state.worldJob === job) {
          state.worldJob = null
          this.publish(platform)
        }
      })
  }

  private async runWorld(job: Job, world: WorldRecord): Promise<void> {
    if (!world.detail || !this.fresh(world.detail.fetchedAt))
      await this.readWorld(job, world, 'interactive')
    let reads = 0
    for (const id of world.detail!.ids) {
      const known = world.detail!.rooms.get(id)
      if (known && this.fresh(known.checkedAt)) continue
      if (reads >= 6) break
      await this.readRoom(job, world, id, 'interactive')
      reads++
    }
    this.check(job)
    if (job.platform === 'chilloutvr') this.recomputeCvr(world)
    world.status = 'ready'
    world.problem = null
  }

  private async readWorld(
    job: Job,
    world: WorldRecord,
    priority: 'background' | 'interactive'
  ): Promise<void> {
    const data = await this.request(job, priority, (adapter, context) =>
      adapter.getExploreWorld(world.evidence.worldId, context)
    )
    if (
      !data ||
      data.world.worldId !== world.evidence.worldId ||
      data.world.platform !== job.platform
    )
      throw new ExploreDataError('Invalid world evidence')
    const ids = [...new Set(data.roomIds.slice(0, 100))]
    const previous = world.detail
    const rooms = new Map<string, RoomRecord>()
    for (const id of ids) {
      const known = previous?.rooms.get(id)
      if (known) rooms.set(id, known)
    }
    world.evidence = { ...data.world, sourceOrder: world.evidence.sourceOrder }
    world.detail = {
      ids,
      enumerationComplete: data.roomsComplete && data.roomIds.length <= 100,
      rooms,
      fetchedAt: this.clock(),
      updatedAt: this.wallClock()
    }
    world.status = 'ready'
    world.problem = null
  }

  private async readRoom(
    job: Job,
    world: WorldRecord,
    roomId: string,
    priority: 'background' | 'interactive'
  ): Promise<void> {
    const evidence = await this.request(job, priority, (adapter, context) =>
      adapter.getExploreRoom({ worldId: world.evidence.worldId, instanceId: roomId }, context)
    )
    if (
      evidence &&
      (evidence.platform !== job.platform ||
        evidence.worldId !== world.evidence.worldId ||
        evidence.roomId !== roomId)
    )
      throw new ExploreDataError('Invalid room evidence')
    const previous = world.detail?.rooms.get(roomId)
    if (previous?.selectionRef) job.state.selections.delete(previous.selectionRef)
    world.detail!.rooms.set(roomId, { evidence, checkedAt: this.clock(), selectionRef: null })
  }

  private newJob(platform: Platform, state: State, maxAttempts: number, worldRef?: string): Job {
    const adapter = this.options.adapters.get(platform)
    const admission = this.options.admissions.get(platform)
    if (!adapter || !admission || !state.session || !this.current(platform, state))
      throw new RequestCancelledError()
    if (admission.cooldownRemainingMs > 0) throw new RateLimitError(admission.cooldownRemainingMs)
    const lease = adapter.captureExploreLease()
    assertRequestLease(lease)
    const controller = new AbortController()
    const job: Job = {
      platform,
      state,
      session: state.session,
      lease,
      controller,
      signal: AbortSignal.any([controller.signal, lease.signal]),
      revision: admission.rateLimitRevision,
      deadline: this.clock() + DEADLINE_MS,
      timedOut: false,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      worldRef,
      attempts: 0,
      maxAttempts
    }
    job.timer = setTimeout(() => {
      job.timedOut = true
      controller.abort()
    }, DEADLINE_MS)
    return job
  }

  private async request<T>(
    job: Job,
    priority: 'background' | 'interactive',
    operation: (adapter: MainAdapter, context: ExploreRequestContext) => Promise<T>
  ): Promise<T> {
    this.check(job)
    const adapter = this.options.adapters.get(job.platform)!
    let onAbort: () => void = () => undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new RequestCancelledError())
      job.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const work = operation(adapter, {
        lease: job.lease,
        signal: job.signal,
        priority,
        beforeDispatch: () => {
          this.check(job)
          if (job.attempts >= job.maxAttempts || !this.take(this.jsonStarts, job.platform, 20))
            throw new RateLimitError(FRESH_MS)
          job.attempts++
        }
      })
      const result = await Promise.race([work, cancelled])
      this.check(job)
      return result
    } finally {
      job.signal.removeEventListener('abort', onAbort)
    }
  }

  private check(job: Job): void {
    assertRequestLease(job.lease)
    if (
      !this.current(job.platform, job.state) ||
      job.signal.aborted ||
      this.clock() >= job.deadline
    )
      throw new RequestCancelledError()
    const admission = this.options.admissions.get(job.platform)!
    if (admission.rateLimitRevision !== job.revision || admission.cooldownRemainingMs > 0)
      throw new RateLimitError(admission.cooldownRemainingMs)
  }

  private finishJob(job: Job): void {
    clearTimeout(job.timer)
  }
  private cancelJob(job: Job | null): void {
    if (job) {
      job.controller.abort()
      this.finishJob(job)
    }
  }

  private newWorld(evidence: ExploreWorldEvidence): WorldRecord {
    return {
      evidence,
      ref: randomUUID(),
      refExpiresAt: this.clock() + RETAIN_MS,
      generation: 0,
      detail: null,
      status: 'idle',
      problem: null,
      lastUsedAt: this.clock(),
      lastAttemptAt: null
    }
  }

  private cloneDetail(detail: Detail | null): Detail | null {
    return detail ? { ...detail, ids: [...detail.ids], rooms: new Map(detail.rooms) } : null
  }

  private publicWorld(state: State, world: WorldRecord): ExploreWorld {
    if (world.refExpiresAt <= this.clock()) {
      // The old opener can no longer address this job. Stop it before issuing
      // a replacement reference so closing/switching cannot strand its work.
      if (state.worldJob?.worldRef === world.ref) {
        this.cancelJob(state.worldJob)
        state.worldJob = null
      }
      if (state.selectedRef === world.ref) state.selectedRef = null
      world.ref = randomUUID()
      world.refExpiresAt = this.clock() + RETAIN_MS
      world.generation++
      this.pruneSelections(state)
    }
    return { ...world.evidence, worldRef: world.ref }
  }

  private snapshot(platform: Platform, state: State): ExplorePlatformSnapshot {
    return {
      platform,
      worlds: state.candidateIds.flatMap((id) => {
        const world = state.worlds.get(id)
        return world ? [this.publicWorld(state, world)] : []
      }),
      status: state.candidateJob ? 'loading' : state.status,
      problem: state.problem,
      isStale:
        state.problem !== null || state.refreshedAt === null || !this.fresh(state.refreshedAt),
      updatedAt: state.updatedAt
    }
  }

  private worldSnapshot(
    platform: Platform,
    state: State,
    world: WorldRecord
  ): ExploreWorldSnapshot {
    const detail = world.detail
    return {
      platform,
      world: this.publicWorld(state, world),
      rooms: detail
        ? detail.ids.flatMap((id) => {
            const room = detail.rooms.get(id)
            return room?.evidence ? [this.publicRoom(state, world, room)] : []
          })
        : [],
      roomsComplete: this.coverage(world),
      status: state.worldJob?.worldRef === world.ref ? 'loading' : world.status,
      problem: world.problem,
      isStale: world.problem !== null || !detail || !this.fresh(detail.fetchedAt),
      updatedAt: detail?.updatedAt ?? null
    }
  }

  private publicRoom(state: State, world: WorldRecord, room: RoomRecord): ExploreRoom {
    const { joinEligibility, ...display } = room.evidence!
    if (!this.options.isJoinAllowed())
      return { ...display, action: { state: 'disabled', reason: 'joining-disabled' } }
    if (!this.fresh(room.checkedAt))
      return { ...display, action: { state: 'disabled', reason: 'stale' } }
    if (joinEligibility !== 'eligible')
      return { ...display, action: { state: 'disabled', reason: joinEligibility } }
    if (!room.selectionRef || !this.findSelection(state, room.selectionRef)) {
      room.selectionRef = randomUUID()
      state.selections.set(room.selectionRef, {
        world,
        roomId: display.roomId,
        generation: world.generation,
        expiresAt: this.clock() + RETAIN_MS
      })
    }
    return { ...display, action: { state: 'available', selectionRef: room.selectionRef } }
  }

  private findWorld(state: State, ref: string): WorldRecord | null {
    if (!state.session) return null
    return (
      [...state.worlds.values()].find(
        (world) => world.ref === ref && world.refExpiresAt > this.clock()
      ) ?? null
    )
  }

  private findSelection(state: State, ref: string): Selection | null {
    const selection = state.selections.get(ref)
    if (
      !selection ||
      selection.expiresAt <= this.clock() ||
      state.worlds.get(selection.world.evidence.worldId) !== selection.world ||
      selection.generation !== selection.world.generation ||
      !selection.world.detail?.ids.includes(selection.roomId)
    )
      return null
    return selection
  }

  private pruneSelections(state: State): void {
    for (const ref of state.selections.keys())
      if (!this.findSelection(state, ref)) state.selections.delete(ref)
  }

  private qualifiedRooms(world: WorldRecord): ExploreRoomEvidence[] {
    return (
      world.detail?.ids.flatMap((id) => {
        const room = world.detail!.rooms.get(id)
        return room?.evidence && this.fresh(room.checkedAt) ? [room.evidence] : []
      }) ?? []
    )
  }

  private coverage(world: WorldRecord): boolean {
    const detail = world.detail
    return Boolean(
      detail &&
      this.fresh(detail.fetchedAt) &&
      detail.enumerationComplete &&
      detail.ids.every((id) => {
        const room = detail.rooms.get(id)
        return room !== undefined && this.fresh(room.checkedAt)
      })
    )
  }

  private recomputeCvr(world: WorldRecord): void {
    const rooms = this.qualifiedRooms(world)
    const complete = this.coverage(world)
    world.evidence = {
      ...world.evidence,
      activity: aggregateCvrExploreQualifiedRooms(world.evidence.worldId, rooms, complete),
      visibleRoomCount: complete
        ? { state: 'complete', value: rooms.length, source: 'visible-rooms' }
        : { state: 'partial', value: null, source: 'visible-rooms' }
    }
  }

  private expireDetails(state: State): void {
    const now = this.clock()
    for (const world of state.worlds.values()) {
      if (world.detail && world.lastUsedAt + RETAIN_MS <= now && state.selectedRef !== world.ref) {
        world.detail = null
        world.status = 'idle'
      }
    }
    this.pruneSelections(state)
  }

  private fresh(time: number): boolean {
    return this.clock() - time < FRESH_MS
  }
  private take(ledger: Map<Platform, number[]>, platform: Platform, limit: number): boolean {
    const now = this.clock()
    const starts = (ledger.get(platform) ?? []).filter((time) => now - time < FRESH_MS)
    ledger.set(platform, starts)
    if (starts.length >= limit) return false
    starts.push(now)
    return true
  }

  private problem(error: unknown): Problem {
    return error instanceof RateLimitError || error instanceof RequestQueueFullError
      ? 'rate-limited'
      : error instanceof AuthError
        ? 'unavailable'
        : error instanceof ExploreDataError
          ? 'invalid-data'
          : 'network'
  }
  private failState(state: State, error: unknown): void {
    state.status = error instanceof AuthError ? 'unavailable' : 'error'
    state.problem = this.problem(error)
  }
  private publish(platform: Platform): void {
    if (this.disposed) return
    try {
      this.options.onChanged(platform)
    } catch {
      /* Invalidations cannot fail a completed read. */
    }
  }

  private imageUrl(value: string | null): string | null {
    if (!value || value.length > 2048) return null
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
      url.hash = ''
      return url.href
    } catch {
      return null
    }
  }

  private instance(world: WorldRecord, room: ExploreRoomEvidence): InstanceInfo {
    return {
      worldId: world.evidence.worldId,
      instanceId: room.roomId,
      worldName: world.evidence.name,
      thumbnailUrl: world.evidence.thumbnailUrl,
      type: room.access,
      openness: 'public',
      isGroup: room.access === 'group-public',
      groupName: room.groupName,
      groupId: null,
      groupImageUrl: null,
      region: room.region,
      userCount: room.occupancy.state === 'complete' ? room.occupancy.value : null
    }
  }
}

function evidenceWithDenial(evidence: ExploreRoomEvidence): ExploreRoomEvidence {
  return { ...evidence, joinEligibility: 'unavailable' }
}
