import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import type { ExploreRequestContext } from './ExploreAdapter'
import { ExploreDataError } from './ExploreAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { CVRAuthError, CVRRateLimitError } from './errors'
import { instantAdmission, jsonResponse } from './__testutils__/adapterTestKit'

const worldId = '12345678-1234-1234-1234-123456789abc'
const instanceId = 'i+1234567890abcdef-123456-123456-12345678'

function store(): CvrCredentialStore {
  const credentials: CVRCredentials = { username: 'cvr-user', accessKey: 'cvr-access-key' }
  return { load: () => credentials, save: () => {}, delete: () => {} }
}

function established(adapter: CvrAdapter): CvrAdapter {
  Object.assign(adapter as unknown as { validated: boolean }, { validated: true })
  return adapter
}

function context(adapter: CvrAdapter, beforeDispatch = (): void => {}): ExploreRequestContext {
  return {
    lease: adapter.captureExploreLease(),
    signal: new AbortController().signal,
    priority: 'background',
    beforeDispatch
  }
}

function envelope(data: unknown): { message: string; data: unknown } {
  return { message: 'ok', data }
}

describe('CvrAdapter Explore capability', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses only the fixed discovery host and lazily adds authenticated headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(envelope({ entries: [{ id: worldId, name: 'World', imageUrl: null }] }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), instantAdmission()))

    await expect(adapter.getExploreCandidates(context(adapter))).resolves.toMatchObject([
      { worldId, platform: 'chilloutvr' }
    ])

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      'https://api.chilloutvr.net/2/worlds/list/wrldactive?page=0&sort=Default&direction=Ascending'
    )
    expect(options).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(options.headers).toMatchObject({ Username: 'cvr-user', AccessKey: 'cvr-access-key' })
    expect(String(url)).not.toContain('api.abinteractive.net')
  })

  it('does not retry a discovery 429, including Retry-After zero', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), instantAdmission()))

    await expect(adapter.getExploreCandidates(context(adapter))).rejects.toBeInstanceOf(
      CVRRateLimitError
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not dispatch a queued request after its original session is cleared', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const admission = new ApiAdmissionController()
    await admission.acquire()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), admission))
    const request = adapter.getExploreCandidates(context(adapter)).catch((error: unknown) => error)

    adapter.clearSession()
    await vi.advanceTimersByTimeAsync(0)

    await expect(request).resolves.toBeInstanceOf(Error)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a budget before request headers are constructed', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), instantAdmission()))

    await expect(
      adapter.getExploreCandidates(
        context(adapter, () => {
          throw new Error('Explore budget exhausted')
        })
      )
    ).rejects.toThrow('Explore budget exhausted')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds malformed category and world records before parsing', async () => {
    const entries = Array.from({ length: 13 }, (_, index) =>
      index === 12 ? { id: worldId, name: 'Late world' } : { id: 'bad', name: 'Bad' }
    )
    const instances = Array.from({ length: 101 }, () => ({ id: instanceId }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(envelope({ entries })))
      .mockResolvedValueOnce(jsonResponse(envelope({ id: worldId, name: 'World', instances })))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), instantAdmission()))

    await expect(adapter.getExploreCandidates(context(adapter))).resolves.toEqual([])
    await expect(adapter.getExploreWorld(worldId, context(adapter))).resolves.toMatchObject({
      roomIds: [instanceId],
      roomsComplete: false
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid targets without constructing a discovery URL', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), instantAdmission()))

    await expect(
      adapter.getExploreRoom({ worldId, instanceId: 'https://elsewhere.test' }, context(adapter))
    ).rejects.toBeInstanceOf(ExploreDataError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the exact discovery world and room paths', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(envelope({ id: worldId, name: 'World', instances: [] })))
      .mockResolvedValueOnce(
        jsonResponse(
          envelope({
            id: instanceId,
            world: { id: worldId },
            privacy: 'Public',
            currentPlayerCount: 3
          })
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), instantAdmission()))

    await expect(adapter.getExploreWorld(worldId, context(adapter))).resolves.toMatchObject({
      world: { worldId }
    })
    await expect(
      adapter.getExploreRoom({ worldId, instanceId }, context(adapter))
    ).resolves.toMatchObject({
      roomId: instanceId,
      joinEligibility: 'eligible'
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `https://api.chilloutvr.net/1/worlds/${worldId}`,
      `https://api.chilloutvr.net/1/instances/${encodeURIComponent(instanceId)}`
    ])
  })

  it('rejects malformed access evidence but keeps verified private rooms excluded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(envelope({ id: instanceId, world: { id: worldId } })))
      .mockResolvedValueOnce(
        jsonResponse(envelope({ id: instanceId, world: { id: worldId }, privacy: 'Friends' }))
      )
      .mockResolvedValueOnce(
        jsonResponse(envelope({ id: instanceId, world: { id: worldId }, privacy: 'FuturePrivacy' }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), instantAdmission()))

    await expect(
      adapter.getExploreRoom({ worldId, instanceId }, context(adapter))
    ).rejects.toBeInstanceOf(ExploreDataError)
    await expect(
      adapter.getExploreRoom({ worldId, instanceId }, context(adapter))
    ).resolves.toBeNull()
    await expect(
      adapter.getExploreRoom({ worldId, instanceId }, context(adapter))
    ).rejects.toBeInstanceOf(ExploreDataError)
  })

  it.each([
    [0, 'a public-like numeric enum value'],
    [2, 'a mapped friends numeric enum value'],
    [99, 'an unsupported numeric enum value']
  ])('rejects %s as incomplete Explore room access evidence', async (privacy) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(envelope({ id: instanceId, world: { id: worldId }, privacy }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = established(new CvrAdapter(store(), instantAdmission()))

    await expect(
      adapter.getExploreRoom({ worldId, instanceId }, context(adapter))
    ).rejects.toBeInstanceOf(ExploreDataError)
  })

  it('does not invalidate a replacement session for an old lease auth error', async () => {
    const adapter = established(new CvrAdapter(store(), instantAdmission()))
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
      internal.runExploreRequest(stale, () => Promise.reject(new CVRAuthError('expired')))
    ).rejects.toBeInstanceOf(CVRAuthError)
    expect(emit).not.toHaveBeenCalled()
  })
})
