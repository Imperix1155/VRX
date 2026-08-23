import { z } from 'zod'
import { VRC_API_BASE } from '@shared/constants'
import type {
  AuthStatus,
  Credentials,
  Friend,
  InstanceInfo,
  JoinMode,
  LoginResult,
  TwoFactorMethod
} from '@shared/types'
import type { FriendRoster, Unsubscribe } from './IPlatformAdapter'
import type { AdapterEvent } from '@shared/types'
import { AuthError, NetworkError } from './errors'
import { VRC_USER_AGENT, VrcApiClient } from './VrcApiClient'
import { VrcPipeline, type PipelineSocket } from './vrchat/VrcPipeline'
import { fetchFriends } from './vrchat/fetchFriends'
import { fetchWorldMetadata } from './vrchat/fetchWorldMetadata'
import { fetchGroupMetadata } from './vrchat/fetchGroupMetadata'
import { parseInstanceType } from './vrchat/parseInstanceType'
import { WorldResolver, type WorldMeta } from './vrchat/WorldResolver'
import { createGroupResolver, type GroupMeta, type GroupResolver } from './vrchat/GroupResolver'
import { buildJoinUrl as buildVrcJoinUrl } from './vrchat/buildJoinUrl'
import { hasUnsafeCredentialCharacters, isValidVrcSessionCookie } from './credentialValidation'

/**
 * Persistence for the VRChat session cookie (safeStorage-backed in production —
 * VRX-34). INJECTED so `VrcAdapter` stays electron-free and unit-testable; the
 * real store is wired at the call site when the adapter is registered.
 */
export interface VrcCredentialStore {
  load(): string | undefined
  save(cookie: string, accountId: string | null): void
  /** Remove the persisted session so an expired cookie can't survive a restart. */
  delete(): void
}

export interface VrcLiveWiring {
  socketFactory?: (url: string) => PipelineSocket
  log?: (level: 'info' | 'warn' | 'debug', message: string, meta?: unknown) => void
  /** Main-process hook for clearing account-scoped consumers such as FriendAlerts. */
  onSessionBoundary?: () => void
  /** Publishes the current platform identity after adapter state settles. */
  onIdentity?: (accountId: string | null) => void
}

const canonicalVrcUserId = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// No exact legacy-id grammar is evidenced in this codebase. Keep the fallback
// conservative: non-empty, at most 64 characters, and no whitespace, control
// characters, colon, or malformed canonical `usr_` prefix.
// eslint-disable-next-line no-control-regex -- rejecting control chars is the contract
const conservativeLegacyVrcUserId = /^(?!usr_)[^\s\u0000-\u001f\u007f:]{1,64}$/
const vrcUserIdSchema = z
  .string()
  .refine((id) => canonicalVrcUserId.test(id) || conservativeLegacyVrcUserId.test(id))
