import { z } from 'zod'
import { VRC_API_BASE } from '@shared/constants'
import type {
  AuthStatus,
  Credentials,
  Friend,
  InstanceInfo,
  LoginResult,
  TwoFactorMethod
} from '@shared/types'
import type { Unsubscribe } from './IPlatformAdapter'
import { NetworkError } from './errors'
import { VRC_USER_AGENT, VrcApiClient } from './VrcApiClient'
import { fetchFriends } from './vrchat/fetchFriends'
import { parseInstanceType } from './vrchat/parseInstanceType'

/**
 * Persistence for the VRChat session cookie (safeStorage-backed in production —
 * VRX-34). INJECTED so `VrcAdapter` stays electron-free and unit-testable; the
 * real store is wired at the call site when the adapter is registered.
 */
export interface VrcCredentialStore {
  load(): string | undefined
  save(cookie: string): void
}

/** Minimal current-user shape we rely on (the API returns much more). */
const currentUserSchema = z.object({ id: z.string(), displayName: z.string() })
/** The 2FA-required branch of `GET /auth/user`. */
const twoFactorRequiredSchema = z.object({ requiresTwoFactorAuth: z.array(z.string()).min(1) })
const authUserResponseSchema = z.union([twoFactorRequiredSchema, currentUserSchema])
/** VRChat's 2FA verify response — `verified` is the authoritative success signal. */
const twoFactorVerifySchema = z.object({ verified: z.boolean() })

/** VRChat Basic auth: `base64(urlencode(username):urlencode(password))`. */
function basicAuthHeader(username: string, password: string): string {
  const credential = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
  return `Basic ${Buffer.from(credential).toString('base64')}`
}

/** Pull a single cookie's `name=value` out of a `Set-Cookie` header list. */
function extractCookie(setCookies: string[], name: string): string | null {
  for (const raw of setCookies) {
    const match = raw.match(/^\s*([^=]+)=([^;]+)/)
    if (match && match[1].trim() === name) return `${name}=${match[2].trim()}`
  }
  return null
}

/** Map VRChat's `requiresTwoFactorAuth` values to our method (`emailOtp` → email, else authenticator). */
function mapTwoFactorMethod(types: string[]): TwoFactorMethod {
  return types.some((type) => type.toLowerCase() === 'emailotp') ? 'email' : 'totp'
}

/**
 * Concrete VRChat adapter (VRX-157) — direct login + 2FA + session restore.
 *
 * Auth calls use the inherited `rawRequest`, NOT `get`/`post`/`request<T>`, so a
 * wrong password is a clean `401` result — not an `AuthError` plus a circuit-
 * breaker lockout after 3 wrong attempts. Data methods (getFriends, …) are
 * scaffolded as not-yet-implemented and land in later issues (getFriends = VRX-43).
 */
export class VrcAdapter extends VrcApiClient {
  private cookie: string | null = null
  private displayName: string | null = null
  private pendingTwoFactorMethod: TwoFactorMethod | null = null

  constructor(
    private readonly credentials: VrcCredentialStore,
    sleepFn?: (ms: number) => Promise<void>
  ) {
    super(sleepFn)
    // Session restore — adopt any persisted cookie; tolerate a missing/locked store.
    try {
      const stored = this.credentials.load()
      if (stored) this.setCookie(stored)
    } catch {
      /* no usable persisted session */
    }
  }

  async login(creds: Credentials): Promise<LoginResult> {
    // Second leg of a 2FA flow: the renderer re-calls login with the code.
    if (creds.twoFactorCode) return this.verifyTwoFactor(creds.twoFactorCode)

    let response: Response
    try {
      response = await this.rawRequest(`${VRC_API_BASE}/auth/user`, {
        method: 'GET',
        headers: {
          Authorization: basicAuthHeader(creds.username, creds.password),
          'User-Agent': VRC_USER_AGENT
        }
      })
    } catch {
      return { ok: false, needs2fa: false, error: 'network_error' }
    }

    if (response.status === 401) return { ok: false, needs2fa: false, error: 'invalid_credentials' }
    if (!response.ok) return { ok: false, needs2fa: false, error: `http_${response.status}` }

    // The `auth` cookie is needed for the 2FA verify call AND the authed session.
    const authCookie = extractCookie(response.headers.getSetCookie(), 'auth')
    if (authCookie) this.setCookie(authCookie)

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { ok: false, needs2fa: false, error: 'bad_response' }
    }
    const parsed = authUserResponseSchema.safeParse(body)
    if (!parsed.success) return { ok: false, needs2fa: false, error: 'unexpected_response' }

    if ('requiresTwoFactorAuth' in parsed.data) {
      this.pendingTwoFactorMethod = mapTwoFactorMethod(parsed.data.requiresTwoFactorAuth)
      return { ok: false, needs2fa: true, method: this.pendingTwoFactorMethod }
    }

