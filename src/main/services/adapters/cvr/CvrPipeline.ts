/**
 * ChilloutVR WebSocket client (VRX-147).
 *
 * CVR's WS (`wss://api.chilloutvr.net/1/users/ws`) is the real-time source for
 * friend presence/instance + invites — used instead of per-friend polling.
 * Lifecycle (reconnect/backoff/generation) lives in `ReconnectingPipeline`;
 * this class owns the CVR wire specifics:
 *
 * - Auth = the SAME `Username`/`AccessKey` (+ `Platform`, `User-Agent`) headers
 *   as REST, sent on the UPGRADE HANDSHAKE (not a query token) — the injected
 *   `headersProvider` yields them per attempt, null with no session.
 * - Clean JSON — NOT double-encoded (unlike VRChat's Pipeline). Parse once.
 * - Envelope: `{ ResponseType: <int>, Message, Data }`. chilloutvr_rs reads a
 *   lowercase `responseType`, so BOTH casings are accepted (wire casing is
 *   unconfirmed until observed live).
 * - `10` ONLINE_FRIENDS is a FULL current-online-set snapshot of
 *   `{id, isOnline, instance}` — no profiles — mapped to the
 *   `presence-snapshot` AdapterEvent (absent-from-snapshot ⇒ offline; the
 *   consumer patches its cached roster). CVR has NO status/trust (§5) — the
 *   entries never fabricate them.
 * - `11` FRIEND_LIST_UPDATED → `roster-changed` (trigger-only; consumer
 *   refetches the roster over REST).
 * - Invites/requests/notifications (15/20/25/0/1/2/30/50) are decoded + logged
 *   but deliberately unrouted — their stores/features don't exist yet (same
 *   deferral pattern as VRX-146's notifications).
 * - BIDIRECTIONAL: outgoing `{ RequestType, Data }` senders for the friend-
 *   request/invite/block action family. 🟡 The Data payload shapes are
 *   mock-verified against CVRX notes — confirm on first live use.
 * - Unknown ResponseTypes / malformed payloads: logged, ignored, never throw.
 *
 * NOTE: no application-level keepalive is sent. The server pings (~60s) and
 * `ws` auto-responds with pongs at the protocol level; the RequestType-0
 * "SelfOnline" keepalive CVRX reportedly sends is deliberately omitted until
 * observed necessary on a live session.
 */
import { z } from 'zod'
import { CVR_WS_URL } from '@shared/constants'
import type { AdapterEvent, InstanceInfo } from '@shared/types'
import {
  ReconnectingPipeline,
  type PipelineLog,
  type PipelineSocket
} from '../ReconnectingPipeline'
import { parseCvrPrivacy } from './parseCvrPrivacy'
import { extractCvrPlatformUserId } from './cvrPlatformUserId'

// ─── Injected surfaces ────────────────────────────────────────────────────────

export interface CvrPipelineDeps {
  /**
   * Auth headers for the NEXT connection attempt (Username/AccessKey/
   * User-Agent/Platform — same as REST, on the upgrade handshake), or null
   * when there is no session (the pipeline waits and retries).
   */
  headersProvider: () => Promise<Record<string, string> | null>
  onEvent: (event: AdapterEvent) => void
  /** Opens a socket with upgrade headers. Injected so tests never touch the network. */
  socketFactory: (url: string, headers: Record<string, string>) => PipelineSocket
  sleepFn?: (ms: number) => Promise<void>
  log?: PipelineLog
}

// ─── Wire constants + schemas ─────────────────────────────────────────────────

/** Incoming ResponseType catalog (verified vs CVRX / chilloutvr_rs, 2026-06-02). */
export const CVR_RESPONSE = {
  MENU_POPUP: 0,
  HUD_MESSAGE: 1,
  PUSH_NOTIFICATION: 2,
  ONLINE_FRIENDS: 10,
  FRIEND_LIST_UPDATED: 11,
  INVITES: 15,
  REQUEST_INVITES: 20,
  FRIEND_REQUESTS: 25,
  MATURE_CONTENT_UPDATE: 30,
  GROUP_INVITE: 50
} as const

