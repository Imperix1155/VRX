/**
 * VRChat Pipeline WebSocket client (VRX-146).
 *
 * The Pipeline (`wss://pipeline.vrchat.cloud/?authToken=…`) is VRChat's
 * sanctioned real-time source for friend/notification events — presence comes
 * from HERE, never from REST polling (the #1 rate-limit/ban risk, CLAUDE.md).
 *
 * Design:
 * - RECEIVE-ONLY. Nothing is ever sent over the socket.
 * - Dependency-injected (ws factory, token provider, sleep, log) — electron-free
 *   and unit-testable like every module in this directory.
 * - Wire format: every message is `{ type, content }` where `content` is a
 *   DOUBLE-ENCODED JSON string — parse the outer object, `JSON.parse(content)`,
 *   then Zod-validate the inner payload.
 * - Presence state comes from the EVENT TYPE (`friend-online` → in-game,
 *   `friend-active` → website/app, `friend-offline` → offline), so friend
 *   payloads are normalized through the shared `normalize()` with SYNTHETIC
 *   buckets built from that type.
 * - Unknown event types and malformed payloads are logged and IGNORED — the
 *   client never throws on wire data (api-volatility contract).
 * - Reconnect: exponential backoff + jitter (PIPELINE_BACKOFF_* constants),
 *   reset on a successful open. The token is re-fetched per attempt (a fresh
 *   session cookie is picked up automatically after re-login). No application
 *   heartbeat exists on this socket — TCP keepalive only (VRCX-verified note).
 * - Consumers reconcile on (re)connect: every successful open emits
 *   `{ type: 'connection', health: 'live' }`, and the renderer invalidates the
 *   friends query in response — that REST refetch is the reconcile.
 *
 * Notification / self / group events are DECODED (so drift is visible in logs)
 * but not yet routed anywhere — the notifications store doesn't exist until
 * VRX-84/86/87. Routing them is those issues' scope.
 */
import { z } from 'zod'
import {
  PIPELINE_BACKOFF_BASE_MS,
  PIPELINE_BACKOFF_CAP_MS,
  VRC_PIPELINE_URL
} from '@shared/constants'
import type { AdapterEvent } from '@shared/types'
import { normalize, rawFriendSchema } from './fetchFriends'
import { parseLocation } from './parseLocation'

// ─── Injected surfaces ────────────────────────────────────────────────────────

/** The slice of a WebSocket the pipeline uses — `ws` satisfies it; tests fake it. */
export interface PipelineSocket {
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: unknown[]) => void): void
  close(): void
}

export interface VrcPipelineDeps {
  /**
   * Yields the Pipeline auth token for the NEXT connection attempt (the
   * `authcookie_…` value — via the GET /auth exchange or the raw cookie), or
   * null when there is no session (the pipeline waits and retries).
   */
  tokenProvider: () => Promise<string | null>
  onEvent: (event: AdapterEvent) => void
  /** Opens a socket. Injected so tests never touch the network. */
  socketFactory: (url: string) => PipelineSocket
  sleepFn?: (ms: number) => Promise<void>
  /** Logging is injected — this module stays electron-free (directory contract). */
  log?: (level: 'info' | 'warn' | 'debug', message: string, meta?: unknown) => void
}

// ─── Wire schemas ─────────────────────────────────────────────────────────────

/**
 * Outer envelope. `content` is a double-encoded JSON STRING for every known
 * event — but accept an already-decoded object too (defensive: the double-
 * encode is mock-verified, and CLAUDE.md wants unknown drift to degrade, not
 * vanish). A string is JSON-parsed; an object is used as-is.
 */
const envelopeSchema = z.object({
  type: z.string(),
  content: z.union([z.string(), z.record(z.string(), z.unknown())])
})

/** Friend events that carry a full user object (+ optional location fields). */
const friendWithUserSchema = z.object({
  userId: z.string(),
  user: rawFriendSchema,
  location: z.string().nullable().optional(),
  travelingToLocation: z.string().nullable().optional()
})

/** Events that only carry the user id (`friend-offline`, `friend-delete`). */
const friendIdSchema = z.object({ userId: z.string() })

// ─── Client ───────────────────────────────────────────────────────────────────

