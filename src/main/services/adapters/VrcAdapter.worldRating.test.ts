import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_REQUEST_MIN_INTERVAL_MS } from '@shared/constants'
import type { VrcCredentialStore } from './VrcAdapter'
import { VrcAdapter } from './VrcAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { WorldRatingDataError, WorldRatingIdError } from './WorldRatingAdapter'
import { AuthError, RateLimitError } from './errors'
import { jsonResponse, markVrcSessionEstablished } from './__testutils__/adapterTestKit'

const USER = 'usr_12345678-1234-1234-1234-123456789abc'
const WORLD = 'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b'

function store(): VrcCredentialStore {
  return { load: () => 'auth=synthetic', save: () => {}, delete: () => {} }
}

function signedIn(admission: ApiAdmissionController): VrcAdapter {
  const adapter = new VrcAdapter(store(), admission)
  markVrcSessionEstablished(adapter)
  Object.assign(adapter as unknown as { accountId: string }, { accountId: USER })
  return adapter
}

describe('VrcAdapter world rating', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads, sets and clears through the shared admission line, and does not retry a 429', async () => {
    const waits: number[] = []
    let time = 1_000_000
    const admission = new ApiAdmissionController({
      now: () => time,
      sleep: async (ms) => {
        waits.push(ms)
        time += ms
      },
      random: () => 0
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ value: null }))
      .mockResolvedValueOnce(jsonResponse({ value: 'like' }))
      .mockResolvedValueOnce(jsonResponse({ value: 'dislike' }))
      .mockResolvedValueOnce(jsonResponse({ value: null }))
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn(admission)
    const lease = (): ReturnType<VrcAdapter['captureWorldRatingLease']> =>
      adapter.captureWorldRatingLease()

    await expect(adapter.getWorldRating(WORLD, lease())).resolves.toBeNull()
    await expect(adapter.setWorldRating(WORLD, 'like', lease())).resolves.toBe('like')
    await expect(adapter.setWorldRating(WORLD, 'dislike', lease())).resolves.toBe('dislike')
    await expect(adapter.deleteWorldRating(WORLD, lease())).resolves.toBeNull()

    const [getUrl, getOptions] = fetchMock.mock.calls[0]!
    expect(getUrl).toBe(`https://api.vrchat.cloud/api/1/worlds/${WORLD}/rating`)
    expect(getOptions).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(getOptions.headers).toMatchObject({ Cookie: 'auth=synthetic' })
    expect(getOptions.headers['Content-Type']).toBeUndefined()

    const [putUrl, putOptions] = fetchMock.mock.calls[1]!
    expect(putUrl).toBe(getUrl)
    expect(putOptions).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(putOptions.body))).toEqual({ value: 'like' })
    expect(putOptions.headers).toMatchObject({ 'Content-Type': 'application/json' })

    expect(fetchMock.mock.calls[2]![1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(fetchMock.mock.calls[2]![1].body))).toEqual({ value: 'dislike' })
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({ method: 'DELETE' })
    expect(fetchMock.mock.calls[3]![1].body).toBeUndefined()

    // Each request after the first waits out the shared one-per-second budget.
    expect(waits.filter((ms) => ms >= API_REQUEST_MIN_INTERVAL_MS).length).toBeGreaterThanOrEqual(3)

    await expect(adapter.getWorldRating(WORLD, lease())).rejects.toBeInstanceOf(RateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('refuses a malformed world id and a body that is not a rating, before trusting it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: 'love' }))
    vi.stubGlobal('fetch', fetchMock)
    let time = 0
    const admission = new ApiAdmissionController({
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
      random: () => 0
    })
    const adapter = signedIn(admission)
    for (const bad of ['wrld_x/../../auth', USER, '']) {
      await expect(
        adapter.getWorldRating(bad, adapter.captureWorldRatingLease())
      ).rejects.toBeInstanceOf(WorldRatingIdError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(
      adapter.getWorldRating(WORLD, adapter.captureWorldRatingLease())
    ).rejects.toBeInstanceOf(WorldRatingDataError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a 401 invalidates the session', async () => {
    let time = 0
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const adapter = signedIn(
      new ApiAdmissionController({
        now: () => time,
        sleep: async (ms) => {
          time += ms
        },
        random: () => 0
      })
    )
    const events: string[] = []
    adapter.subscribe((event) => events.push(event.type))
    await expect(
      adapter.getWorldRating(WORLD, adapter.captureWorldRatingLease())
    ).rejects.toBeInstanceOf(AuthError)
    expect(events).toContain('auth-invalidated')
  })

  it('needs a durable session to capture a lease', () => {
    let time = 0
    const adapter = new VrcAdapter(
      store(),
      new ApiAdmissionController({
        now: () => time,
        sleep: async (ms) => {
          time += ms
        },
        random: () => 0
      })
    )
    expect(() => adapter.captureWorldRatingLease()).toThrow()
  })
})