/** Outgoing RequestType catalog. */
export const CVR_REQUEST = {
  FRIEND_REQUEST_SEND: 5,
  FRIEND_REQUEST_ACCEPT: 6,
  FRIEND_REQUEST_DECLINE: 7,
  UNFRIEND: 8,
  INVITE_SEND: 10,
  REQUEST_INVITE: 15,
  BLOCK: 30,
  UNBLOCK: 31
} as const

/**
 * Envelope — the wire casing is unconfirmed (`ResponseType` per CVRX,
 * `responseType` per chilloutvr_rs), so both are accepted and normalized.
 */
const envelopeSchema = z
  .object({
    ResponseType: z.number().int().optional(),
    responseType: z.number().int().optional(),
    Data: z.unknown().optional(),
    data: z.unknown().optional()
  })
  .refine((v) => v.ResponseType !== undefined || v.responseType !== undefined, {
    message: 'missing ResponseType'
  })

/**
 * ONLINE_FRIENDS entry: ids + instance only — NO profile fields on the wire.
 * Only `id` is critical; the WHOLE instance object degrades to null on any
 * malformation (`.catch(null)`) — a broken enrichment field must never kill
 * the entry, because a skipped entry reads as absent-from-snapshot ⇒ the
 * friend would wrongly flip OFFLINE (the W4 severity ladder: presence is the
 * critical payload, instance is enrichment; null renders as "Private").
 */
// CVR's WS sends PascalCase on the wire (`Id`/`IsOnline`/`Instance`; the nested
// Instance is `Id`/`Name`/`Privacy`, `Privacy` a NUMERIC enum), while CVRX docs
// show camelCase — so accept BOTH casings and normalize, mirroring the envelope's
// dual-casing handling above (real capture 2026-07-07). Instance is enrichment:
// any mismatch (incl. the numeric `Privacy`, whose enum is unconfirmed — VRX-130)
// degrades that field to null ⇒ "Private", never dropping the entry.
const onlineInstanceSchema = z
  .object({
    Id: z.string().optional(),
    id: z.string().optional(),
    Name: z.string().nullable().catch(null).optional(),
    name: z.string().nullable().catch(null).optional(),
    // NUMERIC enum on the live wire (0=public … 6=group, parseCvrPrivacy);
    // string kept for the CVRX-documented casing. Mismatch degrades to null.
    Privacy: z.union([z.number(), z.string()]).nullable().catch(null).optional(),
    privacy: z.union([z.number(), z.string()]).nullable().catch(null).optional()
  })
  .transform((v) => {
    const id = v.Id ?? v.id
    // An instance with no id is useless (can't key/join it) — degrade the whole
    // instance to null (⇒ "Private") rather than emit a bogus empty-worldId one.
    if (id === undefined) return null
    return { id, name: v.Name ?? v.name ?? null, privacy: v.Privacy ?? v.privacy ?? null }
  })

const onlineFriendSchema = z
  .object({
    Id: z.string().optional(),
    id: z.string().optional(),
    IsOnline: z.boolean().optional(),
    isOnline: z.boolean().optional(),
    Instance: onlineInstanceSchema.nullable().catch(null).optional(),
    instance: onlineInstanceSchema.nullable().catch(null).optional()
  })
  .transform((v) => ({
    id: v.Id ?? v.id,
    isOnline: v.IsOnline ?? v.isOnline,
    instance: v.Instance ?? v.instance ?? null
  }))

const onlineFriendsSchema = z.array(z.unknown())

// ─── Client ───────────────────────────────────────────────────────────────────

export class CvrPipeline extends ReconnectingPipeline<Record<string, string>> {
  protected readonly platform = 'chilloutvr' as const

  private readonly headersProvider: () => Promise<Record<string, string> | null>
  private readonly socketFactory: (url: string, headers: Record<string, string>) => PipelineSocket

