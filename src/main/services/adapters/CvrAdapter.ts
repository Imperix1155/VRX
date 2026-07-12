import type {
  AdapterEvent,
  AuthStatus,
  Credentials,
  Friend,
  InstanceInfo,
  JoinMode,
  LoginResult
} from '@shared/types'
import { z } from 'zod'
import type { IPlatformAdapter, Unsubscribe } from './IPlatformAdapter'
import type { PipelineSocket } from './ReconnectingPipeline'
import { CvrApiClient, cvrAuthEnvelopeSchema, type CVRCredentials } from './CvrApiClient'
import { CvrPipeline } from './cvr/CvrPipeline'
import { fetchCvrFriends } from './cvr/fetchCvrFriends'
import { parseCvrPrivacy } from './cvr/parseCvrPrivacy'
import { createCvrInstanceResolver, type ResolvedCvrInstance } from './cvr/resolveCvrInstance'
import { CVRAuthError, CVRNetworkError } from './errors'
import { buildCvrJoinUrl } from './cvr/buildCvrJoinUrl'
import { extractCvrPlatformUserId } from './cvr/cvrPlatformUserId'

/** The presence-snapshot member of AdapterEvent (no exported alias in shared). */
type PresenceSnapshotEvent = Extract<AdapterEvent, { type: 'presence-snapshot' }>

const cvrCurrentUserSchema = cvrAuthEnvelopeSchema.extend({
  data: cvrAuthEnvelopeSchema.shape.data.extend({
    userId: z.string().refine((userId) => {
      const parsed = extractCvrPlatformUserId(userId)
      return parsed.ok && parsed.platformUserId === userId.toLowerCase()
    })
  })
})

/** Live-pipeline wiring (VRX-58), injected at the call site so this file stays
 *  electron-free: the real socketFactory (ws + upgrade headers) and the
 *  electron-log bridge live in main/index.ts; tests inject fakes. */
export interface CvrLiveWiring {
  socketFactory?: (url: string, headers: Record<string, string>) => PipelineSocket
  log?: (level: 'info' | 'warn' | 'debug', message: string, meta?: unknown) => void
  /** Main-process hook for clearing account-scoped consumers such as FriendAlerts. */
  onSessionBoundary?: () => void
  /** Publishes the current platform identity after adapter state settles. */
  onIdentity?: (accountId: string | null) => void
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
 * BOTH auth legs use `authenticateRaw`: a wrong password is
 * a clean `invalid_credentials`, and an automatic session validation that fails
 * with a NON-2xx (401/5xx) or a schema-drifted body records NO breaker failure —
 * so it can't fast-fail a later correct-password login (the guarded-reauth-
 * poisons-login bug Codex caught, 2026-07-06; the guarded path only protects the
 * DATA methods). Network throws from automatic validation are likewise exempt;
 * interactive login retains its normal circuit behavior after resetting it.
 * A dead key (401) clears the session; other trouble reports `error` WITHOUT
 * clearing, so a flaky boot never logs the user out.
 *
 * `getFriends` returns the static roster (VRX-57) and `subscribe` drives live
 * presence over the shared `CvrPipeline` (VRX-58); instances = VRX-59/60. CVR
 * has NO 2FA leg — `verify2fa` rejects per the IPlatformAdapter contract.
 */
export class CvrAdapter extends CvrApiClient implements IPlatformAdapter {
  private session: CVRCredentials | null = null
  private displayName: string | null = null
  private accountId: string | null = null
  private validationInFlight: Promise<AuthStatus> | null = null
  /** Fences async account-scoped cache writes across session replacement. */
  private sessionGeneration = 0
  // True once the current session has been proven this launch — by a fresh
  // login (AuthType 2 just succeeded) or ONE successful restore validation.
  // Gates the reauth in getAuthStatus so we never re-login on every status
  // check: CVR's /users/auth rotates/rate-limits, and re-authing on each
  // navigation churned the session and logged the user out (VRX-190). After
  // this, the session is trusted in-memory; a dead key surfaces on the data
  // path (getFriends 401 → automatic session invalidation).
  private validated = false

  // ── Live pipeline state (VRX-58) — one shared socket per account ──
  private pipeline: CvrPipeline | null = null
  private readonly subscribers = new Set<(event: AdapterEvent) => void>()
  // Snapshot entries intentionally carry ids only. Keep the latest successful
  // REST roster's names in main so native notifications can resolve readable
  // copy without fabricating profile fields on AdapterEvent.
  private readonly friendNames = new Map<string, string>()
  /** Monotonic order fence: only the newest same-generation roster may write names. */
  private friendNamesRequestSequence = 0
  private friendNamesCommittedSequence = 0

