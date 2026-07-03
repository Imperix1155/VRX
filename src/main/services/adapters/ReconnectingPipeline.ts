/**
 * Shared reconnecting-WebSocket machinery for the platform pipelines
 * (VRX-146 VRChat / VRX-147 ChilloutVR — extracted when the second consumer
 * arrived, preserving the reviewed VRX-146 loop exactly).
 *
 * The base owns the hard-won lifecycle discipline:
 * - One long-lived loop per start(): prepare → connect → await close →
 *   backoff → repeat. Exponential backoff + jitter, reset on a successful open.
 * - A `generation` counter kills stale loops on stop()/start() — every await
 *   is followed by a stopped/generation recheck BEFORE side effects.
 * - `settle()` guards socket identity so a rapid stop→start can't null (and
 *   thereby leak) a newer socket.
 * - Consumer exceptions are isolated in emit() — a throwing handler never
 *   kills the socket loop.
 *
 * Subclasses supply the platform specifics:
 * - `prepareConnection()` — auth material for the NEXT attempt (VRChat: the
 *   pipeline token; CVR: the auth headers), or null when there is no session
 *   (the loop waits with backoff and retries — a fresh login is picked up
 *   automatically).
 * - `openSocket(prep)` — dial via the injected factory.
 * - `handleMessage(data)` — decode one wire frame; must NEVER throw.
 */
import { PIPELINE_BACKOFF_BASE_MS, PIPELINE_BACKOFF_CAP_MS } from '@shared/constants'
import type { AdapterEvent, Platform } from '@shared/types'

/** The slice of a WebSocket the pipelines use — `ws` satisfies it; tests fake it. */
export interface PipelineSocket {
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: unknown[]) => void): void
  close(): void
  /** Present on bidirectional sockets (CVR); VRChat's pipeline never sends. */
  send?(data: string): void
}

export type PipelineLog = (
  level: 'info' | 'warn' | 'debug',
  message: string,
  meta?: unknown
) => void

const jitter = (): number => Math.floor(Math.random() * 250)
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export abstract class ReconnectingPipeline<Prep> {
  protected abstract readonly platform: Platform

  private readonly onEvent: (event: AdapterEvent) => void
  private readonly sleepFn?: (ms: number) => Promise<void>
  private readonly logFn?: PipelineLog

  protected socket: PipelineSocket | null = null
  /**
   * True only between a socket's 'open' and its settle/close. Bidirectional
   * subclasses gate send() on THIS, not on `socket` being non-null: the field
   * is assigned pre-open (send would throw) and ws silently drops frames in
   * the CLOSING window (send would false-report success).
   */
  protected isOpen = false
  private stopped = true
  private consecutiveFailures = 0
  /** Increments per start(); stale async loops from a previous run see it changed and exit. */
  private generation = 0

  protected constructor(deps: {
    onEvent: (event: AdapterEvent) => void
    sleepFn?: (ms: number) => Promise<void>
    log?: PipelineLog
  }) {
    this.onEvent = deps.onEvent
    this.sleepFn = deps.sleepFn
    this.logFn = deps.log
  }

  // ── Subclass surface ────────────────────────────────────────────────────────

  /** Auth material for the next attempt, or null with no session (wait+retry). */
  protected abstract prepareConnection(): Promise<Prep | null>
  /** Dial the socket (via the injected factory). May throw — treated as a failed attempt. */
  protected abstract openSocket(prep: Prep): PipelineSocket
  /** Decode one wire frame. MUST never throw on wire data. */
  protected abstract handleMessage(data: unknown): void

  // ── Public lifecycle ────────────────────────────────────────────────────────

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

  // ── Shared internals ────────────────────────────────────────────────────────

  protected log(level: 'info' | 'warn' | 'debug', message: string, meta?: unknown): void {
    this.logFn?.(level, message, meta)
  }

  private sleep(ms: number): Promise<void> {
    return (this.sleepFn ?? defaultSleep)(ms)
  }

  private closeSocket(): void {
    try {
      this.socket?.close()
    } catch {
      /* already closing/closed */
    }
    this.socket = null
    this.isOpen = false
  }

  private backoffDelay(): number {
    const exp = Math.min(
      PIPELINE_BACKOFF_BASE_MS * 2 ** this.consecutiveFailures,
      PIPELINE_BACKOFF_CAP_MS
    )
    return exp + jitter()
  }

  private async runLoop(generation: number): Promise<void> {
    while (!this.stopped && generation === this.generation) {
      let prep: Prep | null = null
      try {
        prep = await this.prepareConnection()
      } catch {
        prep = null
      }
      if (this.stopped || generation !== this.generation) return

      if (prep === null) {
        // No session yet (or re-auth in progress). Local wait — no network hit.
        this.emit({ type: 'connection', platform: this.platform, health: 'down' })
        const delay = this.backoffDelay()
        this.consecutiveFailures++
        await this.sleep(delay)
        continue
      }

      const closed = await this.connectOnce(prep, generation)
      if (this.stopped || generation !== this.generation) return

      this.emit({ type: 'connection', platform: this.platform, health: 'reconnecting' })
      const delay = this.backoffDelay()
      this.consecutiveFailures++
      this.log('info', 'pipeline: reconnecting after close', { cleanOpen: closed.opened })
      await this.sleep(delay)
    }
  }

  /** Connect and resolve when the socket closes (however it closes). */
  private connectOnce(prep: Prep, generation: number): Promise<{ opened: boolean }> {
    return new Promise((resolve) => {
      let opened = false
      let settled = false
      let socket: PipelineSocket | null = null
      const settle = (): void => {
        if (settled) return
        settled = true
        // Only null the field if it still points at THIS socket — a rapid
        // stop()→start() may have already installed a newer one, and nulling
        // that would leak it.
        if (this.socket === socket) {
          this.socket = null
          this.isOpen = false
        }
        resolve({ opened })
      }

      try {
        // Auth material rides on openSocket (URL token or upgrade headers) —
        // never logged from here.
        socket = this.openSocket(prep)
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
        this.isOpen = true
        this.consecutiveFailures = 0
        this.log('info', 'pipeline: connected')
        // The consumer's reconcile trigger: refetch over REST so anything
        // missed while disconnected is caught.
        this.emit({ type: 'connection', platform: this.platform, health: 'live' })
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

  protected emit(event: AdapterEvent): void {
    try {
      this.onEvent(event)
    } catch {
      // A consumer throwing must never kill the socket loop.
      this.log('warn', 'pipeline: event handler threw')
    }
  }
}
