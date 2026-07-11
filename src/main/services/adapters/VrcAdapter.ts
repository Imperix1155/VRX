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
import type { AdapterEvent } from '@shared/types'
import { AuthError, NetworkError } from './errors'
import { VRC_USER_AGENT, VrcApiClient } from './VrcApiClient'
import { VrcPipeline, type PipelineSocket } from './vrchat/VrcPipeline'
import { fetchFriends } from './vrchat/fetchFriends'
import { fetchWorldMetadata } from './vrchat/fetchWorldMetadata'
import { parseInstanceType } from './vrchat/parseInstanceType'
import { WorldResolver } from './vrchat/WorldResolver'

/**
 * Persistence for the VRChat session cookie (safeStorage-backed in production —
 * VRX-34). INJECTED so `VrcAdapter` stays electron-free and unit-testable; the
 * real store is wired at the call site when the adapter is registered.
 */
export interface VrcCredentialStore {
  load(): string | undefined
  save(cookie: string): void
  /** Remove the persisted session so an expired cookie can't survive a restart. */
  delete(): void
}

export interface VrcLiveWiring {
  socketFactory?: (url: string) => PipelineSocket
  log?: (level: 'info' | 'warn' | 'debug', message: string, meta?: unknown) => void
  /** Main-process hook for clearing account-scoped consumers such as FriendAlerts. */
  onSessionBoundary?: () => void
}

/** Minimal current-user shape we rely on (the API returns much more). */
const currentUserSchema = z.object({ id: z.string(), displayName: z.string() })
/** The 2FA-required branch of `GET /auth/user`. */
const twoFactorRequiredSchema = z.object({ requiresTwoFactorAuth: z.array(z.string()).min(1) })
const authUserResponseSchema = z.union([twoFactorRequiredSchema, currentUserSchema])
/** VRChat's 2FA verify response — `verified` is the authoritative success signal. */
const twoFactorVerifySchema = z.object({ verified: z.boolean() })
/**
 * GET /auth response — exchanges the session cookie for the Pipeline token
 * (VRX-146). The token IS the authcookie value; the exchange verifies the
 * session server-side. Falls back to the raw cookie value if unavailable.
 */
const authTokenSchema = z.object({ token: z.string() })

/** VRChat Basic auth: `base64(urlencode(username):urlencode(password))`. */
function basicAuthHeader(username: string, password: string): string {
  const credential = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
  return `Basic ${Buffer.from(credential).toString('base64')}`
}

/** Pull a single cookie's `name=value` out of a `Set-Cookie` header list. */
function extractCookie(setCookies: string[], name: string): string | null {
  for (const raw of setCookies) {
    const match = raw.match(/^\s*([^=]+)=([^;]+)/)
    const key = match?.[1]
    const value = match?.[2]
    if (key !== undefined && value !== undefined && key.trim() === name) {
      return `${name}=${value.trim()}`
    }
  }
  return null
}

/**
 * Pull one `name=value` pair out of a COMBINED Cookie string
 * (`"auth=…; twoFactorAuth=…"`). Distinct from `extractCookie`, which reads
 * Set-Cookie response lines (first pair + attributes).
 */
function cookiePart(cookie: string | null, name: string): string | null {
  if (!cookie) return null
  // Tolerate ';' without the space — every internal producer joins with '; ',
  // but a stricter split here is free insurance against a drifted blob.
  return cookie.split(/;\s*/).find((part) => part.startsWith(`${name}=`)) ?? null
}

/** Map VRChat's `requiresTwoFactorAuth` values to our method (`emailOtp` → email, else authenticator). */
function mapTwoFactorMethod(types: string[]): TwoFactorMethod {
  return types.some((type) => type.toLowerCase() === 'emailotp') ? 'email' : 'totp'
}