  // ── Instance enrichment (VRX-59) ──
  // The WS wire has no world id/thumbnail and only the creator-set instance
  // label; the resolver fills those from GET /instances/{id} (TTL-cached).
  // `this.get` carries auth + the BaseAdapter rate limiter + typed errors.
  private readonly instanceResolver = createCvrInstanceResolver({
    fetcher: (path, schema) => this.get(path, schema)
  })
  /** Last snapshot from the pipeline — re-enriched + re-emitted as resolutions land. */
  private lastSnapshot: PresenceSnapshotEvent | null = null
  /** Ids with a re-emit callback already attached — in-flight ids still `peek()`
   *  as undefined, so without this every rapid delta snapshot would stack another
   *  callback on the same promise → N×M duplicate re-emits (Sol review, High). */
  private readonly pendingResolutions = new Set<string>()
  /** One best-effort REST name warm per session; failures remain retryable. */
  private rosterWarmStarted = false

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

    // A deliberate login must always reach the wire — background/data-call
    // failures (e.g. a stale restored session on boot) can open the shared
    // circuit breaker and otherwise fast-fail this as "cannot connect" for the
    // 60s reset window even with correct credentials (VRX-190 follow-up).
    this.resetCircuit()

    let response: Response
    try {
      response = await this.authenticateRaw(2, email, password)
    } catch (error) {
      // Diagnostic (no secrets): distinguishes an open circuit from a real
      // network/DNS/TLS failure if this ever recurs.
      this.live?.log?.('warn', 'cvr login: request failed', {
        name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error)
      })
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
    const parsed = cvrCurrentUserSchema.safeParse(body)
    if (!parsed.success) return { ok: false, needs2fa: false, error: 'unexpected_response' }

