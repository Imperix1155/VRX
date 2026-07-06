import type { AuthStatus, Credentials, Friend, InstanceInfo, LoginResult } from '@shared/types'
import type { IPlatformAdapter, Unsubscribe } from './IPlatformAdapter'
import { CvrApiClient, cvrAuthEnvelopeSchema, type CVRCredentials } from './CvrApiClient'
import { CVRAuthError } from './errors'

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
 * The interactive PASSWORD leg uses `authenticateRaw` (no circuit breaker), so a
 * wrong password is a clean `invalid_credentials` — not an `AuthError` plus a
 * breaker lockout after 3 wrong attempts (the VRX-157 lesson). Session
 * VALIDATION (`getAuthStatus`) reauthenticates with the stored accessKey via the
 * guarded path: a dead key clears the session on its first 401, so it cannot
 * accumulate breaker failures across refetches.
 *
 * Data methods land in their own issues: getFriends = VRX-57 (stitched with the
 * pipeline in VRX-58), instances = VRX-59/60. CVR has NO 2FA leg — `verify2fa`
 * rejects per the IPlatformAdapter contract.
 */
export class CvrAdapter extends CvrApiClient implements IPlatformAdapter {
  private session: CVRCredentials | null = null
  private displayName: string | null = null

  constructor(
    private readonly store: CvrCredentialStore,
    sleepFn?: (ms: number) => Promise<void>
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

    try {
      const auth = await this.reauthenticate(this.session.username, this.session.accessKey)
      // CVR may ROTATE the accessKey on reauth — persist the rotation, or the
      // next restore would present the stale key and silently log the user out.
      if (auth.accessKey !== this.session.accessKey || auth.username !== this.session.username) {
        this.adoptSession({ username: auth.username, accessKey: auth.accessKey })
        this.persist()
      }
      this.displayName = auth.username
      return this.status('authenticated')
    } catch (error) {
      if (error instanceof CVRAuthError) {
        // The key WE SENT was rejected — the session is dead. Clear it
        // everywhere so session restore can't re-adopt it next launch and
        // 401 forever (mirrors the VrcAdapter dead-cookie rule).
        this.clearSession()
        return this.status('unauthenticated')
      }
      // Network/rate-limit trouble: the session may still be fine — report
      // error WITHOUT clearing, so a flaky boot doesn't log the user out.
      return this.status('error')
    }
  }

  importSession(): Promise<boolean> {
    // CVRX session import lands in VRX-56.
    return Promise.resolve(false)
  }

  getFriends(): Promise<Friend[]> {
    return Promise.reject(new Error('CvrAdapter.getFriends not implemented — VRX-57'))
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

  // Fewer params than the interface is fine (structural typing) — the eslint
  // config has no unused-args ignore pattern, so the handler param is omitted.
  subscribe(): Unsubscribe {
    // Live presence wires up with the existing CvrPipeline in VRX-58; a no-op
    // keeps the adapter registrable without faking an event stream.
    return () => {}
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
