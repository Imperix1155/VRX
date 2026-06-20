import type { z } from 'zod'
import type { Platform } from '@shared/types'
import { VRC_API_BASE } from '@shared/constants'
import { BaseAdapter } from './BaseAdapter'

/**
 * VRChat-required User-Agent. VRChat rate-limits / blocks clients without a
 * descriptive UA carrying contact info. Hardened/finalized in VRX-129; the
 * contact is the public repo (no personal info).
 */
export const VRC_USER_AGENT = 'VRX/0.1.0 (https://github.com/Imperix1155/VRX)' as const

/**
 * Low-level VRChat API client (VRX-41) — the typed HTTP layer every VRChat
 * adapter method builds on. Sits between the rate-limited request engine
 * (`BaseAdapter`, VRX-17) and the concrete `VrcAdapter` (login/getFriends/…,
 * later issues):
 *
 *   BaseAdapter  → request<T>: rate limit, timeout, redirect:'error', 429
 *                  backoff, Zod validation, circuit breaker, typed errors
 *   VrcApiClient → get/post against VRC_API_BASE with the auth cookie +
 *                  User-Agent attached (THIS class)
 *   VrcAdapter   → the IPlatformAdapter methods (extends this; later)
 *
 * Abstract: it leaves the `IPlatformAdapter` methods for `VrcAdapter`. The auth
 * cookie is held in memory only and set after login (VRX-42); this class does
 * not acquire it.
 */
export abstract class VrcApiClient extends BaseAdapter {
  readonly platform: Platform = 'vrchat'

  private authCookie: string | null = null

  /** Set (or clear) the VRChat `auth` session cookie sent on every request. */
  protected setAuthCookie(cookie: string | null): void {
    this.authCookie = cookie
  }

  /** GET `path` (relative to VRC_API_BASE), validated against `schema`. */
  protected get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request(VRC_API_BASE + path, schema, {
      method: 'GET',
      headers: this.headers()
    })
  }

  /** POST `body` as JSON to `path` (relative to VRC_API_BASE), validated against `schema`. */
  protected post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.request(VRC_API_BASE + path, schema, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    })
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const base: Record<string, string> = { 'User-Agent': VRC_USER_AGENT }
    if (this.authCookie) base['Cookie'] = this.authCookie
    return { ...base, ...extra }
  }
}
