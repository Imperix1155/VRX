import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { API_TIMEOUT_MS } from '@shared/constants'
import type { AuthStatus, LoginResult, Platform } from '@shared/types'
import type { FriendRoster, Unsubscribe } from './IPlatformAdapter'
import { BaseAdapter, type AdapterRequestOptions } from './BaseAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { AuthError, NetworkError, RateLimitError, RequestCancelledError } from './errors'
import { noopSleep, instantAdmission } from './__testutils__/adapterTestKit'
import { AvatarCache } from '../avatarCache'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    json: () => Promise.resolve(body)
  } as unknown as Response
}

const schema = z.object({ id: z.number() })
const validBody = { id: 1 }

// ── TestAdapter ───────────────────────────────────────────────────────────────

// Minimal concrete subclass used only for testing the base infrastructure.
class TestAdapter extends BaseAdapter {
  readonly platform: Platform = 'vrchat'

  // Explicit public constructor so tests can call `new TestAdapter(sleepFn)`
  // from outside the class hierarchy (BaseAdapter's constructor is protected).
  constructor(
    sleepFn: (ms: number) => Promise<void> = noopSleep,
    admission?: ApiAdmissionController
  ) {
    super(admission ?? instantAdmission(sleepFn))
  }

  getAuthStatus(): Promise<AuthStatus> {
    return Promise.resolve({
      platform: 'vrchat',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
  }
  login(): Promise<LoginResult> {
    return Promise.resolve({ ok: true })
  }
  verify2fa(): Promise<LoginResult> {
    return Promise.resolve({ ok: true })
  }
  clearSession(): void {
    return
  }
  getFriends(): Promise<FriendRoster> {
    return Promise.resolve({ friends: [], completeness: 'complete' })
  }
  getInstanceDetails(): Promise<never> {
    return Promise.reject(new Error('not implemented'))
  }
  buildJoinUrl(): string | null {
    return null
  }
  selfInvite(): Promise<void> {
    return Promise.resolve()
  }
  subscribe(): Unsubscribe {
    return () => {}
  }

  getAdmission(): ApiAdmissionController {
    return this.admission
  }

  // Expose the protected methods for testing.
  fetch<T>(url: string, schema: z.ZodType<T>, options?: RequestInit): Promise<T> {
    return this.request(url, schema, options)
  }
  raw(
    url: string,
    options?: RequestInit,
    requestOptions?: AdapterRequestOptions
  ): Promise<Response> {
    return this.rawRequest(url, options, requestOptions)
  }
  rawInteractive(url: string): Promise<Response> {
    return this.rawRequest(url, {}, { priority: 'interactive' })
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BaseAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('successful request', () => {
    it('returns Zod-validated data', async () => {
      fetchMock.mockResolvedValue(makeResponse(200, validBody))
      const result = await new TestAdapter().fetch('http://api/x', schema)
      expect(result).toEqual({ id: 1 })
    })

    it('resets consecutive failure count on success', async () => {
      fetchMock
        .mockResolvedValueOnce(makeResponse(500, {}))
        .mockResolvedValueOnce(makeResponse(200, validBody))
      const adapter = new TestAdapter()
      await expect(adapter.fetch('http://api/x', schema)).rejects.toBeInstanceOf(NetworkError)
      const result = await adapter.fetch('http://api/x', schema)
      expect(result).toEqual({ id: 1 })
    })

    it('uses the shared API timeout on every request', async () => {
      fetchMock.mockResolvedValue(makeResponse(200, validBody))
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

      await new TestAdapter().fetch('http://api/x', schema)

      expect(timeoutSpy).toHaveBeenCalledWith(API_TIMEOUT_MS)
    })
  })

  describe('rate limiting', () => {
    it('sleeps for the remaining interval on a back-to-back request', async () => {
      fetchMock.mockResolvedValue(makeResponse(200, validBody))
      const sleepSpy = vi.fn().mockResolvedValue(undefined)
      const adapter = new TestAdapter(sleepSpy)

      await adapter.fetch('http://api/x', schema)
      // Immediately fire a second request — elapsed ≈ 0ms, so sleep must be called.
      await adapter.fetch('http://api/x', schema)

      expect(sleepSpy).toHaveBeenCalledTimes(1)
      // elapsed ≈ 0ms on a fast machine → sleep ≈ (1000 - elapsed) + jitter(0–99).
      // Lower bound is 900 to absorb a few ms of real elapsed time between the two
      // fetch calls; upper is 1100 to cover the full jitter range.
      const [ms] = sleepSpy.mock.calls[0] as [number]
      expect(ms).toBeGreaterThan(900)
      expect(ms).toBeLessThanOrEqual(1_100)
    })

    it('reserves distinct slots for concurrent requests', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const dispatches: Array<{ url: string; at: number }> = []
      fetchMock.mockImplementation((url: string) => {
        dispatches.push({ url, at: Date.now() })
        return Promise.resolve(makeResponse(200, validBody))
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

      const requests = [
        adapter.fetch('http://api/1', schema),
        adapter.fetch('http://api/2', schema),
        adapter.fetch('http://api/3', schema)
      ]

      await vi.advanceTimersByTimeAsync(2_000)
      await expect(Promise.all(requests)).resolves.toEqual([validBody, validBody, validBody])
      expect(dispatches).toEqual([
        { url: 'http://api/1', at: 10_000 },
        { url: 'http://api/2', at: 11_000 },
        { url: 'http://api/3', at: 12_000 }
      ])
    })

    it('keeps concurrent slots one second apart when jitter varies', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.99).mockReturnValue(0)
      const dispatches: Array<{ url: string; at: number }> = []
      fetchMock.mockImplementation((url: string) => {
        dispatches.push({ url, at: Date.now() })
        return Promise.resolve(makeResponse(200, validBody))
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

      const requests = [
        adapter.fetch('http://api/1', schema),
        adapter.fetch('http://api/2', schema),
        adapter.fetch('http://api/3', schema)
      ]

      await vi.advanceTimersByTimeAsync(2_099)
      await Promise.all(requests)
      expect(dispatches).toEqual([
        { url: 'http://api/1', at: 10_000 },
        { url: 'http://api/2', at: 11_099 },
        { url: 'http://api/3', at: 12_099 }
      ])
    })

    it('admits an interactive request next while preserving default FIFO and the wire ceiling', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const dispatches: Array<{ url: string; at: number }> = []
      fetchMock.mockImplementation((url: string) => {
        dispatches.push({ url, at: Date.now() })
        return Promise.resolve(makeResponse(200, validBody))
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

      const background = [
        adapter.raw('http://api/background-1'),
        adapter.raw('http://api/background-2'),
        adapter.raw('http://api/background-3')
      ]
      const interactive = adapter.rawInteractive('http://api/interactive')

      await vi.advanceTimersByTimeAsync(0)
      expect(dispatches).toEqual([{ url: 'http://api/background-1', at: 10_000 }])

      await vi.advanceTimersByTimeAsync(1_000)
      expect(dispatches[1]).toEqual({ url: 'http://api/interactive', at: 11_000 })

      await vi.advanceTimersByTimeAsync(2_000)
      await expect(Promise.all([...background, interactive])).resolves.toHaveLength(4)
      expect(dispatches).toEqual([
        { url: 'http://api/background-1', at: 10_000 },
        { url: 'http://api/interactive', at: 11_000 },
        { url: 'http://api/background-2', at: 12_000 },
        { url: 'http://api/background-3', at: 13_000 }
      ])
      expect(
        dispatches.slice(1).every((entry, index) => entry.at - dispatches[index]!.at >= 1_000)
      ).toBe(true)
    })
  })

  describe('429 backoff', () => {
    it('discards cancelled response bodies without poisoning the circuit', async () => {
      const adapter = new TestAdapter()
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController()
        let release!: (body: unknown) => void
        let started = false
        const response = new Response(null)
        vi.spyOn(response, 'json').mockImplementation(() => {
          started = true
          return new Promise((resolve) => {
            release = resolve
          })
        })
        fetchMock.mockResolvedValueOnce(response)
        const request = adapter
          .fetch('http://api/read', schema, { signal: controller.signal })
          .catch((error: unknown) => error)
        await vi.waitFor(() => expect(started).toBe(true))
        controller.abort()
        release(validBody)
        expect(await request).toBeInstanceOf(RequestCancelledError)
      }
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(validBody)))
      await expect(adapter.fetch('http://api/current', schema)).resolves.toEqual(validBody)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })
    it('rechecks cooldown after permit resolution and before physical fetch', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      fetchMock.mockResolvedValue(new Response(null))
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      const request = adapter.raw('http://api/read')
      adapter.getAdmission().deferUntil(70_000)
      await vi.advanceTimersByTimeAsync(59_999)
      expect(fetchMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await request
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('cancels queued work before fetch and does not count cancellation as a circuit failure', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      fetchMock.mockImplementation(() => Promise.resolve(new Response(null)))
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      adapter.getAdmission().deferUntil(70_000)
      const controller = new AbortController()
      const reads = Array.from({ length: 3 }, () =>
        adapter
          .raw('http://api/obsolete', { signal: controller.signal })
          .catch((error: unknown) => error)
      )
      controller.abort()
      expect(
        (await Promise.all(reads)).every((error) => error instanceof RequestCancelledError)
      ).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
      const valid = adapter.raw('http://api/current')
      await vi.advanceTimersByTimeAsync(60_000)
      await valid
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('stops a no-retry operation on its first 429 and cancels the unused response body', async () => {
      const response = new Response('unused', { status: 429, headers: { 'Retry-After': '60' } })
      const cancel = vi.spyOn(response.body!, 'cancel')
      fetchMock.mockResolvedValue(response)
      const adapter = new TestAdapter()
      await expect(adapter.raw('http://api/roster', {}, { retry: 'none' })).rejects.toBeInstanceOf(
        RateLimitError
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(adapter.getAdmission().cooldownRemainingMs).toBeGreaterThan(59_000)
    })

    it('does not dispatch queued batch requests after a zero-delay 429', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const starts: Array<{ url: string; at: number }> = []
      fetchMock.mockImplementation((url: string) => {
        starts.push({ url, at: Date.now() })
        return Promise.resolve(
          url.endsWith('/batch/0')
            ? new Response(null, { status: 429, headers: { 'Retry-After': '0' } })
            : new Response(null)
        )
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      const batch = Array.from({ length: 4 }, (_, i) =>
        adapter.raw(`http://api/batch/${i}`, {}, { retry: 'none' }).catch((error: unknown) => error)
      )
      const explicit = adapter.raw('http://api/explicit', {}, { priority: 'interactive' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect((await Promise.all(batch)).every((error) => error instanceof RateLimitError)).toBe(
        true
      )
      await explicit
      expect(starts).toEqual([
        { url: 'http://api/batch/0', at: 10_000 },
        { url: 'http://api/explicit', at: 11_000 }
      ])
    })

    it.each(['0', 'Thu, 01 Jan 1970 00:00:11 GMT', '1'])(
      'revokes a just-resolved batch permit after Retry-After %s before fetch',
      async (retryAfter) => {
        let now = 10_000
        let releaseSleep!: () => void
        let releaseResponse!: (response: Response) => void
        const admission = new ApiAdmissionController({
          now: () => now,
          random: () => 0,
          sleep: (_ms, signal) =>
            new Promise((resolve, reject) => {
              const abort = (): void => reject(new RequestCancelledError())
              signal.addEventListener('abort', abort, { once: true })
              releaseSleep = () => {
                signal.removeEventListener('abort', abort)
                resolve()
              }
            })
        })
        const adapter = new TestAdapter(noopSleep, admission)
        const events: string[] = []
        fetchMock.mockImplementation((url: string) => {
          events.push(url)
          return url.endsWith('/first')
            ? new Promise((resolve) => {
                releaseResponse = resolve
              })
            : Promise.resolve(new Response(null))
        })
        const rateLimited = admission.rateLimited.bind(admission)
        vi.spyOn(admission, 'rateLimited').mockImplementation((header) => {
          events.push('429')
          expect(admission.pendingCount).toBe(0)
          return rateLimited(header)
        })
        const flush = async (): Promise<void> => {
          for (let i = 0; i < 20; i++) await Promise.resolve()
        }
        const first = adapter
          .raw('http://api/first', {}, { retry: 'none' })
          .catch((error: unknown) => error)
        await flush()
        const queued = adapter
          .raw('http://api/queued', {}, { retry: 'none' })
          .catch((error: unknown) => error)
        await flush()
        expect(admission.pendingCount).toBe(1)
        now = 11_000
        // Permit resolution queues its continuation before the first response's
        // 429 handler; that handler then runs before the actual second fetch.
        releaseSleep()
        releaseResponse(new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } }))
        await flush()
        expect(await first).toBeInstanceOf(RateLimitError)
        expect(await queued).toBeInstanceOf(RateLimitError)
        expect(events).toEqual(['http://api/first', '429'])
        now = 12_000
        await adapter.raw('http://api/fresh', {}, { retry: 'none' })
        expect(events).toEqual(['http://api/first', '429', 'http://api/fresh'])
      }
    )

    it('paces mixed REST and API-backed images through the same platform budget', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const starts: number[] = []
      fetchMock.mockImplementation(() => {
        starts.push(Date.now())
        return Promise.resolve(new Response('image', { headers: { 'Content-Type': 'image/png' } }))
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      const images = new AvatarCache({ fetchFn: fetch, apiAdmission: adapter.getAdmission() })

      const rest = adapter.raw('https://api.vrchat.cloud/api/1/auth/user')
      const image = images.get('https://api.vrchat.cloud/api/1/image/file_a/1/256')
      await vi.advanceTimersByTimeAsync(999)
      expect(starts).toEqual([10_000])
      await vi.advanceTimersByTimeAsync(1)
      await Promise.all([rest, image])
      expect(starts).toEqual([10_000, 11_000])
    })

    it('holds queued API images during a REST Retry-After cooldown', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const starts: Array<{ url: string; at: number }> = []
      fetchMock.mockImplementation((url: string) => {
        starts.push({ url, at: Date.now() })
        return Promise.resolve(
          starts.length === 1
            ? new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
            : new Response('image', { headers: { 'Content-Type': 'image/png' } })
        )
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      const images = new AvatarCache({ fetchFn: fetch, apiAdmission: adapter.getAdmission() })
      const rest = adapter.raw('https://api.vrchat.cloud/api/1/auth/user')
      await vi.advanceTimersByTimeAsync(0)
      const image = images.get('https://api.vrchat.cloud/api/1/image/file_a/1/256')
      await vi.advanceTimersByTimeAsync(59_999)
      expect(starts).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(2_001)
      await Promise.all([rest, image])
      expect(starts.slice(1).every(({ at }) => at >= 70_000)).toBe(true)
      expect(starts[2]!.at - starts[1]!.at).toBeGreaterThanOrEqual(1_000)
    })

    it('holds REST and distinct image URLs after an API image returns 429', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const starts: number[] = []
      fetchMock.mockImplementation(() => {
        starts.push(Date.now())
        return Promise.resolve(
          starts.length === 1
            ? new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
            : new Response('image', { headers: { 'Content-Type': 'image/png' } })
        )
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      const images = new AvatarCache({ fetchFn: fetch, apiAdmission: adapter.getAdmission() })
      await images.get('https://api.vrchat.cloud/api/1/image/file_a/1/256')
      const rest = adapter.raw('https://api.vrchat.cloud/api/1/auth/user')
      const image = images.get('https://api.vrchat.cloud/api/1/image/file_b/1/256')
      await vi.advanceTimersByTimeAsync(59_999)
      expect(starts).toEqual([10_000])
      await vi.advanceTimersByTimeAsync(1_001)
      await Promise.all([rest, image])
      expect(starts).toEqual([10_000, 70_000, 71_000])
    })

    it('keeps an earlier reserved retry behind a cooldown extended by a later 429', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const dispatches: Array<{ url: string; at: number }> = []
      const attempts = new Map<string, number>()
      fetchMock.mockImplementation((url: string) => {
        dispatches.push({ url, at: Date.now() })
        const attempt = (attempts.get(url) ?? 0) + 1
        attempts.set(url, attempt)
        if (attempt > 1) return Promise.resolve(makeResponse(200, validBody))

        const delay = url.endsWith('/a') ? 2_000 : 1_500
        const retryAfter = url.endsWith('/a') ? '2' : '5'
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(makeResponse(429, {}, { 'retry-after': retryAfter })), delay)
        })
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

      const requestA = adapter.fetch('http://api/a', schema)
      const requestB = adapter.fetch('http://api/b', schema)

      // A: wire t=10s, 429 t=12s, initially reserves retry t=14s.
      // B: wire t=11s, 429 t=12.5s, extends the shared cooldown to t=17.5s.
      await vi.advanceTimersByTimeAsync(7_499)
      expect(dispatches).toEqual([
        { url: 'http://api/a', at: 10_000 },
        { url: 'http://api/b', at: 11_000 }
      ])

      await vi.advanceTimersByTimeAsync(1_001)
      await expect(Promise.all([requestA, requestB])).resolves.toEqual([validBody, validBody])
      expect(dispatches).toEqual([
        { url: 'http://api/a', at: 10_000 },
        { url: 'http://api/b', at: 11_000 },
        { url: 'http://api/a', at: 17_500 },
        { url: 'http://api/b', at: 18_500 }
      ])
    })

    it('recomputes a queued admission after a fast 429 moves the schedule during sleep', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random')
        // Initial admission: the queued waiter starts sleeping until t=11_099.
        .mockReturnValueOnce(0.99)
        // Fast 429 at t=10_050: server cooldown ends at t=11_050, but
        // the previous attempt's full paced slot still ends at t=11_099.
        .mockReturnValueOnce(0)
        // The retry's own interval+jitter holds new work until t=12_198.
        .mockReturnValueOnce(0.99)
        // Queued admission jitter after the dispatcher recomputes.
        .mockReturnValue(0)
      const dispatches: Array<{ url: string; at: number }> = []
      let firstAttempt = true
      fetchMock.mockImplementation((url: string) => {
        dispatches.push({ url, at: Date.now() })
        if (url === 'http://api/limited' && firstAttempt) {
          firstAttempt = false
          return new Promise<Response>((resolve) => {
            setTimeout(() => resolve(makeResponse(429, {})), 50)
          })
        }
        return Promise.resolve(makeResponse(200, validBody))
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

      const limited = adapter.fetch('http://api/limited', schema)
      const queued = adapter.fetch('http://api/queued', schema)

      await vi.advanceTimersByTimeAsync(2_198)
      await expect(Promise.all([limited, queued])).resolves.toEqual([validBody, validBody])
      expect(dispatches).toEqual([
        { url: 'http://api/limited', at: 10_000 },
        { url: 'http://api/limited', at: 11_099 },
        { url: 'http://api/queued', at: 12_198 }
      ])
      expect(
        dispatches.slice(1).every((entry, index) => entry.at - dispatches[index]!.at >= 1_000)
      ).toBe(true)
    })

    it('pauses and reorders already queued requests behind a shared cooldown', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const dispatches: Array<{ url: string; at: number }> = []
      fetchMock.mockImplementation((url: string) => {
        dispatches.push({ url, at: Date.now() })
        return Promise.resolve(
          dispatches.length === 1
            ? makeResponse(429, {}, { 'retry-after': '5' })
            : makeResponse(200, validBody)
        )
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

      const requests = [
        adapter.fetch('http://api/1', schema),
        adapter.fetch('http://api/2', schema),
        adapter.fetch('http://api/3', schema)
      ]
      await vi.advanceTimersByTimeAsync(4_999)

      expect(dispatches).toEqual([{ url: 'http://api/1', at: 10_000 }])

      await vi.advanceTimersByTimeAsync(3_001)
      await expect(Promise.all(requests)).resolves.toEqual([validBody, validBody, validBody])
      expect(dispatches).toEqual([
        { url: 'http://api/1', at: 10_000 },
        { url: 'http://api/1', at: 15_000 },
        { url: 'http://api/2', at: 16_000 },
        { url: 'http://api/3', at: 17_000 }
      ])
    })

    it('retries once after Retry-After header and succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(makeResponse(429, {}, { 'retry-after': '2' }))
        .mockResolvedValueOnce(makeResponse(200, validBody))
      const sleepSpy = vi.fn().mockResolvedValue(undefined)

      const result = await new TestAdapter(sleepSpy).fetch('http://api/x', schema)
      expect(result).toEqual({ id: 1 })
      // Sleep called at least once for the Retry-After delay (≥2000ms) plus jitter.
      const retrySleep = (sleepSpy.mock.calls as [number][]).find(([ms]) => ms >= 2_000)
      expect(retrySleep).toBeDefined()
    })

    it('parses an HTTP-date Retry-After value against the dispatch clock', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-20T12:00:00.000Z'))
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const dispatchTimes: number[] = []
      fetchMock.mockImplementation(() => {
        dispatchTimes.push(Date.now())
        return Promise.resolve(
          dispatchTimes.length === 1
            ? makeResponse(429, {}, { 'retry-after': 'Sat, 20 Jun 2026 12:00:04 GMT' })
            : makeResponse(200, validBody)
        )
      })
      const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

      const request = adapter.fetch('http://api/x', schema)
      await vi.advanceTimersByTimeAsync(3_999)
      expect(dispatchTimes).toEqual([Date.parse('2026-06-20T12:00:00.000Z')])

      await vi.advanceTimersByTimeAsync(1)
      await expect(request).resolves.toEqual(validBody)
      expect(dispatchTimes).toEqual([
        Date.parse('2026-06-20T12:00:00.000Z'),
        Date.parse('2026-06-20T12:00:04.000Z')
      ])
    })

    it.each(['invalid', '-1', '2 seconds'])(
      'uses bounded fallback backoff for malformed Retry-After %j',
      async (retryAfter) => {
        vi.useFakeTimers()
        vi.setSystemTime(10_000)
        vi.spyOn(Math, 'random').mockReturnValue(0)
        const dispatchTimes: number[] = []
        fetchMock.mockImplementation(() => {
          dispatchTimes.push(Date.now())
          return Promise.resolve(
            dispatchTimes.length === 1
              ? makeResponse(429, {}, { 'retry-after': retryAfter })
              : makeResponse(200, validBody)
          )
        })
        const adapter = new TestAdapter((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

        const request = adapter.fetch('http://api/x', schema)
        await vi.advanceTimersByTimeAsync(999)
        expect(dispatchTimes).toEqual([10_000])

        await vi.advanceTimersByTimeAsync(1)
        await expect(request).resolves.toEqual(validBody)
        expect(dispatchTimes).toEqual([10_000, 11_000])
      }
    )

    it('retries with exponential backoff when no Retry-After header', async () => {
      fetchMock
        .mockResolvedValueOnce(makeResponse(429, {}))
        .mockResolvedValueOnce(makeResponse(200, validBody))
      const sleepSpy = vi.fn().mockResolvedValue(undefined)

      await new TestAdapter(sleepSpy).fetch('http://api/x', schema)
      // First retry: BASE (1000) * 2^0 = 1000 + jitter. Must be ≥1000ms.
      const retrySleep = (sleepSpy.mock.calls as [number][]).find(([ms]) => ms >= 1_000)
      expect(retrySleep).toBeDefined()
    })

    it('throws RateLimitError after MAX retries exhausted', async () => {
      // 4 consecutive 429s exhaust MAX_429_RETRIES=3 (retry counts 0→3).
      fetchMock.mockResolvedValue(makeResponse(429, {}))
      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toBeInstanceOf(
        RateLimitError
      )
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('reports the effective final fallback delay when retries are exhausted', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      fetchMock.mockResolvedValue(makeResponse(429, {}))

      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toMatchObject({
        retryAfterMs: 8_000
      })
    })

    it('does not count 429 exhaustion toward the circuit breaker', async () => {
      // 3× rate-limit exhaustions must NOT open the circuit.
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      fetchMock.mockResolvedValue(makeResponse(429, {}))
      const adapter = new TestAdapter((ms) => {
        vi.setSystemTime(Date.now() + ms)
        return Promise.resolve()
      })
      for (let i = 0; i < 3; i++) {
        await expect(adapter.fetch('http://api/x', schema)).rejects.toBeInstanceOf(RateLimitError)
      }
      fetchMock.mockResolvedValue(makeResponse(200, validBody))
      const result = await adapter.fetch('http://api/x', schema)
      expect(result).toEqual({ id: 1 })
    })
  })

  describe('circuit breaker', () => {
    it('opens after 3 consecutive non-429 failures', async () => {
      fetchMock.mockResolvedValue(makeResponse(500, {}))
      const adapter = new TestAdapter()

      for (let i = 0; i < 3; i++) {
        await expect(adapter.fetch('http://api/x', schema)).rejects.toBeInstanceOf(NetworkError)
      }

      // 4th attempt must fail fast (circuit open) without calling fetch again.
      const callsBefore = fetchMock.mock.calls.length
      await expect(adapter.fetch('http://api/x', schema)).rejects.toThrow('Circuit open')
      expect(fetchMock.mock.calls.length).toBe(callsBefore)
    })

    it('resets after a successful request', async () => {
      fetchMock
        .mockResolvedValueOnce(makeResponse(500, {}))
        .mockResolvedValueOnce(makeResponse(500, {}))
        .mockResolvedValueOnce(makeResponse(200, validBody)) // success → counter resets
        .mockResolvedValueOnce(makeResponse(200, validBody))

      const adapter = new TestAdapter()
      await expect(adapter.fetch('http://api/x', schema)).rejects.toBeInstanceOf(NetworkError)
      await expect(adapter.fetch('http://api/x', schema)).rejects.toBeInstanceOf(NetworkError)
      await expect(adapter.fetch('http://api/x', schema)).resolves.toEqual({ id: 1 })
      // Counter reset — next request must reach the network normally.
      await expect(adapter.fetch('http://api/x', schema)).resolves.toEqual({ id: 1 })
    })

    // ── 2026-07 audit W6 ─────────────────────────────────────────────────────

    it('closes again after CIRCUIT_RESET_MS elapses (time reset)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(10_000)
      fetchMock.mockResolvedValue(makeResponse(500, {}))
      const adapter = new TestAdapter()

      for (let i = 0; i < 3; i++) {
        await expect(adapter.fetch('http://api/x', schema)).rejects.toBeInstanceOf(NetworkError)
      }
      // Open: fails fast without a network call.
      const callsWhileOpen = fetchMock.mock.calls.length
      await expect(adapter.fetch('http://api/x', schema)).rejects.toThrow('Circuit open')
      expect(fetchMock.mock.calls.length).toBe(callsWhileOpen)

      // 60s later the breaker must let a probe through to the network again.
      vi.setSystemTime(10_000 + 60_000)
      fetchMock.mockResolvedValue(makeResponse(200, validBody))
      await expect(adapter.fetch('http://api/x', schema)).resolves.toEqual({ id: 1 })
      expect(fetchMock.mock.calls.length).toBe(callsWhileOpen + 1)
    })

    it('rawRequest 401s do NOT trip the circuit (auth flows stay unlocked)', async () => {
      // rawRequest returns statuses uninterpreted — only a thrown fetch records
      // a failure. Repeated wrong-password 401s must never open the breaker
      // (the VrcAdapter-level regression, pinned here at the engine level).
      fetchMock.mockResolvedValue(makeResponse(401, {}))
      const adapter = new TestAdapter()

      for (let i = 0; i < 5; i++) {
        const res = await adapter.raw('http://api/auth')
        expect(res.status).toBe(401)
      }
      // All five reached the network — no fail-fast in the sequence.
      expect(fetchMock.mock.calls.length).toBe(5)
      // And the typed path still works right after (counter untouched).
      fetchMock.mockResolvedValue(makeResponse(200, validBody))
      await expect(adapter.fetch('http://api/x', schema)).resolves.toEqual({ id: 1 })
    })
  })

  describe('error classification', () => {
    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue(makeResponse(401, {}))
      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toBeInstanceOf(
        AuthError
      )
    })

    it('throws AuthError on 403', async () => {
      fetchMock.mockResolvedValue(makeResponse(403, {}))
      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toBeInstanceOf(
        AuthError
      )
    })

    it('throws NetworkError on 5xx', async () => {
      fetchMock.mockResolvedValue(makeResponse(503, {}))
      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toBeInstanceOf(
        NetworkError
      )
    })

    it('throws NetworkError when fetch itself rejects', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toBeInstanceOf(
        NetworkError
      )
    })

    it('throws NetworkError when Zod schema rejects the response shape', async () => {
      fetchMock.mockResolvedValue(makeResponse(200, { id: 'not-a-number' }))
      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toBeInstanceOf(
        NetworkError
      )
    })

    it('throws NetworkError when response body is not valid JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.reject(new SyntaxError('Unexpected token'))
      })
      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toBeInstanceOf(
        NetworkError
      )
    })
  })
})