const noJitter = (): number => Math.floor(Math.random() * 250)
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class VrcPipeline {
  private readonly deps: Required<
    Pick<VrcPipelineDeps, 'tokenProvider' | 'onEvent' | 'socketFactory'>
  > &
    Pick<VrcPipelineDeps, 'sleepFn' | 'log'>

  private socket: PipelineSocket | null = null
  private stopped = true
  private consecutiveFailures = 0
  /** Increments per start(); stale async loops from a previous run see it changed and exit. */
  private generation = 0

  constructor(deps: VrcPipelineDeps) {
    this.deps = deps
  }

  /** Begin the connect/reconnect loop. Idempotent while running. */
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.generation++
    void this.runLoop(this.generation)
  }

  /** Close the socket and stop reconnecting. Safe to call repeatedly. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.generation++
    this.closeSocket()
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private log(level: 'info' | 'warn' | 'debug', message: string, meta?: unknown): void {
    this.deps.log?.(level, message, meta)
  }

  private sleep(ms: number): Promise<void> {
    return (this.deps.sleepFn ?? defaultSleep)(ms)
  }

  private closeSocket(): void {
    try {
      this.socket?.close()
    } catch {
      /* already closing/closed */
    }
    this.socket = null
  }

  private backoffDelay(): number {
    const exp = Math.min(
      PIPELINE_BACKOFF_BASE_MS * 2 ** this.consecutiveFailures,
      PIPELINE_BACKOFF_CAP_MS
    )
    return exp + noJitter()
  }

  /**
   * One long-lived loop per start(): fetch token → connect → wait for close →
   * backoff → repeat. A generation bump (stop/start) exits stale loops.
   */
  private async runLoop(generation: number): Promise<void> {
    while (!this.stopped && generation === this.generation) {
      let token: string | null = null
      try {
        token = await this.deps.tokenProvider()
      } catch {
        token = null
      }
      if (this.stopped || generation !== this.generation) return

      if (token === null) {
        // No session yet (or re-auth in progress). Local wait — no network hit.
        this.emit({ type: 'connection', platform: 'vrchat', health: 'down' })
        const delay = this.backoffDelay()
        this.consecutiveFailures++
        await this.sleep(delay)
        continue
      }

      const closed = await this.connectOnce(token, generation)
      if (this.stopped || generation !== this.generation) return

      this.emit({ type: 'connection', platform: 'vrchat', health: 'reconnecting' })
      const delay = this.backoffDelay()
      this.consecutiveFailures++
      this.log('info', 'pipeline: reconnecting after close', { cleanOpen: closed.opened })
      await this.sleep(delay)
    }
  }

  /** Connect and resolve when the socket closes (however it closes). */
  private connectOnce(token: string, generation: number): Promise<{ opened: boolean }> {
    return new Promise((resolve) => {
      let opened = false
      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        // Only null the field if it still points at THIS socket — a rapid
        // stop()→start() may have already installed a newer one (the class
        // advertises safe restart), and nulling that would leak it.
        if (this.socket === socket) this.socket = null
        resolve({ opened })
      }

      let socket: PipelineSocket
      try {
        // Token goes in the query string — the UA header rides on the socket
        // factory (ws options at the call site). Never logged: the URL carries
        // the token, so log statements here must not include it.
        socket = this.deps.socketFactory(`${VRC_PIPELINE_URL}?authToken=${token}`)
      } catch (err) {
        this.log('warn', 'pipeline: socket construction failed', {
          message: err instanceof Error ? err.message : String(err)
        })
        settle()
        return
      }
      this.socket = socket

      socket.on('open', () => {
        if (this.stopped || generation !== this.generation) return
        opened = true
        this.consecutiveFailures = 0
        this.log('info', 'pipeline: connected')
        // The consumer's reconcile trigger: refetch friends over REST so
        // anything missed while disconnected is caught (VRX-43/VRX-22).
        this.emit({ type: 'connection', platform: 'vrchat', health: 'live' })
      })

      socket.on('message', (data: unknown) => {
        if (this.stopped || generation !== this.generation) return
        this.handleMessage(data)
      })

      socket.on('error', (err: unknown) => {
        // 'close' always follows 'error' — log only; settle on close.
        this.log('warn', 'pipeline: socket error', {
          message: err instanceof Error ? err.message : String(err)
        })
      })

      socket.on('close', () => settle())
    })
  }

  private emit(event: AdapterEvent): void {
    try {
      this.deps.onEvent(event)
    } catch {
      // A consumer throwing must never kill the socket loop.
      this.log('warn', 'pipeline: event handler threw')
    }
  }

  /** Decode one wire message. NEVER throws — malformed data is logged and dropped. */
  private handleMessage(data: unknown): void {
    let outer: z.infer<typeof envelopeSchema>
    try {
      const text =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf8')
            : String(data)
      const parsed = envelopeSchema.safeParse(JSON.parse(text))
      if (!parsed.success) {
        this.log('debug', 'pipeline: non-envelope message dropped')
        return
      }
      outer = parsed.data
    } catch {
      this.log('debug', 'pipeline: unparseable frame dropped')
      return
    }

    // Double-encoded content: the inner payload is itself a JSON string —
    // parse it. If the server ever sends a decoded object, use it directly.
    let content: unknown
    if (typeof outer.content === 'string') {
      try {
        content = JSON.parse(outer.content)
      } catch {
        this.log('debug', 'pipeline: undecodable content dropped', { type: outer.type })
        return
      }
    } else {
      content = outer.content
    }

    const event = this.mapEvent(outer.type, content)
    if (event) this.emit(event)
  }

  /**
   * Map a decoded wire event to a normalized AdapterEvent, or null for events
   * that are recognized-but-unrouted (notifications — VRX-84) or unknown.
   */
  private mapEvent(type: string, content: unknown): AdapterEvent | null {
    switch (type) {
      case 'friend-online':
      case 'friend-location':
        return this.presenceEvent(content, 'in-game')
      case 'friend-active':
        return this.presenceEvent(content, 'active')
      case 'friend-offline': {
        const parsed = friendIdSchema.safeParse(content)
        if (!parsed.success) return this.dropped(type)
        return { type: 'friend-offline', platform: 'vrchat', platformUserId: parsed.data.userId }
      }
      case 'friend-add': {
        const friend = this.buildFriend(content, 'active')
        if (!friend) return this.dropped(type)
        return { type: 'friend-added', platform: 'vrchat', friend }
      }
      case 'friend-delete': {
        const parsed = friendIdSchema.safeParse(content)
        if (!parsed.success) return this.dropped(type)
        return { type: 'friend-removed', platform: 'vrchat', platformUserId: parsed.data.userId }
      }
      case 'friend-update': {
        // Profile change only — the consumer merges fields and PRESERVES its
        // cached presence/instance (the wire says nothing about either).
        const friend = this.buildFriend(content, 'offline')
        if (!friend) return this.dropped(type)
        return { type: 'friend-updated', platform: 'vrchat', friend }
      }
      case 'notification':
      case 'notification-v2':
      case 'notification-v2-update':
      case 'notification-v2-delete':
      case 'response-notification':
      case 'see-notification':
      case 'hide-notification':
      case 'clear-notification':
        // Recognized, decoded, deliberately unrouted: the notifications store
        // lands with VRX-84/86/87. Logged so drift stays visible until then.
        this.log('debug', 'pipeline: notification event (unrouted until VRX-84)', { type })
        return null
      case 'user-update':
      case 'user-location':
      case 'user-badge-assigned':
      case 'content-refresh':
        this.log('debug', 'pipeline: self/content event ignored', { type })
        return null
      default:
        // Unknown event types degrade silently-but-visibly (never throw).
        this.log('debug', 'pipeline: unknown event type ignored', { type })
        return null
    }
  }

  private dropped(type: string): null {
    this.log('debug', 'pipeline: malformed event payload dropped', { type })
    return null
  }

  private presenceEvent(content: unknown, state: 'in-game' | 'active'): AdapterEvent | null {
    const friend = this.buildFriend(content, state)
    if (!friend) return null
    return { type: 'friend-presence', platform: 'vrchat', friend }
  }

  /**
   * Build a full Friend from a WS payload via the SAME normalize path as REST.
   * The event type carries the presence state, so the buckets are synthetic.
   */
  private buildFriend(
    content: unknown,
    state: 'in-game' | 'active' | 'offline'
  ): ReturnType<typeof normalize> | null {
    const parsed = friendWithUserSchema.safeParse(content)
    if (!parsed.success) {
      this.log('debug', 'pipeline: friend payload failed validation')
      return null
    }
    const { userId, user, location } = parsed.data
    const friend = normalize(user, {
      onlineFriends: state === 'in-game' ? [userId] : [],
      activeFriends: state === 'active' ? [userId] : [],
      offlineFriends: state === 'offline' ? [userId] : []
    })
    // Only an in-game friend is in a world (§5 axes): active = on the
    // website/app, offline = nowhere — force those to no instance regardless of
    // any stale location the payload carries. For in-game, the event-level
    // location is fresher than user.location; 'traveling' parses to null → the
    // documented "Private" approximation until the next friend-location lands.
    if (state === 'in-game') {
      if (location !== undefined) friend.instance = parseLocation(location ?? '')
    } else {
      friend.instance = null
    }
    return friend
  }
}
