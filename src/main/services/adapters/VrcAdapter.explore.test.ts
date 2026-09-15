import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import type { ExploreRequestContext } from './ExploreAdapter'
import { ExploreDataError } from './ExploreAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { AuthError, RateLimitError } from './errors'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

const worldId = 'wrld_12345678-1234-1234-1234-123456789abc'

function store(): VrcCredentialStore {
  return { load: () => 'auth=synthetic', save: () => {}, delete: () => {} }
}

function context(adapter: VrcAdapter, beforeDispatch = (): void => {}): ExploreRequestContext {
  return {
    lease: adapter.captureExploreLease(),
    signal: new AbortController().signal,
    priority: 'background',
    beforeDispatch
  }
}

function candidate(id: string, name = 'World'): Record<string, unknown> {
  return { id, name, occupants: 4, thumbnailImageUrl: null, popularity: 1 }
}

function room(id: string): [string, number, Record<string, unknown>] {
  return [id, 2, {}]
}

describe('VrcAdapter Explore capability', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses the original lease and makes one bounded active-world request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([candidate(worldId)]))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    await expect(adapter.getExploreCandidates(context(adapter))).resolves.toMatchObject([
      { worldId, platform: 'vrchat' }
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.vrchat.cloud/api/1/worlds/active?n=12')
    expect(options).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(options.headers).toMatchObject({ Cookie: 'auth=synthetic' })
  })

  it('does not retry an immediate 429', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    await expect(adapter.getExploreCandidates(context(adapter))).rejects.toBeInstanceOf(
      RateLimitError
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects an admission budget before credentials can leave the process', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    await expect(
      adapter.getExploreCandidates(
        context(adapter, () => {
          throw new Error('Explore budget exhausted')
        })
      )
    ).rejects.toThrow('Explore budget exhausted')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels a queued exploration request when the captured session ends', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const admission = new ApiAdmissionController()
    await admission.acquire()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), admission)
    markVrcSessionEstablished(adapter)
    const request = adapter.getExploreCandidates(context(adapter)).catch((error: unknown) => error)

    adapter.clearSession()
    await vi.advanceTimersByTimeAsync(0)

    await expect(request).resolves.toBeInstanceOf(Error)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds candidate and room parsing without replacement scans', async () => {
    const candidateRecords = Array.from({ length: 13 }, (_, index) =>
      candidate(
        index === 12 ? 'wrld_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : `not-a-world-${String(index)}`
      )
    )
    const rooms = Array.from({ length: 101 }, (_, index) => room(`room${String(index)}`))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(candidateRecords))
      .mockResolvedValueOnce(jsonResponse({ id: worldId, name: 'World', instances: rooms }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    await expect(adapter.getExploreCandidates(context(adapter))).resolves.toEqual([])
    await expect(adapter.getExploreWorld(worldId, context(adapter))).resolves.toMatchObject({
      roomIds: Array.from({ length: 100 }, (_, index) => `room${String(index)}`),
      roomsComplete: false,
      world: { visibleRoomCount: { state: 'partial', value: null } }
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed outer data instead of treating it as an empty catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ entries: [] })))
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    await expect(adapter.getExploreCandidates(context(adapter))).rejects.toBeInstanceOf(
      ExploreDataError
    )
  })

  it('uses the exact world and room paths and rejects mismatched room identity', async () => {
    const roomId = 'public-room'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: worldId, name: 'World', instances: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          worldId,
          instanceId: roomId,
          id: `${worldId}:${roomId}`,
          location: `${worldId}:${roomId}`,
          type: 'public',
          groupAccessType: null,
          active: true,
          full: false,
          hasCapacityForYou: true,
          roleRestricted: false,
          ageGate: false,
          closedAt: null,
          hardClose: null
        })
      )
      .mockResolvedValueOnce(jsonResponse({ worldId, instanceId: 'other-room' }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    await expect(adapter.getExploreWorld(worldId, context(adapter))).resolves.toMatchObject({
      world: { worldId }
    })
    await expect(
      adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))
    ).resolves.toMatchObject({
      roomId,
      joinEligibility: 'eligible'
    })
    await expect(
      adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))
    ).rejects.toBeInstanceOf(ExploreDataError)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `https://api.vrchat.cloud/api/1/worlds/${worldId}`,
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`
    ])
  })

  it('does not invalidate a replacement session for an old lease auth error', async () => {
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)
    const stale = context(adapter)
    const internal = adapter as unknown as {
      bumpSessionGeneration(): void
      emit(event: unknown): void
      runExploreRequest<T>(
        requestContext: ExploreRequestContext,
        request: () => Promise<T>
      ): Promise<T>
    }
    const emit = vi.spyOn(internal, 'emit')
    internal.bumpSessionGeneration()

    await expect(
      internal.runExploreRequest(stale, () => Promise.reject(new AuthError('expired', 401)))
    ).rejects.toBeInstanceOf(AuthError)
    expect(emit).not.toHaveBeenCalled()
  })
})
