import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
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
  })

  describe('429 backoff', () => {
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

    it('does not count 429 exhaustion toward the circuit breaker', async () => {
      // 3× rate-limit exhaustions must NOT open the circuit.
      fetchMock.mockResolvedValue(makeResponse(429, {}))
      const adapter = new TestAdapter()
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