    this.displayName = parsed.data.displayName
    this.persist()
    return { ok: true }
  }

  /**
   * Second leg of a 2FA login (VRX-159): verify the code against the session
   * cookie from the initial `login()` call — no credentials needed, so the
   * renderer can drop the password from memory after the first leg.
   */
  verify2fa(code: string): Promise<LoginResult> {
    return this.verifyTwoFactor(code)
  }

  private async verifyTwoFactor(code: string): Promise<LoginResult> {
    const method = this.pendingTwoFactorMethod ?? 'totp'
    const endpoint =
      method === 'email' ? '/auth/twofactorauth/otp/verify' : '/auth/twofactorauth/totp/verify'

    let response: Response
    try {
      response = await this.rawRequest(`${VRC_API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          ...this.cookieHeader(),
          'User-Agent': VRC_USER_AGENT,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code })
      })
    } catch {
      return { ok: false, needs2fa: false, error: 'network_error' }
    }

    if (!response.ok) return { ok: false, needs2fa: false, error: 'invalid_2fa_code' }

    // Require VRChat's explicit `verified: true` — a 204, malformed body, or
    // `{ verified: false }` must NOT count as success (it would persist the partial
    // pre-2FA cookie and falsely report login). Stay retryable: don't clear the
    // pending method or persist anything on a failed verify.
    let verifyBody: unknown
    try {
      verifyBody = await response.json()
    } catch {
      return { ok: false, needs2fa: false, error: 'invalid_2fa_code' }
    }
    const verified = twoFactorVerifySchema.safeParse(verifyBody)
    if (!verified.success || !verified.data.verified) {
      return { ok: false, needs2fa: false, error: 'invalid_2fa_code' }
    }

    // Completing the second factor may re-issue the `auth` session token — prefer
    // the rotated one if present, else keep the cookie from the initial login.
    const setCookies = response.headers.getSetCookie()
    const authCookie = extractCookie(setCookies, 'auth') ?? this.cookie
    const twoFactorCookie = extractCookie(setCookies, 'twoFactorAuth')
    const combined = [authCookie, twoFactorCookie].filter((part): part is string => Boolean(part))
    if (combined.length) this.setCookie(combined.join('; '))
    this.pendingTwoFactorMethod = null

    await this.refreshDisplayName()
    this.persist()
    return { ok: true }
  }

  async getAuthStatus(): Promise<AuthStatus> {
    if (!this.cookie) return this.status('unauthenticated')

    let response: Response
    try {
      response = await this.rawRequest(`${VRC_API_BASE}/auth/user`, {
        method: 'GET',
        headers: { ...this.cookieHeader(), 'User-Agent': VRC_USER_AGENT }
      })
    } catch {
      return this.status('error')
    }
    if (response.status === 401) return this.status('unauthenticated')
    if (!response.ok) return this.status('error')

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return this.status('error')
    }
    const parsed = currentUserSchema.safeParse(body)
    if (!parsed.success) return this.status('unauthenticated')

    this.displayName = parsed.data.displayName
    return this.status('authenticated')
  }

  importSession(): Promise<boolean> {
    // VRCX session import lands in VRX-54.
    return Promise.resolve(false)
  }

  async getFriends(): Promise<Friend[]> {
    const { friends, failedPages } = await fetchFriends((path, schema) => this.get(path, schema))
    // If fetches failed AND we got nothing, surface an error rather than a
    // misleading empty list (the UI shows "couldn't load" instead of "no friends").
    // A partial result (some pages failed but others succeeded) is still returned
    // as graceful degradation; signalling partial failure to the UI is a follow-up.
    if (failedPages > 0 && friends.length === 0) {
      throw new NetworkError('Failed to fetch friends')
    }
    return friends
  }
  getInstanceDetails(): Promise<InstanceInfo> {
    return Promise.reject(new Error('VrcAdapter.getInstanceDetails not implemented'))
  }
  joinInstance(): Promise<void> {
    return Promise.reject(new Error('VrcAdapter.joinInstance not implemented'))
  }
  async selfInvite(instanceId: string): Promise<void> {
    // Public instances don't require an invite — the user can just join.
    if (parseInstanceType(instanceId) === 'public') {
      throw new Error('No invite needed for public instances')
    }

    // VRChat's location string is the full `worldId:nonce[~tags]` — send it raw.
    // The response is a Notification object; we discard it (returns void).
    // z.unknown() avoids breaking on benign API drift (VRChat Notification shape may change).
    await this.post(`/invite/myself/to/${instanceId}`, {}, z.unknown())
  }
  subscribe(): Unsubscribe {
    // Live WS stream is VRX-146.
    return () => {}
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private setCookie(cookie: string): void {
    this.cookie = cookie
    this.setAuthCookie(cookie) // sync to VrcApiClient for the authed get/post path
  }

  private cookieHeader(): Record<string, string> {
    return this.cookie ? { Cookie: this.cookie } : {}
  }

  private persist(): void {
    if (!this.cookie) return
    try {
      this.credentials.save(this.cookie)
    } catch {
      /* persistence is best-effort; the session still works in-memory this run */
    }
  }

  private async refreshDisplayName(): Promise<void> {
    try {
      const response = await this.rawRequest(`${VRC_API_BASE}/auth/user`, {
        method: 'GET',
        headers: { ...this.cookieHeader(), 'User-Agent': VRC_USER_AGENT }
      })
      if (!response.ok) return
      const parsed = currentUserSchema.safeParse(await response.json())
      if (parsed.success) this.displayName = parsed.data.displayName
    } catch {
      /* non-fatal */
    }
  }

  private status(state: AuthStatus['state']): AuthStatus {
    return {
      platform: 'vrchat',
      state,
      displayName: state === 'authenticated' ? this.displayName : null
    }
  }
}
