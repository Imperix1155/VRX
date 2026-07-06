import type {
  AdapterEvent,
  AuthStatus,
  Credentials,
  Friend,
  InstanceInfo,
  LoginResult
} from '@shared/types'
import type { IPlatformAdapter, Unsubscribe } from './IPlatformAdapter'
import type { PipelineSocket } from './ReconnectingPipeline'
import { CvrApiClient, cvrAuthEnvelopeSchema, type CVRCredentials } from './CvrApiClient'
import { CvrPipeline } from './cvr/CvrPipeline'
import { fetchCvrFriends } from './cvr/fetchCvrFriends'
import { CVRNetworkError } from './errors'

/** Live-pipeline wiring (VRX-58), injected at the call site so this file stays
 *  electron-free: the real socketFactory (ws + upgrade headers) and the
 *  electron-log bridge live in main/index.ts; tests inject fakes. */
export interface CvrLiveWiring {
  socketFactory?: (url: string, headers: Record<string, string>) => PipelineSocket
  log?: (level: 'info' | 'warn' | 'debug', message: string, meta?: unknown) => void
}

/**
 * Persistence for the CVR session (username + accessKey), safeStorage-backed in
 * production. INJECTED so `CvrAdapter` stays electron-free and unit-testable —
 * the real store is wired at the call site (mirrors `VrcCredentialStore`, VRX-157).
 */
export interface CvrCredentialStore {
  load(): CVRCredentials | undefined
  save(credentials: CVRCredentials): void
  /** Remove the persisted session so a dead accessKey can't survive a restart. */
  delete(): void
}

/**
 * CVR credentials travel in HTTP HEADERS (`Username`/`AccessKey`), so a control
 * character in an input is header injection, not just bad data — reject before
 * any wire use (VRX-37 AC; the app-wide input-sanitization sweep is VRX-38).
 */
// eslint-disable-next-line no-control-regex -- rejecting control chars IS the point (header-injection guard)
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Concrete ChilloutVR adapter (VRX-37) — direct login + session persistence and
 * restore (VRX-174).
 *
 * BOTH auth legs use `authenticateRaw` (no circuit breaker): a wrong password is
 * a clean `invalid_credentials`, and — critically — an AUTOMATIC session
 * validation failure (flaky boot, schema drift) can NOT record breaker failures
 * that would later fast-fail a correct-password login as `network_error` during
 * the reset window (the guarded-reauth-poisons-login bug Codex caught,
 * 2026-07-06; the guarded path only ever protects the DATA methods). A dead key
 * (401) clears the session on validation; network/schema trouble reports `error`
 * WITHOUT clearing, so a flaky boot never logs the user out.
 *
 * `getFriends` returns the static roster (VRX-57) and `subscribe` drives live
 * presence over the shared `CvrPipeline` (VRX-58); instances = VRX-59/60. CVR
 * has NO 2FA leg — `verify2fa` rejects per the IPlatformAdapter contract.
 */
export class CvrAdapter extends CvrApiClient implements IPlatformAdapter {
  private session: CVRCredentials | null = null
  private displayName: string | null = null
  private validationInFlight: Promise<AuthStatus> | null = null

  // ── Live pipeline state (VRX-58) — one shared socket per account ──
  private pipeline: CvrPipeline | null = null
  private readonly subscribers = new Set<(event: AdapterEvent) => void>()

  constructor(
    private readonly store: CvrCredentialStore,
    sleepFn?: (ms: number) => Promise<void>,
    private readonly live?: CvrLiveWiring
  ) {
    super(sleepFn)
    // Session restore (VRX-174) — adopt any persisted session; tolerate a
    // missing/locked store. Validation is lazy: the first getAuthStatus()
    // reauthenticates server-side before 'authenticated' is ever reported.
    try {
      const stored = this.store.load()
      if (stored) this.adoptSession(stored)
    } catch {
      /* no usable persisted session */
    }
  }

