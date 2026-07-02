/**
 * Shared adapter-test fixtures (2026-07 audit W6) — kills the noopSleep /
 * json-Response / adapter-stub copies that had drifted across the adapter and
 * IPC test files. TEST-ONLY: imported exclusively from *.test.ts files; never
 * ship this from production code.
 */
import { vi } from 'vitest'
import type { IPlatformAdapter } from '../IPlatformAdapter'

/** Instant sleep — skips the rate-limiter's real timers in unit tests. */
export const noopSleep = (): Promise<void> => Promise.resolve()

export interface JsonResponseOpts {
  status?: number
  /** Each entry becomes a Set-Cookie header (exercises headers.getSetCookie()). */
  setCookies?: string[]
}

/**
 * Build a REAL `Response` (not a shape-alike) so header semantics, single-use
 * bodies, and `getSetCookie()` behave exactly as in production. Accepts either
 * a bare status (`jsonResponse(body, 401)`) or an options object
 * (`jsonResponse(body, { status: 200, setCookies: ['auth=x'] })`).
 */
export function jsonResponse(
  body: unknown,
  statusOrOpts: number | JsonResponseOpts = {}
): Response {
  const opts = typeof statusOrOpts === 'number' ? { status: statusOrOpts } : statusOrOpts
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of opts.setCookies ?? []) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(body), { status: opts.status ?? 200, headers })
}

/**
 * A full `IPlatformAdapter` of `vi.fn()`s with benign defaults — for tests that
 * exercise code AROUND an adapter (IPC handlers, registries) rather than the
 * adapter itself. Override the members under test.
 */
export function stubPlatformAdapter(overrides: Partial<IPlatformAdapter> = {}): IPlatformAdapter {
  return {
    platform: 'vrchat',
    getAuthStatus: vi
      .fn()
      .mockResolvedValue({ platform: 'vrchat', state: 'unauthenticated', displayName: null }),
    login: vi.fn().mockResolvedValue({ ok: true }),
    verify2fa: vi.fn().mockResolvedValue({ ok: true }),
    importSession: vi.fn().mockResolvedValue(false),
    getFriends: vi.fn().mockResolvedValue([]),
    getInstanceDetails: vi.fn(),
    joinInstance: vi.fn().mockResolvedValue(undefined),
    selfInvite: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    ...overrides
  } as IPlatformAdapter
}