/** Minimal current-user shape we rely on (the API returns much more). */
const currentUserSchema = z.object({ id: vrcUserIdSchema, displayName: z.string() })
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
      return `${name}=${value}`
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
  // Known wire shapes (vrchatapi spec + VRCX's identical fold): TOTP accounts
  // send ['totp','otp'] ('otp' = RECOVERY codes, never email); email-only
  // accounts send ['emailOtp']. A both-methods array is not known to occur;
  // if it ever does, this folds to email — visible and retryable, never a
  // silent wrong-endpoint failure (VRX-229 review).
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
  private accountId: string | null = null
  private pendingTwoFactorMethod: TwoFactorMethod | null = null
  private sessionGeneration = 0
  /** Single resolver instance — TTL cache persists across getFriends calls (VRX-163). */
  private readonly worldResolver = new WorldResolver((worldId) =>
    this.get(`/worlds/${worldId}`, z.unknown())
  )
  /**
   * WorldIds with an enrichment fetch in flight (the CvrAdapter
   * `pendingResolutions` pattern): `peek()` stays undefined until a resolve
   * COMPLETES, so without this guard two overlapping `getFriends()` calls
   * (launch + an early manual Refresh) would double-fetch every still-unresolved
   * world through the shared 1 req/s slot. Batch-scoped: each kick sweeps its
   * own ids in `finally`, so failed/private worlds become retryable after the
   * negative-cache window (60 s) or at reconcile.
   */
  private readonly pendingWorldResolutions = new Set<string>()
  /** VRChat group metadata resolver (VRX-260). TTL-cached, bounded. */
  private readonly groupResolver: GroupResolver = createGroupResolver({
    fetcher: (groupId) => this.get(`/groups/${encodeURIComponent(groupId)}`, z.unknown())
  })
  /**
   * GroupIds with an enrichment fetch in flight. Mirrors the world dedupe
   * pattern; batch-scoped so failed/private groups become retryable.
   */
  private readonly pendingGroupResolutions = new Set<string>()

  // ── Live pipeline state (VRX-146) ──────────────────────────────────────────
  private pipeline: VrcPipeline | null = null
  private readonly subscribers = new Set<(event: AdapterEvent) => void>()

  constructor(
    private readonly credentials: VrcCredentialStore,
    sleepFn?: (ms: number) => Promise<void>,
    /**
     * Live-pipeline wiring (VRX-146), injected at the call site so this file
     * stays electron-free: the real socketFactory (ws + User-Agent) and the
     * electron-log bridge live in main/app.ts; tests inject fakes.
     */
    private readonly live?: VrcLiveWiring
  ) {
    super(sleepFn)
    // Session restore — adopt any persisted cookie; tolerate a missing/locked store.
    try {
      const stored = this.credentials.load()
      if (stored && isValidVrcSessionCookie(stored)) this.adoptSession(stored)
    } catch {
      /* no usable persisted session */
    }
  }

  async login(creds: Credentials): Promise<LoginResult> {
    // Second leg of a 2FA flow: the renderer re-calls login with the code.
    if (creds.twoFactorCode) return this.verifyTwoFactor(creds.twoFactorCode)
    if (
      !creds.username ||
      !creds.password ||
      hasUnsafeCredentialCharacters(creds.username) ||
      hasUnsafeCredentialCharacters(creds.password)
    ) {
      return { ok: false, needs2fa: false, error: 'invalid_credentials' }
    }

    // A deliberate login must always reach the wire — background data-call
    // failures can open the shared breaker and fast-fail this as a network
    // error for the 60s window even with correct credentials. Platform parity
    // with CvrAdapter.login (VRX-190; gap caught by CodeRabbit on VRX-189).
    this.resetCircuit()

    let response: Response
    try {
      response = await this.rawRequest(
        `${VRC_API_BASE}/auth/user`,
        {
          method: 'GET',
          headers: {
            Authorization: basicAuthHeader(creds.username, creds.password),
            'User-Agent': VRC_USER_AGENT
          }
        },
        { priority: 'interactive' }
      )
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
    if (authCookie && !isValidVrcSessionCookie(authCookie)) {
      return { ok: false, needs2fa: false, error: 'invalid_credentials' }
    }
    if (authCookie) {
      this.setCookie(authCookie)
      this.displayName = null
      this.accountId = null
      this.pendingTwoFactorMethod = null
      this.live?.onIdentity?.(null)
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

    // A response without a replacement cookie still completed a deliberate
    // login, so preserve the established successful-login boundary behavior.
    if (!authCookie) {
      this.live?.onIdentity?.(null)
      this.bumpSessionGeneration()
    }
    this.displayName = parsed.data.displayName
    this.accountId = parsed.data.id
    this.persist()
    this.live?.onIdentity?.(this.accountId)
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
    // INVARIANT (renderer-enforced, not guarded here): every reachable prompt
    // is preceded on this adapter by login() or getAuthStatus() setting
    // pendingTwoFactorMethod, so the totp default below is dead in practice.
    // Any FUTURE verify2fa caller that doesn't originate from a needs-2fa
    // status or login result would silently reintroduce the VRX-229 misroute
    // for email users — derive the method from the server first.
    const method = this.pendingTwoFactorMethod ?? 'totp'
    // VRChat has THREE verify endpoints (docs/api-volatility.md): totp/verify
    // (authenticator codes), emailotp/verify (emailed codes), otp/verify
    // (RECOVERY codes only). Email codes posted to otp/verify are always
    // rejected — that shipped as the VRX-229 bug, blocking every email-2FA
    // user. Contract triple-confirmed 2026-07-28: API reference + live
    // endpoint probe (401 not 404, unauthenticated) + VRCX's verifyEmailOTP.
    const endpoint =
      method === 'email' ? '/auth/twofactorauth/emailotp/verify' : '/auth/twofactorauth/totp/verify'

    let response: Response
    try {
      response = await this.rawRequest(
        `${VRC_API_BASE}${endpoint}`,
        {
          method: 'POST',
          headers: {
            ...this.cookieHeader(),
            'User-Agent': VRC_USER_AGENT,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ code })
        },
        { priority: 'interactive' }
      )
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
    if (combined.length && !isValidVrcSessionCookie(combined.join('; '))) {
      return { ok: false, needs2fa: false, error: 'invalid_credentials' }
    }
    if (combined.length) this.setCookie(combined.join('; '))
    this.pendingTwoFactorMethod = null

    // A failed refresh must not expose an own-account name cached before this
    // 2FA boundary (including a name from a different prior account).
    this.displayName = null
    this.accountId = null
    this.live?.onIdentity?.(null)
    this.bumpSessionGeneration()
    await this.refreshDisplayName('interactive')
    this.persist()
    if (this.accountId !== null) this.live?.onIdentity?.(this.accountId)
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
          { priority: 'interactive', recordCircuitFailure: false }
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
      // Schema drift is NOT a dead session — the cookie was accepted (2xx), we
      // just couldn't read the reply. Report error without clearing, same as
      // the other unreadable-response branches above (VRX-201).
      if (!parsed.success) return this.status('error')

      if ('requiresTwoFactorAuth' in parsed.data) {
        // Remember the method so a verify2fa() from the reprompt hits the right
        // endpoint (email OTP vs TOTP) — login() isn't part of this flow.
        this.pendingTwoFactorMethod = mapTwoFactorMethod(parsed.data.requiresTwoFactorAuth)
        return this.status('needs-2fa', this.pendingTwoFactorMethod)
      }

      this.displayName = parsed.data.displayName
      this.accountId = parsed.data.id
      this.persist()
      this.live?.onIdentity?.(this.accountId)
      return this.status('authenticated')
    }
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

  async getFriends(): Promise<FriendRoster> {
    for (;;) {
      const generation = this.sessionGeneration
      try {
        const result = await fetchFriends((path, schema) => this.get(path, schema))
        const { friends, failedPages, skippedRecords } = result
        if (result.presence === 'degraded') {
          throw new NetworkError('Failed to fetch friends (presence=degraded)')
        }
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

        // A different account landed while this roster was in flight. Never
        // return the old account's success: retry a replacement session, but
        // abort when logout left no session to retry.
        if (generation !== this.sessionGeneration) {
          if (this.cookie) continue
          throw new Error('Session ended')
        }
        const roster = friends.map((friend) => {
          let patched = friend
          const worldCached = this.worldResolver.peek(friend.instance?.worldId ?? null)
          if (worldCached != null) patched = this.withWorldMetadata(patched, worldCached)
          const groupCached = this.groupResolver.peek(friend.instance?.groupId ?? null)
          if (groupCached != null) patched = this.withGroupMetadata(patched, groupCached)
          return patched
        })
        this.kickWorldMetadata(roster, generation)
        this.kickGroupMetadata(roster, generation)
        return { friends: roster, completeness: result.completeness }
      } catch (error) {
        // Staleness is checked before auth invalidation or any other outcome.
        // The old account's failure is irrelevant to a replacement session; a
        // completed logout aborts instead of manufacturing a second auth failure.
        if (generation !== this.sessionGeneration) {
          if (this.cookie) continue
          throw new Error('Session ended')
        }

        // A data-path 401 in the roster fetch — the /auth/user buckets probe or a
        // friend page — means the cookie is dead/2FA-expired. Signal the renderer
        // to re-check auth + quarantine so a stale "connected" card flips to reconnect
        // and the stale roster is dropped (VRX-195/197). We do NOT clearSession:
        // VRChat's getAuthStatus is 2FA-aware and decides needs-2fa vs
        // unauthenticated; a blunt clear would force a full re-login. 401 ONLY —
        // a 403 is an ordinary denial on a live session, never an invalidation
        // (VRX-42 boundary rule, same as selfInvite). NetworkError and other
        // failures just propagate untouched.
        if (error instanceof AuthError && error.status === 401) {
          // Ordering exemption: a data-path AuthError may mean only that 2FA
          // expired, so this boundary deliberately retains the current identity.
          this.bumpSessionGeneration()
          this.emit({ type: 'auth-invalidated', platform: 'vrchat' })
        }
        throw error
      }
    }
  }

  /**
   * Resolve optional group metadata without delaying the roster. Each answer
   * emits one narrow `group-metadata` event. Consumers apply it only to friends
   * whose current location still names that group, so a late answer cannot replay
   * roster-time presence, location, or profile.
   */
  private kickGroupMetadata(friends: Friend[], generation: number): void {
    const groupIds = friends.map((friend) => {
      const groupId = friend.instance?.groupId ?? null
      if (groupId === null) return null
      if (this.groupResolver.peek(groupId) !== undefined) return null
      // In-flight dedup: a group already being resolved by an overlapping kick
      // must not be fetched twice through the shared slot.
      if (this.pendingGroupResolutions.has(groupId)) return null
      return groupId
    })
    const kicked = groupIds.filter((id): id is string => id !== null)
    for (const id of kicked) this.pendingGroupResolutions.add(id)
    void fetchGroupMetadata(groupIds, this.groupResolver, undefined, (groupId, meta) => {
      if (generation !== this.sessionGeneration) return
      this.emit({
        type: 'group-metadata',
        platform: 'vrchat',
        groupId,
        groupName: meta.name,
        groupImageUrl: meta.iconUrl
      })
    })
      .catch((error: unknown) => {
        if (generation !== this.sessionGeneration) return
        if (error instanceof AuthError && error.status === 401) {
          this.bumpSessionGeneration()
          this.emit({ type: 'auth-invalidated', platform: 'vrchat' })
          return
        }
        this.live?.log?.('warn', 'vrc adapter: group enrichment failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        // Sweep THIS batch's ids unconditionally so failed/private groups become
        // retryable after the negative-cache window or at reconcile (VRX-258).
        for (const id of kicked) this.pendingGroupResolutions.delete(id)
      })
  }

  /**
   * Resolve optional world metadata without delaying the roster. Each answer
   * emits one narrow metadata event. Consumers apply it only to friends whose
   * current location still names that world, so a late answer cannot replay the
   * roster-time presence, location, or profile.
   */
  private kickWorldMetadata(friends: Friend[], generation: number): void {
    const worldIds = friends.map((friend) => {
      const worldId = friend.instance?.worldId ?? null
      if (worldId === null) return null
      if (this.worldResolver.peek(worldId) !== undefined) return null
      // In-flight dedup (CodeRabbit, VRX-214): a world already being resolved
      // by an overlapping kick must not be fetched twice through the shared slot.
      if (this.pendingWorldResolutions.has(worldId)) return null
      return worldId
    })
    const kicked = worldIds.filter((id): id is string => id !== null)
    for (const id of kicked) this.pendingWorldResolutions.add(id)
    // Residual auth window (documented in api-volatility.md): getFriends returns
    // before these requests settle, so a background 401 invalidates the session
    // asynchronously after the caller may already have seeded LocationAuthority.
    void fetchWorldMetadata(worldIds, this.worldResolver, undefined, (worldId, meta) => {
      if (generation !== this.sessionGeneration) return
      this.emit({
        type: 'world-metadata',
        platform: 'vrchat',
        worldId,
        worldName: meta.name,
        thumbnailUrl: meta.thumbnailUrl
      })
    })
      .catch((error: unknown) => {
        if (generation !== this.sessionGeneration) return
        if (error instanceof AuthError && error.status === 401) {
          // A background 401 has the same meaning as the former awaited path:
          // preserve the cookie for the 2FA-aware status check, quarantine the
          // roster, and fence every other resolution from this generation.
          this.bumpSessionGeneration()
          this.emit({ type: 'auth-invalidated', platform: 'vrchat' })
          return
        }
        this.live?.log?.('warn', 'vrc adapter: world enrichment failed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        // Sweep THIS batch's ids unconditionally — resolved worlds are now cached
        // (peek excludes them) and failed/private ones become retryable after the
        // 60 s negative-cache window or at reconcile.
        for (const id of kicked) this.pendingWorldResolutions.delete(id)
      })
  }

  private withWorldMetadata<T extends Friend>(friend: T, meta: WorldMeta): T {
    if (friend.instance === null) return friend
    return {
      ...friend,
      instance: {
        ...friend.instance,
        worldName: meta.name,
        thumbnailUrl: meta.thumbnailUrl
      }
    }
  }

  private withGroupMetadata<T extends Friend>(friend: T, meta: GroupMeta): T {
    if (friend.instance === null || friend.instance.groupId === null) return friend
    return {
      ...friend,
      instance: {
        ...friend.instance,
        groupName: meta.name,
        groupImageUrl: meta.iconUrl
      }
    }
  }

  getInstanceDetails(): Promise<InstanceInfo> {
    return Promise.reject(new Error('VrcAdapter.getInstanceDetails not implemented'))
  }
  buildJoinUrl(instance: InstanceInfo, mode: JoinMode): string | null {
    // VRChat's URI has no desktop/VR selector; the client's own setting governs.
    void mode
    return buildVrcJoinUrl(instance.worldId, instance.instanceId, instance.region ?? undefined)
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
    // every authenticated call path must route AuthError through this emit — a dead
    // cookie must never be swallowed as a generic operation failure (VRX-42).
    const generation = this.sessionGeneration
    try {
      await this.post(`/invite/myself/to/${instanceId}`, {}, z.unknown(), {
        priority: 'interactive'
      })
      // A replacement session landed while the request was in flight; its outcome
      // belongs to the new identity, not to the caller that issued this one.
      if (generation !== this.sessionGeneration) {
        throw new Error('Session ended')
      }
    } catch (error) {
      // A replacement session that landed during the request owns its own
      // invalidation boundary; do not emit a stale auth-invalidated for it —
      // and don't surface the OLD session's failure either: the caller's
      // session is simply over (same surface as the success-path fence and
      // getFriends' staleness rule).
      if (generation !== this.sessionGeneration) {
        throw new Error('Session ended')
      }
      // A data-path 401 means the cookie is dead/2FA-expired. Signal the renderer
      // to re-check auth + quarantine so a stale "connected" card flips to reconnect.
      // We do NOT clearSession: getAuthStatus is 2FA-aware and decides needs-2fa vs
      // unauthenticated; a blunt clear would force a full re-login.
      if (error instanceof AuthError && error.status === 401) {
        this.bumpSessionGeneration()
        this.emit({ type: 'auth-invalidated', platform: 'vrchat' })
      }
      throw error
    }
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
        if (generation !== this.sessionGeneration) return
        this.emit(this.enrichPipelineEvent(event, generation))
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
   * Pipeline boundary enrichment (VRX-254 + VRX-260): live events carrying a
   * friend in an instance are patched from cached world/group resolvers before
   * emit, and unseen ids kick single background resolutions. This prevents a live
   * location move from clobbering already-resolved metadata with the parser's
   * nulls.
   */
  private enrichPipelineEvent(event: AdapterEvent, generation: number): AdapterEvent {
    if (!('friend' in event) || event.friend.instance === null) return event

    let friend = event.friend
    const instance = friend.instance
    if (instance === null) return event
    const worldId = instance.worldId
    const worldCached = this.worldResolver.peek(worldId)
    if (worldCached != null) {
      friend = this.withWorldMetadata(friend, worldCached)
    } else if (worldCached === undefined) {
      // Miss: start at most one resolution for this id through the existing
      // deduped, generation-fenced, rate-limited lane.
      if (!this.pendingWorldResolutions.has(worldId)) {
        this.pendingWorldResolutions.add(worldId)
        void fetchWorldMetadata(
          [worldId],
          this.worldResolver,
          undefined,
          (resolvedWorldId, meta) => {
            if (generation !== this.sessionGeneration) return
            this.emit({
              type: 'world-metadata',
              platform: 'vrchat',
              worldId: resolvedWorldId,
              worldName: meta.name,
              thumbnailUrl: meta.thumbnailUrl
            })
          }
        )
          .catch((error: unknown) => {
            if (generation !== this.sessionGeneration) return
            if (error instanceof AuthError && error.status === 401) {
              this.bumpSessionGeneration()
              this.emit({ type: 'auth-invalidated', platform: 'vrchat' })
              return
            }
            this.live?.log?.('warn', 'vrc adapter: live world enrichment failed', {
              message: error instanceof Error ? error.message : String(error)
            })
          })
          .finally(() => {
            this.pendingWorldResolutions.delete(worldId)
          })
      }
    }
    // A negative-cached world failure has no metadata to patch and must not be re-kicked.

    const groupId = instance.groupId
    if (groupId !== null) {
      const groupCached = this.groupResolver.peek(groupId)
      if (groupCached != null) {
        friend = this.withGroupMetadata(friend, groupCached)
      } else if (groupCached === undefined) {
        // Miss: start at most one resolution for this id.
        if (!this.pendingGroupResolutions.has(groupId)) {
          this.pendingGroupResolutions.add(groupId)
          void fetchGroupMetadata(
            [groupId],
            this.groupResolver,
            undefined,
            (resolvedGroupId, meta) => {
              if (generation !== this.sessionGeneration) return
              this.emit({
                type: 'group-metadata',
                platform: 'vrchat',
                groupId: resolvedGroupId,
                groupName: meta.name,
                groupImageUrl: meta.iconUrl
              })
            }
          )
            .catch((error: unknown) => {
              if (generation !== this.sessionGeneration) return
              if (error instanceof AuthError && error.status === 401) {
                this.bumpSessionGeneration()
                this.emit({ type: 'auth-invalidated', platform: 'vrchat' })
                return
              }
              this.live?.log?.('warn', 'vrc adapter: live group enrichment failed', {
                message: error instanceof Error ? error.message : String(error)
              })
            })
            .finally(() => {
              this.pendingGroupResolutions.delete(groupId)
            })
        }
      }
    }

    return friend === event.friend ? event : { ...event, friend }
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
    this.live?.onIdentity?.(null)
    this.bumpSessionGeneration()
  }

  /**
   * Fence every account boundary before replacing the live pipeline. Any late
   * callback from the stopped object keeps its captured old generation and is
   * dropped by createPipeline's event handler.
   */
  private bumpSessionGeneration(): void {
    this.sessionGeneration += 1
    this.groupResolver.clear()
    // Stale pending ids from the previous generation would suppress the new
    // session's first kick until their in-flight promises settle (both kick
    // paths skip ids already in the set) — drop them with the caches.
    this.pendingGroupResolutions.clear()
    this.pendingWorldResolutions.clear()
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
    this.accountId = null
    this.pendingTwoFactorMethod = null
    this.live?.onIdentity?.(null)
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
      this.credentials.save(this.cookie, this.accountId)
    } catch {
      /* persistence is best-effort; the session still works in-memory this run */
    }
  }

  private async refreshDisplayName(priority: 'default' | 'interactive' = 'default'): Promise<void> {
    const generation = this.sessionGeneration
    try {
      const response = await this.rawRequest(
        `${VRC_API_BASE}/auth/user`,
        {
          method: 'GET',
          headers: { ...this.cookieHeader(), 'User-Agent': VRC_USER_AGENT }
        },
        { priority }
      )
      if (!response.ok) return
      const parsed = currentUserSchema.safeParse(await response.json())
      if (parsed.success && generation === this.sessionGeneration) {
        this.displayName = parsed.data.displayName
        this.accountId = parsed.data.id
      }
    } catch {
      /* non-fatal */
    }
  }

  private status(state: AuthStatus['state'], twoFactorMethod?: TwoFactorMethod): AuthStatus {
    return {
      platform: 'vrchat',
      state,
      accountId: state === 'authenticated' ? this.accountId : null,
      displayName: state === 'authenticated' ? this.displayName : null,
      ...(twoFactorMethod !== undefined ? { twoFactorMethod } : {})
    }
  }
}