  async login(creds: Credentials): Promise<LoginResult> {
    // CVR has no second factor; a code here means the renderer confused flows.
    if (creds.twoFactorCode) return { ok: false, needs2fa: false, error: 'unsupported_2fa' }

    const email = creds.username.trim()
    const password = creds.password
    if (!email || !password || CONTROL_CHARS.test(email) || CONTROL_CHARS.test(password)) {
      // Indistinguishable from a wrong password on purpose — no oracle for
      // which characters the validator rejects (safe generic error, VRX-37 AC).
      return { ok: false, needs2fa: false, error: 'invalid_credentials' }
    }

    let response: Response
    try {
      response = await this.authenticateRaw(2, email, password)
    } catch {
      return { ok: false, needs2fa: false, error: 'network_error' }
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, needs2fa: false, error: 'invalid_credentials' }
    }
    if (!response.ok) return { ok: false, needs2fa: false, error: `http_${response.status}` }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { ok: false, needs2fa: false, error: 'bad_response' }
    }
    const parsed = cvrAuthEnvelopeSchema.safeParse(body)
    if (!parsed.success) return { ok: false, needs2fa: false, error: 'unexpected_response' }

    // The accessKey — not the password — is the session from here on. The
    // password is never stored, logged, or persisted (VRX-37 AC).
    this.adoptSession({
      username: parsed.data.data.username,
      accessKey: parsed.data.data.accessKey
    })
    this.persist()
    return { ok: true }
  }

  verify2fa(): Promise<LoginResult> {
    // Platforms without a 2-leg 2FA flow reject this (IPlatformAdapter contract).
    return Promise.resolve({ ok: false, needs2fa: false, error: 'unsupported_2fa' })
  }

  async getAuthStatus(): Promise<AuthStatus> {
    if (!this.session) return this.status('unauthenticated')
    // Serialize concurrent validations (verifier-proven race): two overlapping
    // reauths both capture the OLD key; if CVR rotates on the first, the
    // second's 401 would clearSession() and wipe the freshly persisted
    // rotation. One in-flight validation is shared by all concurrent callers.
    this.validationInFlight ??= this.validateSession().finally(() => {
      this.validationInFlight = null
    })
    return this.validationInFlight
  }

  private async validateSession(): Promise<AuthStatus> {
    if (!this.session) return this.status('unauthenticated')

    // Breaker-free reauth (AuthType 1 = ACCESS_KEY) — parse the raw Response
    // ourselves so validation failures never poison the login circuit (Codex,
    // 2026-07-06), exactly as VrcAdapter.getAuthStatus interprets rawRequest.
    let response: Response
    try {
      response = await this.authenticateRaw(1, this.session.username, this.session.accessKey)
    } catch {
      // Network trouble or an already-open circuit — the session may still be
      // fine; report error WITHOUT clearing (a flaky boot must not log out).
      return this.status('error')
    }

    if (response.status === 401 || response.status === 403) {
      // The key WE SENT was rejected — the session is dead. Clear it everywhere
      // so session restore can't re-adopt it next launch and 401 forever
      // (mirrors the VrcAdapter dead-cookie rule).
      this.clearSession()
      return this.status('unauthenticated')
    }
    if (!response.ok) return this.status('error') // 5xx etc — transient, don't clear

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return this.status('error')
    }
    const parsed = cvrAuthEnvelopeSchema.safeParse(body)
    // Schema drift is NOT a dead session — report error without clearing, and
    // (now) without recording a breaker failure that could block login.
    if (!parsed.success) return this.status('error')

    const { username, accessKey } = parsed.data.data
    // CVR may ROTATE the accessKey on reauth — persist the rotation, or the next
    // restore would present the stale key and silently log the user out.
    if (accessKey !== this.session.accessKey || username !== this.session.username) {
      this.adoptSession({ username, accessKey })
      this.persist()
    }
    this.displayName = username
    return this.status('authenticated')
  }

  importSession(): Promise<boolean> {
    // CVRX session import lands in VRX-56.
    return Promise.resolve(false)
  }

  async getFriends(): Promise<Friend[]> {
    // Static roster only (VRX-57); live presence arrives via the pipeline below.
    const { friends, skippedRecords } = await fetchCvrFriends((path, schema) =>
      this.get(path, schema)
    )
    // Everything was dropped as malformed → surface an error rather than a
    // misleading empty list (UI shows "couldn't load", not "no friends"), the
    // same rule as VrcAdapter.getFriends. A total fetch failure already throws.
    if (skippedRecords > 0 && friends.length === 0) {
      throw new CVRNetworkError(
        `Failed to normalize CVR friends (skippedRecords=${skippedRecords})`
      )
    }
    return friends
  }
  getInstanceDetails(): Promise<InstanceInfo> {
    return Promise.reject(new Error('CvrAdapter.getInstanceDetails not implemented — VRX-59'))
  }
  joinInstance(): Promise<void> {
    return Promise.reject(new Error('CvrAdapter.joinInstance not implemented — VRX-60'))
  }
  selfInvite(): Promise<void> {
    return Promise.reject(new Error('CvrAdapter.selfInvite not supported on ChilloutVR'))
  }

  subscribe(handler: (event: AdapterEvent) => void): Unsubscribe {
    this.subscribers.add(handler)
    // One shared pipeline for all subscribers; started on the first, stopped
    // when the last leaves (the socket is a per-ACCOUNT resource, not per-view).
    // Mirrors VrcAdapter.subscribe (VRX-146c).
    this.pipeline ??= new CvrPipeline({
      headersProvider: () => Promise.resolve(this.pipelineHeaders()),
      onEvent: (event) => {
        // Isolate subscribers: one throwing handler must not starve the others
        // in the shared fan-out.
        for (const subscriber of this.subscribers) {
          try {
            subscriber(event)
          } catch (err) {
            this.live?.log?.('warn', 'cvr pipeline: subscriber threw', {
              message: err instanceof Error ? err.message : String(err)
            })
          }
        }
      },
      socketFactory:
        this.live?.socketFactory ??
        (() => {
          throw new Error('CvrAdapter: no socketFactory wired for the live pipeline')
        }),
      log: this.live?.log
    })
    this.pipeline.start()

    let active = true
    return () => {
      if (!active) return
      active = false
      this.subscribers.delete(handler)
      if (this.subscribers.size === 0) {
        this.pipeline?.stop()
      }
    }
  }

  private adoptSession(credentials: CVRCredentials): void {
    this.session = credentials
    this.setCredentials(credentials)
    this.displayName = credentials.username
  }

  private persist(): void {
    if (!this.session) return
    try {
      this.store.save(this.session)
    } catch {
      /* locked/unavailable store — the session stays usable in-memory */
    }
  }

  private clearSession(): void {
    this.session = null
    this.setCredentials(null)
    this.displayName = null
    try {
      this.store.delete()
    } catch {
      /* ignore — nothing recoverable to do */
    }
  }

  private status(state: AuthStatus['state']): AuthStatus {
    return {
      platform: 'chilloutvr',
      state,
      displayName: state === 'authenticated' ? this.displayName : null
    }
  }
}