  /**
   * Merged current-online set. ONLINE_FRIENDS is a FULL set only on connect —
   * afterwards CVR sends 1-entry DELTAS (live capture 2026-07-07: an 11-entry
   * connect push, then `total: 1` updates). Treating a delta as a full snapshot
   * flipped everyone else offline (absent ⇒ offline). So deltas merge here
   * (IsOnline:false evicts) and every emit is the full merged set — the
   * renderer's snapshot contract stays exactly as before.
   */
  private readonly onlineSet = new Map<
    string,
    { platformUserId: string; presence: { state: 'in-game' }; instance: InstanceInfo | null }
  >()

  constructor(deps: CvrPipelineDeps) {
    super({ onEvent: deps.onEvent, sleepFn: deps.sleepFn, log: deps.log })
    this.headersProvider = deps.headersProvider
    this.socketFactory = deps.socketFactory
  }

  protected prepareConnection(): Promise<Record<string, string> | null> {
    // Fresh (re)connect ⇒ CVR will push a fresh FULL set; drop the stale merge
    // so friends who went offline while we were disconnected don't linger.
    this.onlineSet.clear()
    return this.headersProvider()
  }

  protected openSocket(headers: Record<string, string>): PipelineSocket {
    // Credentials ride in the upgrade headers — never logged.
    return this.socketFactory(CVR_WS_URL, headers)
  }

  // ── Outgoing (bidirectional) ────────────────────────────────────────────────