    // The accessKey — not the password — is the session from here on. The
    // password is never stored, logged, or persisted (VRX-37 AC).
    this.adoptSession({
      username: parsed.data.data.username,
      accessKey: parsed.data.data.accessKey
    })
    this.accountId = parsed.data.data.userId
    this.live?.onIdentity?.(this.accountId)
    // A fresh login just proved the credentials — trust the session without
    // re-authing on every subsequent status check (VRX-190).
    this.validated = true
    this.persist()
    return { ok: true }
  }

  verify2fa(): Promise<LoginResult> {
    // Platforms without a 2-leg 2FA flow reject this (IPlatformAdapter contract).
    return Promise.resolve({ ok: false, needs2fa: false, error: 'unsupported_2fa' })
  }

  async getAuthStatus(): Promise<AuthStatus> {
    if (!this.session) return this.status('unauthenticated')
    // Already proven this launch (fresh login or a prior restore validation) →
    // trust the in-memory session; NO network call. This is what makes the
    // session stick across navigation — re-authing here rotated/rate-limited
    // CVR's /users/auth and logged the user out on the second check (VRX-190).
    if (this.validated) return this.status('authenticated')
    // First check of a RESTORED session (VRX-174) — validate it once. Serialize
    // concurrent callers so two overlapping reauths can't clobber each other.
    this.validationInFlight ??= this.validateSession().finally(() => {
      this.validationInFlight = null
    })
    return this.validationInFlight
  }

  private async validateSession(): Promise<AuthStatus> {
    // Capture the session under validation. A concurrent login() can replace it
    // while we await; its result must NEVER clobber the newer session (verifier
    // 2026-07-06 — a stale reauth's 401 was wiping a just-logged-in session).
    const validated = this.session
    if (!validated) return this.status('unauthenticated')

    // Breaker-free reauth (AuthType 1 = ACCESS_KEY) — parse the raw Response
    // ourselves so validation failures never poison the login circuit (Codex,
    // 2026-07-06), exactly as VrcAdapter.getAuthStatus interprets rawRequest.
    let response: Response
    try {
      response = await this.authenticateRaw(1, validated.username, validated.accessKey, {
        recordCircuitFailure: false
      })
    } catch {
      // Network trouble or an already-open circuit — the session may still be
      // fine; report error WITHOUT clearing (a flaky boot must not log out).
      return this.currentStatusIfSwapped(validated) ?? this.status('error')
    }

    // A newer session landed under us → this result is stale; don't mutate.
    const swapped = this.currentStatusIfSwapped(validated)
    if (swapped) return swapped

    if (response.status === 401 || response.status === 403) {
      // The key WE SENT was rejected — the session is dead. Clear it everywhere
      // so session restore can't re-adopt it next launch and 401 forever
      // (mirrors the VrcAdapter dead-cookie rule).
      this.invalidateSession(false)
      return this.status('unauthenticated')
    }
    if (!response.ok) return this.status('error') // 5xx etc — transient, don't clear

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return this.currentStatusIfSwapped(validated) ?? this.status('error')
    }
    // Re-check after the body await too.
    const swappedAfterBody = this.currentStatusIfSwapped(validated)
    if (swappedAfterBody) return swappedAfterBody

    const parsed = cvrCurrentUserSchema.safeParse(body)
    // Schema drift is NOT a dead session — report error without clearing, and
    // (now) without recording a breaker failure that could block login.
    if (!parsed.success) return this.status('error')

    const { username, accessKey } = parsed.data.data
    // CVR may ROTATE the accessKey on reauth — persist the rotation, or the next
    // restore would present the stale key and silently log the user out.
    if (accessKey !== validated.accessKey || username !== validated.username) {
      this.adoptSession({ username, accessKey })
      this.persist()
    }
    this.displayName = username
    this.accountId = parsed.data.data.userId
    this.live?.onIdentity?.(this.accountId)
    // Restored session proven once — trust it for the rest of this launch.
    this.validated = true
    return this.status('authenticated')
  }

  /**
   * When a concurrent login() replaced the session we were validating, our
   * result is stale: return the CURRENT session's status (authenticated if
   * login adopted a new one, unauthenticated if it was cleared) and mutate
   * nothing. Returns null when the session is unchanged (proceed normally).
   */
  private currentStatusIfSwapped(validated: CVRCredentials): AuthStatus | null {
    if (this.session === validated) return null
    return this.status(this.session ? 'authenticated' : 'unauthenticated')
  }

  importSession(): Promise<boolean> {
    // CVRX session import lands in VRX-56.
    return Promise.resolve(false)
  }

  async getFriends(): Promise<Friend[]> {
    for (;;) {
      // Static roster only (VRX-57); live presence arrives via the pipeline below.
      const generation = this.sessionGeneration
      const requestSequence = ++this.friendNamesRequestSequence
      let result: { friends: Friend[]; skippedRecords: number }
      try {
        result = await fetchCvrFriends((path, schema) => this.get(path, schema))
      } catch (error) {
        // A different account landed while this request was in flight. Retry a
        // replacement session, but abort when logout left no session to retry.
        if (generation !== this.sessionGeneration) {
          if (this.session) continue
          throw new Error('Session ended')
        }

        // The data path is where a dead session surfaces (VRX-190): getAuthStatus
        // trusts the session without re-authing, so a 401 here IS the signal that
        // the accessKey died — clear it so the UI reflects logged-out, then let
        // the error propagate for the "couldn't load" state.
        if (error instanceof CVRAuthError) {
          // Dead access key on the data path — clear the session AND tell the
          // renderer, which has no other signal that auth changed out of band, so
          // the Accounts card stops showing a stale "connected" (VRX-195).
          this.invalidateSession(true)
        }
        throw error
      }

      // Check staleness before normalization errors or returning account data.
      if (generation !== this.sessionGeneration) {
        if (this.session) continue
        throw new Error('Session ended')
      }

      // Everything was dropped as malformed → surface an error rather than a
      // misleading empty list (UI shows "couldn't load", not "no friends"), the
      // same rule as VrcAdapter.getFriends. A total fetch failure already throws.
      if (result.skippedRecords > 0 && result.friends.length === 0) {
        throw new CVRNetworkError(
          `Failed to normalize CVR friends (skippedRecords=${result.skippedRecords})`
        )
      }

      // Overlapping renderer and socket-warm fetches are expected. Both callers
      // may use their own result, but an older response must not overwrite the
      // name cache established by a newer SUCCESSFUL request — track the highest
      // committed sequence, not the highest started one, so a failed newer
      // request can't forbid the only successful roster from populating names.
      if (requestSequence > this.friendNamesCommittedSequence) {
        this.friendNamesCommittedSequence = requestSequence
        this.friendNames.clear()
        for (const friend of result.friends) {
          this.friendNames.set(friend.platformUserId, friend.displayName)
        }
      }
      return result.friends
    }
  }

  /** Resolve an id-only CVR presence entry against the latest REST roster. */
  resolveFriendName(platformUserId: string): string | null {
    return this.friendNames.get(platformUserId) ?? null
  }
  /**
   * Resolve full instance details on demand (VRX-59) — the detail-panel path.
   * Unresolvable (private/hidden/gone/API failure) REJECTS per the interface
   * contract (`Promise<InstanceInfo>` has no null); the enrichment path is the
   * one with graceful-null semantics.
   */
  async getInstanceDetails(instanceId: string): Promise<InstanceInfo> {
    for (;;) {
      const generation = this.sessionGeneration
      const resolved = await this.instanceResolver.resolve(instanceId)
      // Never return an old session's success or surface its null/failure as the
      // current call's outcome. Resolve again through the current session.
      if (generation !== this.sessionGeneration) continue
      if (resolved === null) {
        throw new CVRNetworkError('CVR instance is private or could not be resolved')
      }
      const access = parseCvrPrivacy(resolved.privacy)
      return {
        // True world id when the API supplied one; the instance id otherwise
        // (same fallback the WS path uses — keys stay consistent either way).
        worldId: resolved.worldId ?? instanceId,
        instanceId,
        worldName: resolved.worldName ?? resolved.instanceName,
        thumbnailUrl: resolved.worldImageUrl,
        type: access.type,
        openness: access.openness,
        isGroup: access.isGroup,
        groupName: null,
        region: null,
        userCount: resolved.playerCount
      }
    }
  }
  buildJoinUrl(instance: InstanceInfo, mode: JoinMode): string | null {
    return buildCvrJoinUrl(instance.instanceId, mode)
  }
  selfInvite(): Promise<void> {
    return Promise.reject(new Error('CvrAdapter.selfInvite not supported on ChilloutVR'))
  }

  subscribe(handler: (event: AdapterEvent) => void): Unsubscribe {
    this.subscribers.add(handler)
    // One shared pipeline for all subscribers; started on the first, stopped
    // when the last leaves (the socket is a per-ACCOUNT resource, not per-view).
    // Mirrors VrcAdapter.subscribe (VRX-146c).
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
        // A resolution landing after the pipeline stops must not re-emit the
        // dead connection's roster to a future subscriber (VRX-59): the next
        // connect delivers a fresh full set anyway (CVR ONLINE_FRIENDS).
        this.lastSnapshot = null
        this.pendingResolutions.clear()
      }
    }
  }

  /** A pipeline object is stamped with the account generation that created it. */
  private createPipeline(): CvrPipeline {
    const generation = this.sessionGeneration
    return new CvrPipeline({
      headersProvider: () => Promise.resolve(this.pipelineHeaders()),
      onEvent: (event) => this.handlePipelineEvent(event, generation),
      socketFactory:
        this.live?.socketFactory ??
        (() => {
          throw new Error('CvrAdapter: no socketFactory wired for the live pipeline')
        }),
      log: this.live?.log
    })
  }

  /**
   * Pipeline events pass through UNLESS they're presence snapshots, which get
   * world enrichment (VRX-59): emit immediately with whatever the resolver
   * cache already knows (never delay presence on network I/O), then resolve any
   * unseen instance ids and RE-EMIT the enriched snapshot as answers land.
   * Snapshots are idempotent full-sets, so re-emits are safe by contract.
   */
  private handlePipelineEvent(event: AdapterEvent, generation = this.sessionGeneration): void {
    if (generation !== this.sessionGeneration) return

    if (event.type === 'connection' && event.platform === 'chilloutvr') {
      // Every socket boundary invalidates the enrichment source, including
      // `live`: a resolution from the previous connection must never re-emit
      // its old full set into the fresh baseline window.
      this.lastSnapshot = null
      this.pendingResolutions.clear()
      this.emit(event)
      if (event.health === 'live') this.warmFriendNames()
      return
    }
    if (event.type !== 'presence-snapshot' || event.platform !== 'chilloutvr') {
      this.emit(event)
      return
    }
    this.lastSnapshot = event
    this.emit(this.enrichSnapshot(event))
    this.kickResolutions(event, generation)
  }

  /** Patch entries with any CACHED resolution — synchronous, cache-only. */
  private enrichSnapshot(snapshot: PresenceSnapshotEvent): PresenceSnapshotEvent {
    return {
      ...snapshot,
      entries: snapshot.entries.map((entry) => {
        if (entry.instance == null) return entry
        const resolved = this.instanceResolver.peek(entry.instance.instanceId)
        if (resolved == null) {
          // Unresolved: keep the wire values — the creator-set Instance.Name
          // stays as the UI's world-line fallback (VRX-59 UX; display strips
          // the (#…) suffix). FriendAlerts independently nulls it for alert
          // copy via the worldId===instanceId unresolved marker, so the label
          // can never reach a notification body.
          return entry
        }
        return { ...entry, instance: this.mergeResolved(entry.instance, resolved) }
      })
    }
  }

  /** Resolved fields win where present; WS values remain the fallback. Privacy
   *  stays the WS value — it's fresher than a cached REST read. */
  private mergeResolved(instance: InstanceInfo, resolved: ResolvedCvrInstance): InstanceInfo {
    return {
      ...instance,
      worldId: resolved.worldId ?? instance.worldId,
      // Only resolver world.name is authoritative; instanceName is a label.
      worldName: resolved.worldName,
      thumbnailUrl: resolved.worldImageUrl ?? instance.thumbnailUrl,
      userCount: resolved.playerCount ?? instance.userCount
    }
  }

  /**
   * Fire resolution for every DISTINCT unseen instance id in the snapshot; when
   * any resolution yields data, re-enrich + re-emit the CURRENT last snapshot
   * (which may be newer than the one that kicked this — fine: enrichment is
   * per-instance-id, not per-snapshot). Failures resolve null and are
   * negative-cached inside the resolver; nothing to re-emit for them.
   */
  private kickResolutions(snapshot: PresenceSnapshotEvent, generation: number): void {
    const unseen = new Set<string>()
    for (const entry of snapshot.entries) {
      if (entry.instance == null) continue
      const id = entry.instance.instanceId
      if (this.instanceResolver.peek(id) === undefined && !this.pendingResolutions.has(id)) {
        unseen.add(id)
      }
    }
    for (const id of unseen) {
      this.pendingResolutions.add(id)
      void this.instanceResolver
        .resolve(id)
        .then((resolved) => {
          if (
            generation !== this.sessionGeneration ||
            resolved === null ||
            this.lastSnapshot === null
          ) {
            return
          }
          // Only re-emit if the id is still present in the current snapshot.
          const relevant = this.lastSnapshot.entries.some((e) => e.instance?.instanceId === id)
          if (relevant) this.emit(this.enrichSnapshot(this.lastSnapshot))
        })
        .finally(() => {
          if (generation === this.sessionGeneration) this.pendingResolutions.delete(id)
        })
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
        this.live?.log?.('warn', 'cvr adapter: subscriber threw', {
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  private adoptSession(credentials: CVRCredentials): void {
    this.session = credentials
    this.setCredentials(credentials)
    this.displayName = credentials.username
    this.accountId = null
    this.live?.onIdentity?.(null)
    this.bumpSessionGeneration()
  }

  private persist(): void {
    if (!this.session) return
    try {
      this.store.save(this.session)
    } catch {
      /* locked/unavailable store — the session stays usable in-memory */
    }
  }

  clearSession(): void {
    this.store.delete()
    this.clearSessionState()
    this.emit({ type: 'auth-invalidated', platform: 'chilloutvr' })
  }

  private clearSessionState(): void {
    this.session = null
    this.setCredentials(null)
    this.displayName = null
    this.accountId = null
    this.validated = false
    this.live?.onIdentity?.(null)
    this.bumpSessionGeneration()
  }

  /** Automatic 401 invalidation is best-effort on disk: the dead session must
   * still be removed from memory and announced when safeStorage is unavailable. */
  private invalidateSession(emit: boolean): void {
    this.clearSessionState()
    try {
      this.store.delete()
    } catch {
      /* ignore — nothing recoverable to do */
    }
    if (emit) this.emit({ type: 'auth-invalidated', platform: 'chilloutvr' })
  }

  private warmFriendNames(): void {
    if (this.rosterWarmStarted) return
    this.rosterWarmStarted = true
    const generation = this.sessionGeneration
    // Name warming is best-effort and never delays the socket. getFriends fences
    // its cache write; this generation check also makes the warm's result a no-op
    // after an account switch. A failure re-opens the gate for the next live edge.
    void this.getFriends().catch(() => {
      if (generation === this.sessionGeneration) this.rosterWarmStarted = false
    })
  }

  /** Reset every account-scoped cache and replace a running socket pipeline. */
  private bumpSessionGeneration(): void {
    this.sessionGeneration += 1
    this.friendNames.clear()
    this.friendNamesRequestSequence = 0
    this.friendNamesCommittedSequence = 0
    this.instanceResolver.clear()
    this.lastSnapshot = null
    this.pendingResolutions.clear()
    this.rosterWarmStarted = false
    this.live?.onSessionBoundary?.()

    const wasRunning = this.subscribers.size > 0
    this.pipeline?.stop()
    this.pipeline = null
    if (wasRunning) {
      this.pipeline = this.createPipeline()
      this.pipeline.start()
    }
  }

  private status(state: AuthStatus['state']): AuthStatus {
    return {
      platform: 'chilloutvr',
      state,
      accountId: state === 'authenticated' ? this.accountId : null,
      displayName: state === 'authenticated' ? this.displayName : null
    }
  }
}