/**
 * A well-formed VRChat instance location: `wrld_<id>:<instance>[~tags]`. Validated
 * BEFORE the value is interpolated into a request URL path so a crafted instanceId
 * can't carry URL-structural characters (`/ ? # \`), whitespace, or control chars
 * and rewrite the authenticated request path (VRX-51 security review). The instance
 * segment legitimately contains `~ ( ) :` — none URL-structural in a path segment —
 * so a denylist of structural characters preserves valid locations.
 */
function isInstanceLocation(location: string): boolean {
  return /^wrld_[A-Za-z0-9_-]+:[^/?#\\\s]+$/.test(location)
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
  private sessionGeneration = 0
  /** Single resolver instance — TTL cache persists across getFriends calls (VRX-163). */
  private readonly worldResolver = new WorldResolver((worldId) =>
    this.get(`/worlds/${worldId}`, z.unknown())
  )

  // ── Live pipeline state (VRX-146) ──────────────────────────────────────────
  private pipeline: VrcPipeline | null = null
  private readonly subscribers = new Set<(event: AdapterEvent) => void>()

  constructor(
    private readonly credentials: VrcCredentialStore,
    sleepFn?: (ms: number) => Promise<void>,
    /**
     * Live-pipeline wiring (VRX-146), injected at the call site so this file
     * stays electron-free: the real socketFactory (ws + User-Agent) and the
     * electron-log bridge live in main/index.ts; tests inject fakes.
     */
    private readonly live?: VrcLiveWiring
  ) {
    super(sleepFn)
    // Session restore — adopt any persisted cookie; tolerate a missing/locked store.
    try {
      const stored = this.credentials.load()
      if (stored) this.adoptSession(stored)
    } catch {
      /* no usable persisted session */
    }
  }

  async login(creds: Credentials): Promise<LoginResult> {
    // Second leg of a 2FA flow: the renderer re-calls login with the code.
    if (creds.twoFactorCode) return this.verifyTwoFactor(creds.twoFactorCode)

    // A deliberate login must always reach the wire — background data-call
    // failures can open the shared breaker and fast-fail this as a network
    // error for the 60s window even with correct credentials. Platform parity
    // with CvrAdapter.login (VRX-190; gap caught by CodeRabbit on VRX-189).
    this.resetCircuit()

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
    // Installing it replaces the account boundary immediately — including when
    // the body below says 2FA is still required. Fence and replace the old
    // account's pipeline before returning control to the renderer's 2FA prompt.
    const authCookie = extractCookie(response.headers.getSetCookie(), 'auth')
    if (authCookie) {
      this.setCookie(authCookie)
      this.displayName = null
      this.pendingTwoFactorMethod = null
      this.bumpSessionGeneration()
    }

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
    // A response without a replacement cookie still completed a deliberate
    // login, so preserve the established successful-login boundary behavior.
    if (!authCookie) this.bumpSessionGeneration()
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
    // the rotated one if present, else keep the auth PART of the current cookie.
    // The part-extraction matters for the reprompt flow (VRX-173): a restored
    // session cookie is the combined "auth=…; twoFactorAuth=<stale>" string, and
    // falling back to it whole would rebuild a cookie with DUPLICATE twoFactorAuth
    // parts — the stale one winning server-side → an endless reprompt loop.
    const setCookies = response.headers.getSetCookie()
    const authCookie = extractCookie(setCookies, 'auth') ?? cookiePart(this.cookie, 'auth')
    const twoFactorCookie = extractCookie(setCookies, 'twoFactorAuth')
    const combined = [authCookie, twoFactorCookie].filter((part): part is string => Boolean(part))
    if (combined.length) this.setCookie(combined.join('; '))
    this.pendingTwoFactorMethod = null

    // A failed refresh must not expose an own-account name cached before this
    // 2FA boundary (including a name from a different prior account).
    this.displayName = null
    this.bumpSessionGeneration()
    await this.refreshDisplayName()
    this.persist()
    return { ok: true }
  }

  async getAuthStatus(): Promise<AuthStatus> {
    for (;;) {
      if (!this.cookie) return this.status('unauthenticated')
      const generation = this.sessionGeneration

      let response: Response
      try {
        response = await this.rawRequest(
          `${VRC_API_BASE}/auth/user`,
          {
            method: 'GET',
            headers: { ...this.cookieHeader(), 'User-Agent': VRC_USER_AGENT }
          },
          { recordCircuitFailure: false }
        )
      } catch {
        // A replacement session landed while the request was in flight: retry
        // against it. A logout landed instead: report the current logged-out state.
        if (generation !== this.sessionGeneration) {
          if (this.cookie) continue
          return this.status('unauthenticated')
        }
        return this.status('error')
      }
      // Fence every response outcome before it can describe or mutate the current
      // session. In particular, an old 401 must never clear a newly logged-in user.
      if (generation !== this.sessionGeneration) {
        if (this.cookie) continue
        return this.status('unauthenticated')
      }

      // The cookie WE SENT was rejected — the session is dead. Clear it everywhere
      // (memory, VrcApiClient mirror, persisted blob) so session restore can't
      // re-adopt it on the next launch and 401 forever.
      if (response.status === 401) {
        this.invalidateSession()
        return this.status('unauthenticated')
      }
      if (!response.ok) return this.status('error')

      let body: unknown
      try {
        body = await response.json()
      } catch {
        if (generation !== this.sessionGeneration) {
          if (this.cookie) continue
          return this.status('unauthenticated')
        }
        return this.status('error')
      }
      // response.json() is another account-boundary await: fence it before
      // updating displayName or the pending 2FA method.
      if (generation !== this.sessionGeneration) {
        if (this.cookie) continue
        return this.status('unauthenticated')
      }

      // The union covers BOTH branches VRChat returns on 200: the current user, or
      // `requiresTwoFactorAuth` when the auth cookie is alive but the twoFactorAuth
      // cookie expired (~weeks). The latter must NOT read as plain unauthenticated —
      // the session is recoverable with just a code, no password (VRX-173).
      const parsed = authUserResponseSchema.safeParse(body)
      if (!parsed.success) return this.status('unauthenticated')

      if ('requiresTwoFactorAuth' in parsed.data) {
        // Remember the method so a verify2fa() from the reprompt hits the right
        // endpoint (email OTP vs TOTP) — login() isn't part of this flow.
        this.pendingTwoFactorMethod = mapTwoFactorMethod(parsed.data.requiresTwoFactorAuth)
        return this.status('needs-2fa', this.pendingTwoFactorMethod)
      }

      this.displayName = parsed.data.displayName
      return this.status('authenticated')
    }
  }

  importSession(): Promise<boolean> {
    // VRCX session import lands in VRX-54.
    return Promise.resolve(false)
  }

  /** Fan an event out to all live subscribers — one throwing handler must not
   *  starve the others. Used by the pipeline AND for out-of-band signals like
   *  `auth-invalidated` (VRX-195). */
  private emit(event: AdapterEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event)
      } catch (err) {
        this.live?.log?.('warn', 'vrc adapter: subscriber threw', {
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  async getFriends(): Promise<Friend[]> {
    for (;;) {
      const generation = this.sessionGeneration
      try {
        const { friends, failedPages, skippedRecords } = await fetchFriends((path, schema) =>
          this.get(path, schema)
        )
        // If anything failed (page fetches OR schema-drifted records) AND we got
        // nothing, surface an error rather than a misleading empty list (the UI shows
        // "couldn't load" instead of "no friends"). A partial result is still returned
        // as graceful degradation; signalling partial failure to the UI is a follow-up.
        if ((failedPages > 0 || skippedRecords > 0) && friends.length === 0) {
          // Carry both counters so logs can tell transport failure from pure schema
          // drift (failedPages=0, skippedRecords>0 means the wire was fine).
          throw new NetworkError(
            `Failed to fetch friends (failedPages=${failedPages}, skippedRecords=${skippedRecords})`
          )
        }

        // Enrich friends with world names via the shared resolver (VRX-163).
        // fetchWorldMetadata deduplicates ids and degrades non-auth failures to null,
        // so a world-resolution failure does NOT break the friend list — friends are
        // returned as-is with worldName/thumbnailUrl staying null. A dead-session
        // AuthError DOES propagate here (WorldResolver rethrows it) so it reaches the
        // catch below and emits auth-invalidated (VRX-197).
        const worlds = await fetchWorldMetadata(
          friends.map((f) => f.instance?.worldId ?? null),
          this.worldResolver
        )
        for (const friend of friends) {
          if (friend.instance) {
            const meta = worlds.get(friend.instance.worldId)
            friend.instance.worldName = meta?.name ?? null
            friend.instance.thumbnailUrl = meta?.thumbnailUrl ?? null
          }
        }

        // A different account landed while this roster was in flight. Never
        // return the old account's success: retry a replacement session, but
        // abort when logout left no session to retry.
        if (generation !== this.sessionGeneration) {
          if (this.cookie) continue
          throw new Error('Session ended')
        }
        return friends
      } catch (error) {
        // Staleness is checked before auth invalidation or any other outcome.
        // The old account's failure is irrelevant to a replacement session; a
        // completed logout aborts instead of manufacturing a second auth failure.
        if (generation !== this.sessionGeneration) {
          if (this.cookie) continue
          throw new Error('Session ended')
        }

        // A data-path 401 ANYWHERE in the fetch — the /auth/user buckets probe, a
        // friend page, OR world-name enrichment — means the cookie is dead/2FA-
        // expired. One emit point for the whole flow: signal the renderer to
        // re-check auth + quarantine so a stale "connected" card flips to reconnect
        // and the stale roster is dropped (VRX-195/197). We do NOT clearSession:
        // VRChat's getAuthStatus is 2FA-aware and decides needs-2fa vs
        // unauthenticated; a blunt clear would force a full re-login. NetworkError
        // and other failures just propagate untouched.
        if (error instanceof AuthError) {
          this.bumpSessionGeneration()
          this.emit({ type: 'auth-invalidated', platform: 'vrchat' })
        }
        throw error
      }
    }
  }
  getInstanceDetails(): Promise<InstanceInfo> {
    return Promise.reject(new Error('VrcAdapter.getInstanceDetails not implemented'))
  }
  joinInstance(): Promise<void> {
    return Promise.reject(new Error('VrcAdapter.joinInstance not implemented'))
  }
  async selfInvite(instanceId: string): Promise<void> {
    // Validate the location BEFORE classification or URL use: a crafted instanceId
    // could otherwise satisfy the public-instance check via a `#~private(...)`
    // fragment yet rewrite the authenticated POST path (VRX-51 security review).
    if (!isInstanceLocation(instanceId)) {
      throw new Error('Invalid instance location')
    }
    // Public instances don't require an invite — the user can just join.
    if (parseInstanceType(instanceId) === 'public') {
      throw new Error('No invite needed for public instances')
    }

    // VRChat's location string is the full `worldId:nonce[~tags]` — send it raw
    // (now validated free of URL-structural characters). The Notification response
    // is discarded (returns void); z.unknown() tolerates benign API drift.
    await this.post(`/invite/myself/to/${instanceId}`, {}, z.unknown())
  }
  subscribe(handler: (event: AdapterEvent) => void): Unsubscribe {
    this.subscribers.add(handler)
    // One shared pipeline for all subscribers; started on the first, stopped
    // when the last leaves (the socket is a per-ACCOUNT resource, not per-view).
    this.pipeline ??= this.createPipeline()
    this.pipeline.start()

    let active = true
    return () => {
      if (!active) return
      active = false
      this.subscribers.delete(handler)
      if (this.subscribers.size === 0) {
        this.pipeline?.stop()
        this.pipeline = null
      }
    }
  }

  /** A pipeline object is stamped with the account generation that created it. */
  private createPipeline(): VrcPipeline {
    const generation = this.sessionGeneration
    return new VrcPipeline({
      tokenProvider: () => this.pipelineToken(),
      onEvent: (event) => {
        if (generation === this.sessionGeneration) this.emit(event)
      },
      socketFactory:
        this.live?.socketFactory ??
        (() => {
          throw new Error('VrcAdapter: no socketFactory wired for the live pipeline')
        }),
      log: this.live?.log
    })
  }

  /**
   * Pipeline auth token (VRX-146): exchange the session cookie via GET /auth
   * (verifies the session server-side — the VRCX pattern), falling back to the
   * raw authcookie value when the exchange fails, and null with no session
   * (the pipeline waits and retries; a fresh login is picked up automatically).
   */
  private async pipelineToken(): Promise<string | null> {
    if (!this.cookie) return null
    try {
      const response = await this.rawRequest(`${VRC_API_BASE}/auth`, {
        method: 'GET',
        headers: { ...this.cookieHeader(), 'User-Agent': VRC_USER_AGENT }
      })
      if (response.ok) {
        const parsed = authTokenSchema.safeParse(await response.json())
        if (parsed.success) return parsed.data.token
      }
    } catch {
      /* exchange unavailable — fall back below */
    }
    // Fallback: the raw cookie value after the FIRST `auth=` (both reportedly
    // work; the exchange is preferred as it validates the session first). Split
    // once — the value can itself contain `=` (base64 padding), so slice-join
    // rather than [1], which would truncate it.
    const authPart = cookiePart(this.cookie, 'auth')
    if (!authPart) return null
    const eq = authPart.indexOf('=')
    const value = eq === -1 ? '' : authPart.slice(eq + 1)
    return value !== '' ? value : null
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private setCookie(cookie: string): void {
    this.cookie = cookie
    this.setAuthCookie(cookie) // sync to VrcApiClient for the authed get/post path
  }

  private adoptSession(cookie: string): void {
    this.setCookie(cookie)
    this.bumpSessionGeneration()
  }

  /**
   * Fence every account boundary before replacing the live pipeline. Any late
   * callback from the stopped object keeps its captured old generation and is
   * dropped by createPipeline's event handler.
   */
  private bumpSessionGeneration(): void {
    this.sessionGeneration += 1
    this.live?.onSessionBoundary?.()

    const wasRunning = this.subscribers.size > 0
    this.pipeline?.stop()
    this.pipeline = null
    if (wasRunning) {
      this.pipeline = this.createPipeline()
      this.pipeline.start()
    }
  }

  /** Explicit logout is durable-or-fails: do not report a disconnect while the
   * persisted credential could resurrect the account on restart. */
  clearSession(): void {
    this.credentials.delete()
    this.clearSessionState()
    this.emit({ type: 'auth-invalidated', platform: 'vrchat' })
  }

  private clearSessionState(): void {
    this.cookie = null
    this.setAuthCookie(null)
    this.displayName = null
    this.pendingTwoFactorMethod = null
    this.bumpSessionGeneration()
  }

  /** Automatic auth invalidation must clear memory even when safeStorage is
   * unavailable; persisted deletion remains best-effort on this non-interactive path. */
  private invalidateSession(): void {
    this.clearSessionState()
    try {
      this.credentials.delete()
    } catch {
      /* best-effort — the in-memory session is already cleared for this run */
    }
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
    const generation = this.sessionGeneration
    try {
      const response = await this.rawRequest(`${VRC_API_BASE}/auth/user`, {
        method: 'GET',
        headers: { ...this.cookieHeader(), 'User-Agent': VRC_USER_AGENT }
      })
      if (!response.ok) return
      const parsed = currentUserSchema.safeParse(await response.json())
      if (parsed.success && generation === this.sessionGeneration) {
        this.displayName = parsed.data.displayName
      }
    } catch {
      /* non-fatal */
    }
  }

  private status(state: AuthStatus['state'], twoFactorMethod?: TwoFactorMethod): AuthStatus {
    return {
      platform: 'vrchat',
      state,
      displayName: state === 'authenticated' ? this.displayName : null,
      ...(twoFactorMethod !== undefined ? { twoFactorMethod } : {})
    }
  }
}