  /**
   * Send one `{ RequestType, Data }` action. Returns false (and logs) when the
   * socket isn't connected — actions are NOT queued; callers retry after the
   * connection event. 🟡 Data shapes are mock-verified; confirm live.
   */
  private send(requestType: number, data: Record<string, unknown>): boolean {
    // Gate on isOpen, not socket presence: pre-open the field is already set
    // (ws would throw), and in the CLOSING window ws silently drops frames
    // (send would false-report success). isOpen is true only open→settle.
    if (!this.isOpen || !this.socket?.send) {
      this.log('warn', 'cvr pipeline: send while disconnected dropped', { requestType })
      return false
    }
    try {
      this.socket.send(JSON.stringify({ RequestType: requestType, Data: data }))
      return true
    } catch (err) {
      this.log('warn', 'cvr pipeline: send failed', {
        requestType,
        message: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  }

  sendFriendRequest(userId: string): boolean {
    return this.send(CVR_REQUEST.FRIEND_REQUEST_SEND, { id: userId })
  }
  acceptFriendRequest(userId: string): boolean {
    return this.send(CVR_REQUEST.FRIEND_REQUEST_ACCEPT, { id: userId })
  }
  declineFriendRequest(userId: string): boolean {
    return this.send(CVR_REQUEST.FRIEND_REQUEST_DECLINE, { id: userId })
  }
  unfriend(userId: string): boolean {
    return this.send(CVR_REQUEST.UNFRIEND, { id: userId })
  }
  sendInvite(userId: string, instanceId: string): boolean {
    return this.send(CVR_REQUEST.INVITE_SEND, { id: userId, instanceId })
  }
  requestInvite(userId: string): boolean {
    return this.send(CVR_REQUEST.REQUEST_INVITE, { id: userId })
  }
  block(userId: string): boolean {
    return this.send(CVR_REQUEST.BLOCK, { id: userId })
  }
  unblock(userId: string): boolean {
    return this.send(CVR_REQUEST.UNBLOCK, { id: userId })
  }

  // ── Incoming ────────────────────────────────────────────────────────────────

  /** Decode one wire message. NEVER throws — malformed data is logged and dropped. */
  protected handleMessage(data: unknown): void {
    let responseType: number
    let payload: unknown
    try {
      const text =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf8')
            : String(data)
      const parsed = envelopeSchema.safeParse(JSON.parse(text))
      if (!parsed.success) {
        this.log('debug', 'cvr pipeline: non-envelope message dropped')
        return
      }
      responseType = (parsed.data.ResponseType ?? parsed.data.responseType)!
      payload = parsed.data.Data ?? parsed.data.data
    } catch {
      this.log('debug', 'cvr pipeline: unparseable frame dropped')
      return
    }

    const event = this.mapEvent(responseType, payload)
    if (event) this.emit(event)
  }

  private mapEvent(responseType: number, payload: unknown): AdapterEvent | null {
    switch (responseType) {
      case CVR_RESPONSE.ONLINE_FRIENDS:
        return this.onlineFriendsEvent(payload)
      case CVR_RESPONSE.FRIEND_LIST_UPDATED:
        // Roster add/remove — trigger-only; the consumer refetches over REST.
        return { type: 'roster-changed', platform: 'chilloutvr' }
      case CVR_RESPONSE.INVITES:
      case CVR_RESPONSE.REQUEST_INVITES:
      case CVR_RESPONSE.FRIEND_REQUESTS:
      case CVR_RESPONSE.MENU_POPUP:
      case CVR_RESPONSE.HUD_MESSAGE:
      case CVR_RESPONSE.PUSH_NOTIFICATION:
      case CVR_RESPONSE.MATURE_CONTENT_UPDATE:
      case CVR_RESPONSE.GROUP_INVITE:
        // Recognized, deliberately unrouted — invites/requests/notification
        // stores don't exist yet (same deferral pattern as VRX-146).
        this.log('debug', 'cvr pipeline: recognized event unrouted', { responseType })
        return null
      default:
        this.log('debug', 'cvr pipeline: unknown ResponseType ignored', { responseType })
        return null
    }
  }

  /**
   * ONLINE_FRIENDS → presence-snapshot. The wire message is a FULL set only on
   * connect; afterwards it carries 1-entry DELTAS. Entries merge into
   * `onlineSet` (IsOnline:false evicts) and the event emitted downstream is
   * always the full merged set, so the renderer's absent-⇒-offline snapshot
   * semantics stay correct. Per-entry validation — one malformed entry is
   * skipped, the rest survive (the W4 lesson). CVR has no 'active' state and
   * no status/trust — never fabricated (§5).
   */
  private onlineFriendsEvent(payload: unknown): AdapterEvent | null {
    const list = onlineFriendsSchema.safeParse(payload)
    if (!list.success) {
      this.log('debug', 'cvr pipeline: ONLINE_FRIENDS payload not an array')
      return null
    }

    let skipped = 0
    for (const raw of list.data) {
      const parsed = onlineFriendSchema.safeParse(raw)
      if (!parsed.success || parsed.data.id === undefined) {
        skipped++
        continue
      }
      // Normalize the id EXACTLY as the REST roster does (VRX-61): the roster
      // lowercases+validates the GUID, so the raw WS id must go through the same
      // extractor or presence-snapshot entries won't match any cached friend and
      // EVERYONE flips offline (the join key is platformUserId).
      const idResult = extractCvrPlatformUserId(parsed.data.id)
      if (!idResult.ok) {
        skipped++
        continue
      }
      // isOnline:false marks a friend LEAVING in a delta — evict from the set.
      if (parsed.data.isOnline === false) {
        this.onlineSet.delete(idResult.platformUserId)
        continue
      }
      this.onlineSet.set(idResult.platformUserId, {
        platformUserId: idResult.platformUserId,
        presence: { state: 'in-game' },
        instance: this.instanceOf(parsed.data.instance ?? null)
      })
    }
    if (skipped > 0) {
      this.log('debug', 'cvr pipeline: skipped malformed ONLINE_FRIENDS entries', { skipped })
    }
    const entries = [...this.onlineSet.values()]
    return { type: 'presence-snapshot', platform: 'chilloutvr', entries }
  }

  private instanceOf(
    instance: { id: string; name: string | null; privacy: string | number | null } | null
  ): InstanceInfo | null {
    if (instance === null) return null
    const access = parseCvrPrivacy(instance.privacy)
    return {
      // CVR identifies the INSTANCE; it doubles as the grouping key the
      // dashboard uses (worldId) — CVR has no separate world id on this wire.
      worldId: instance.id,
      instanceId: instance.id,
      worldName: instance.name,
      thumbnailUrl: null,
      type: access.type,
      openness: access.openness,
      isGroup: access.isGroup,
      groupName: null,
      region: null,
      userCount: null
    }
  }
}
