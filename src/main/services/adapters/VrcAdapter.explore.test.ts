import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import type { ExploreRequestContext } from './ExploreAdapter'
import { ExploreDataError } from './ExploreAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { AuthError, RateLimitError, RequestCancelledError } from './errors'
import {
  INSTANCE_OPTIONS_CACHE_MS,
  INSTANCE_OPTIONS_FAILURE_CACHE_MS
} from './vrchat/instanceOptions'
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
      .mockResolvedValueOnce(jsonResponse({ categories: [], vibes: [] }))
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
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`
    ])
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/instanceCategories'))).toBe(
      false
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/instanceVibes'))).toBe(false)
  })

  it('maps category and vibe labels from one options read', async () => {
    const roomId = 'public-room'
    const hangout = 'icat_44bc6a70-493f-4f84-8a3b-1f290c864c2a'
    const adventure = 'ivib_2d8445c4-f47b-4635-b565-467fc32c4003'
    const cozy = 'ivib_11111111-1111-1111-1111-111111111111'
    const options = {
      categories: [
        {
          deleted: false,
          iconUrl: 'vrchat://category_hangout',
          id: hangout,
          name: 'Hangout',
          order: 0
        }
      ],
      vibes: [
        { deleted: false, id: cozy, title: 'cozy' },
        { deleted: false, id: adventure, title: 'adventure' }
      ]
    }
    const roomBody = {
      worldId,
      instanceId: roomId,
      id: `${worldId}:${roomId}`,
      location: `${worldId}:${roomId}`,
      categoryId: hangout,
      displayVibeId: adventure,
      vibeIds: [cozy, adventure]
    }
    const beforeDispatch = vi.fn()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(options))
      .mockResolvedValueOnce(jsonResponse(roomBody))
      .mockResolvedValueOnce(jsonResponse(roomBody))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    const first = await adapter.getExploreRoom(
      { worldId, instanceId: roomId },
      context(adapter, beforeDispatch)
    )
    const second = await adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))

    expect(first).toMatchObject({
      instanceCategory: 'Hangout',
      instanceVibes: ['adventure', 'cozy']
    })
    expect(second).toMatchObject({
      instanceCategory: 'Hangout',
      instanceVibes: ['adventure', 'cozy']
    })
    const encoded = JSON.stringify(first)
    expect(encoded).not.toContain('icat_')
    expect(encoded).not.toContain('ivib_')
    expect(encoded).not.toContain('vrchat://')
    expect(beforeDispatch).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`
    ])
  })

  it('still returns the room when instance options fails, and does not fetch the room on a 401', async () => {
    const roomId = 'public-room'
    const roomBody = {
      worldId,
      instanceId: roomId,
      id: `${worldId}:${roomId}`,
      location: `${worldId}:${roomId}`,
      categoryId: 'icat_44bc6a70-493f-4f84-8a3b-1f290c864c2a',
      vibeIds: ['ivib_2d8445c4-f47b-4635-b565-467fc32c4003']
    }
    const failed = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(roomBody))
      .mockResolvedValueOnce(jsonResponse(roomBody))
    vi.stubGlobal('fetch', failed)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    const room = await adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))
    expect(room).toMatchObject({ instanceCategory: null, instanceVibes: [] })
    expect(JSON.stringify(room)).not.toContain('icat_')
    const again = await adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))
    expect(again).toMatchObject({ instanceCategory: null, instanceVibes: [] })
    expect(failed.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`
    ])

    const denied = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', denied)
    const signedOut = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(signedOut)
    await expect(
      signedOut.getExploreRoom({ worldId, instanceId: roomId }, context(signedOut))
    ).rejects.toBeInstanceOf(AuthError)
    expect(denied).toHaveBeenCalledTimes(1)
  })

  it('reads instance options again after the session changes', async () => {
    const roomId = 'public-room'
    const roomBody = {
      worldId,
      instanceId: roomId,
      id: `${worldId}:${roomId}`,
      location: `${worldId}:${roomId}`
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ categories: [], vibes: [] }))
      .mockResolvedValueOnce(jsonResponse(roomBody))
      .mockResolvedValueOnce(jsonResponse({ categories: [], vibes: [] }))
      .mockResolvedValueOnce(jsonResponse(roomBody))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)

    await adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))
    const internal = adapter as unknown as { bumpSessionGeneration(): void }
    internal.bumpSessionGeneration()
    await adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`
    ])
  })

  it('keeps instance options for 24 hours and refetches when that cache ends', async () => {
    expect(INSTANCE_OPTIONS_CACHE_MS).toBe(24 * 60 * 60 * 1000)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_700_000_000_000)
    const roomId = 'public-room'
    const roomBody = {
      worldId,
      instanceId: roomId,
      id: `${worldId}:${roomId}`,
      location: `${worldId}:${roomId}`
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ categories: [], vibes: [] }))
      .mockResolvedValueOnce(jsonResponse(roomBody))
      .mockResolvedValueOnce(jsonResponse(roomBody))
      .mockResolvedValueOnce(jsonResponse({ categories: [], vibes: [] }))
      .mockResolvedValueOnce(jsonResponse(roomBody))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)
    const read = (): ReturnType<VrcAdapter['getExploreRoom']> =>
      adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))

    await read()
    vi.setSystemTime(Date.now() + INSTANCE_OPTIONS_CACHE_MS - 1)
    await read()
    vi.setSystemTime(Date.now() + 1)
    await read()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`
    ])
  })

  it('retries a failed instance-options read after 60 seconds', async () => {
    expect(INSTANCE_OPTIONS_FAILURE_CACHE_MS).toBe(60_000)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_700_000_000_000)
    const roomId = 'public-room'
    const roomBody = {
      worldId,
      instanceId: roomId,
      id: `${worldId}:${roomId}`,
      location: `${worldId}:${roomId}`
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(roomBody))
      .mockResolvedValueOnce(jsonResponse(roomBody))
      .mockResolvedValueOnce(jsonResponse({ categories: [], vibes: [] }))
      .mockResolvedValueOnce(jsonResponse(roomBody))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)
    const read = (): ReturnType<VrcAdapter['getExploreRoom']> =>
      adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))

    await read()
    vi.setSystemTime(Date.now() + INSTANCE_OPTIONS_FAILURE_CACHE_MS - 1)
    await read()
    vi.setSystemTime(Date.now() + 1)
    await read()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`,
      'https://api.vrchat.cloud/api/1/instanceOptions',
      `https://api.vrchat.cloud/api/1/worlds/${worldId}/${roomId}`
    ])
  })

  it('does not keep an instance-options reply that arrives after the session ends', async () => {
    const roomId = 'public-room'
    const hangout = 'icat_44bc6a70-493f-4f84-8a3b-1f290c864c2a'
    const roomBody = {
      worldId,
      instanceId: roomId,
      id: `${worldId}:${roomId}`,
      location: `${worldId}:${roomId}`,
      categoryId: hangout
    }
    let releaseLate: ((response: Response) => void) | undefined
    let optionsReads = 0
    const fetchMock = vi.fn((url: string) => {
      if (String(url).endsWith('/instanceOptions')) {
        optionsReads += 1
        if (optionsReads === 1) {
          return new Promise<Response>((resolve) => {
            releaseLate = resolve
          })
        }
        return Promise.resolve(jsonResponse({ categories: [], vibes: [] }))
      }
      return Promise.resolve(jsonResponse(roomBody))
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)
    const first = adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))
    await vi.waitFor(() => expect(releaseLate).toBeTypeOf('function'))

    const internal = adapter as unknown as { bumpSessionGeneration(): void }
    internal.bumpSessionGeneration()
    releaseLate!(
      jsonResponse({
        categories: [
          {
            deleted: false,
            iconUrl: 'vrchat://category_hangout',
            id: hangout,
            name: 'Hangout',
            order: 0
          }
        ],
        vibes: []
      })
    )

    await expect(first).rejects.toBeInstanceOf(RequestCancelledError)
    const second = await adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))
    expect(second).toMatchObject({ instanceCategory: null, instanceVibes: [] })
    expect(JSON.stringify(second)).not.toContain('Hangout')
    expect(optionsReads).toBe(2)
  })

  it('keeps a live room read when another room job cancels the shared options read', async () => {
    const roomId = 'public-room'
    const roomBody = {
      worldId,
      instanceId: roomId,
      id: `${worldId}:${roomId}`,
      location: `${worldId}:${roomId}`
    }
    let releaseOptions: ((response: Response) => void) | undefined
    const fetchMock = vi.fn((url: string) => {
      if (String(url).endsWith('/instanceOptions')) {
        return new Promise<Response>((resolve) => {
          releaseOptions = resolve
        })
      }
      return Promise.resolve(jsonResponse(roomBody))
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(store(), instantAdmission())
    markVrcSessionEstablished(adapter)
    const cancelled = new AbortController()
    const first = adapter.getExploreRoom(
      { worldId, instanceId: roomId },
      { ...context(adapter), signal: cancelled.signal }
    )
    await vi.waitFor(() => expect(releaseOptions).toBeTypeOf('function'))
    const second = adapter.getExploreRoom({ worldId, instanceId: roomId }, context(adapter))
    cancelled.abort()
    releaseOptions!(jsonResponse({ categories: [], vibes: [] }))

    await expect(first).rejects.toBeInstanceOf(RequestCancelledError)
    await expect(second).resolves.toMatchObject({ roomId, instanceCategory: null })
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/instanceOptions'))
    ).toHaveLength(1)
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
