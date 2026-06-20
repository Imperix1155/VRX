import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { API_TIMEOUT_MS } from '@shared/constants'
import type { AuthStatus, Friend, LoginResult, Platform } from '@shared/types'
import type { Unsubscribe } from './IPlatformAdapter'
import { BaseAdapter } from './BaseAdapter'
import { AuthError, NetworkError, RateLimitError } from './errors'

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
const noopSleep = (): Promise<void> => Promise.resolve()

// ── TestAdapter ───────────────────────────────────────────────────────────────

// Minimal concrete subclass used only for testing the base infrastructure.
class TestAdapter extends BaseAdapter {
  readonly platform: Platform = 'vrchat'

  // Explicit public constructor so tests can call `new TestAdapter(sleepFn)`
  // from outside the class hierarchy (BaseAdapter's constructor is protected).
  constructor(sleepFn: (ms: number) => Promise<void> = noopSleep) {
    super(sleepFn)
  }

  getAuthStatus(): Promise<AuthStatus> {
    return Promise.resolve({ platform: 'vrchat', state: 'unauthenticated', displayName: null })
  }
  login(): Promise<LoginResult> {
    return Promise.resolve({ ok: true })
  }
  importSession(): Promise<boolean> {
    return Promise.resolve(false)
  }
  getFriends(): Promise<Friend[]> {
    return Promise.resolve([])
  }
  getInstanceDetails(): Promise<never> {
    return Promise.reject(new Error('not implemented'))
  }
  joinInstance(): Promise<void> {
    return Promise.resolve()
  }
  selfInvite(): Promise<void> {
    return Promise.resolve()
  }
  subscribe(): Unsubscribe {
    return () => {}
  }

  // Expose the protected method for testing.
  fetch<T>(url: string, schema: z.ZodType<T>, options?: RequestInit): Promise<T> {
    return this.request(url, schema, options)
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
      fetchMock.mockResolvedValue(makeResponse(200, validBody))
      vi.spyOn(Date, 'now').mockReturnValue(10_000)
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const sleepResolvers: Array<() => void> = []
      const sleepSpy = vi.fn<(ms: number) => Promise<void>>(
        () => new Promise<void>((resolve) => sleepResolvers.push(resolve))
      )
      const adapter = new TestAdapter(sleepSpy)

      const requests = [
        adapter.fetch('http://api/1', schema),
        adapter.fetch('http://api/2', schema),
        adapter.fetch('http://api/3', schema)
      ]

      expect(sleepSpy).toHaveBeenCalledTimes(2)
      expect(sleepSpy.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000])

      for (const resolve of sleepResolvers) resolve()
      await expect(Promise.all(requests)).resolves.toEqual([validBody, validBody, validBody])
    })

    it('keeps concurrent slots one second apart when jitter varies', async () => {
      fetchMock.mockResolvedValue(makeResponse(200, validBody))
      vi.spyOn(Date, 'now').mockReturnValue(10_000)
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.99).mockReturnValue(0)
      const sleepResolvers: Array<() => void> = []
      const sleepSpy = vi.fn<(ms: number) => Promise<void>>(
        () => new Promise<void>((resolve) => sleepResolvers.push(resolve))
      )
      const adapter = new TestAdapter(sleepSpy)

      const requests = [
        adapter.fetch('http://api/1', schema),
        adapter.fetch('http://api/2', schema),
        adapter.fetch('http://api/3', schema)
      ]

      expect(sleepSpy.mock.calls.map(([ms]) => ms)).toEqual([1_099, 2_099])

      for (const resolve of sleepResolvers) resolve()
      await Promise.all(requests)
    })
  })

  describe('429 backoff', () => {
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
      } as unknown as Response)
      await expect(new TestAdapter().fetch('http://api/x', schema)).rejects.toBeInstanceOf(
        NetworkError
      )
    })
  })
})
