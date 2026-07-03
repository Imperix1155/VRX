/**
 * CvrPipeline tests (VRX-147) — a fake socket drives the CVR wire specifics:
 * header auth on the upgrade, clean-JSON envelope in BOTH casings,
 * ONLINE_FRIENDS → presence-snapshot, outgoing RequestType senders, and the
 * inherited reconnect discipline. No network.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import type { PipelineSocket } from '../ReconnectingPipeline'
import { CvrPipeline } from './CvrPipeline'

type Listener = (...args: unknown[]) => void

class FakeSocket implements PipelineSocket {
  listeners = new Map<string, Listener[]>()
  sent: string[] = []
  closeCalls = 0

  on(event: string, listener: Listener): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }

  close(): void {
    this.closeCalls++
    this.fire('close')
  }

  send(data: string): void {
    this.sent.push(data)
  }

  fire(event: string, ...args: unknown[]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(...args)
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

interface Rig {
  pipeline: CvrPipeline
  events: AdapterEvent[]
  sockets: FakeSocket[]
  dials: Array<{ url: string; headers: Record<string, string> }>
  headersProvider: ReturnType<typeof vi.fn>
}

const AUTH_HEADERS = { Username: 'cvr-user', AccessKey: 'ak_1', 'User-Agent': 'VRX' }

function rig(opts: { headers?: Record<string, string> | null } = {}): Rig {
  const events: AdapterEvent[] = []
  const sockets: FakeSocket[] = []
  const dials: Array<{ url: string; headers: Record<string, string> }> = []
  const headersValue = 'headers' in opts ? opts.headers : AUTH_HEADERS
  const headersProvider = vi.fn(() => Promise.resolve(headersValue ?? null))

  const pipeline = new CvrPipeline({
    headersProvider,
    onEvent: (e) => events.push(e),
    socketFactory: (url, headers) => {
      dials.push({ url, headers })
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    sleepFn: () => tick()
  })

  return { pipeline, events, sockets, dials, headersProvider }
}

const frame = (envelope: unknown): string => JSON.stringify(envelope)

describe('CvrPipeline', () => {
  it('dials the CVR WS URL with the auth headers on the upgrade (never a query token)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()

    expect(r.dials[0]!.url).toBe('wss://api.chilloutvr.net/1/users/ws')
    expect(r.dials[0]!.headers).toEqual(AUTH_HEADERS)
    r.sockets[0]!.fire('open')
    expect(r.events).toEqual([{ type: 'connection', platform: 'chilloutvr', health: 'live' }])
    r.pipeline.stop()
  })

  it('maps ONLINE_FRIENDS to a presence-snapshot: in-game + parsed instance, null instance kept null', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame({
        ResponseType: 10,
        Message: '',
        Data: [
          {
            id: 'cvr_1',
            isOnline: true,
            instance: { id: 'i_abc', name: 'Chill Lounge', privacy: 'FriendsOfFriends' }
          },
          { id: 'cvr_2', isOnline: true, instance: null }
        ]
      })
    )

    expect(r.events.at(-1)).toEqual({
      type: 'presence-snapshot',
      platform: 'chilloutvr',
      entries: [
        {
          platformUserId: 'cvr_1',
          presence: { state: 'in-game' },
          instance: {
            worldId: 'i_abc',
            instanceId: 'i_abc',
            worldName: 'Chill Lounge',
            thumbnailUrl: null,
            type: 'friends-of-friends',
            openness: 'friends-plus',
            isGroup: false,
            groupName: null,
            region: null,
            userCount: null
          }
        },
        { platformUserId: 'cvr_2', presence: { state: 'in-game' }, instance: null }
      ]
    })
    r.pipeline.stop()
  })

  it('accepts the lowercase envelope casing (responseType/data — chilloutvr_rs report)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame({ responseType: 10, data: [{ id: 'cvr_low', isOnline: true, instance: null }] })
    )

    expect(r.events.at(-1)).toMatchObject({
      type: 'presence-snapshot',
      entries: [{ platformUserId: 'cvr_low' }]
    })
    r.pipeline.stop()
  })

  it('honors isOnline:false inside the set (offline, instance cleared)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame({
        ResponseType: 10,
        Data: [
          { id: 'cvr_1', isOnline: false, instance: { id: 'i', name: 'x', privacy: 'Public' } }
        ]
      })
    )

    expect(r.events.at(-1)).toMatchObject({
      entries: [{ presence: { state: 'offline' }, instance: null }]
    })
    r.pipeline.stop()
  })

  it('a MALFORMED instance degrades to null — presence SURVIVES (W4 ladder: never skip the entry)', async () => {
    // A skipped entry would read as absent-from-snapshot ⇒ wrongly OFFLINE.
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame({
        ResponseType: 10,
        Data: [
          { id: 'cvr_1', isOnline: true, instance: 42 }, // instance not an object
          { id: 'cvr_2', isOnline: true, instance: { name: 'no id' } } // missing required id
        ]
      })
    )

    const e = r.events.at(-1)
    if (e?.type !== 'presence-snapshot') throw new Error('expected presence-snapshot')
    expect(e.entries).toHaveLength(2) // BOTH survive, in-game with null instance
    expect(e.entries.every((x) => x.presence.state === 'in-game' && x.instance === null)).toBe(true)
    r.pipeline.stop()
  })

  it('a GroupsOnly instance carries the Group chip modifier (isGroup)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame({
        ResponseType: 10,
        Data: [
          {
            id: 'cvr_g',
            isOnline: true,
            instance: { id: 'i_g', name: 'Guild Hall', privacy: 'GroupsOnly' }
          }
        ]
      })
    )

    const e = r.events.at(-1)
    if (e?.type !== 'presence-snapshot') throw new Error('expected presence-snapshot')
    expect(e.entries[0]!.instance).toMatchObject({
      type: 'members-only',
      openness: 'invite',
      isGroup: true
    })
    r.pipeline.stop()
  })

  it('handles the falsy edges: ResponseType 0 routes (unrouted popup), Data:null tolerated', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')
    const baseline = r.events.length

    r.sockets[0]!.fire('message', frame({ ResponseType: 0, Data: { popup: true } })) // MENU_POPUP: recognized-unrouted, must not crash on falsy 0
    r.sockets[0]!.fire('message', frame({ ResponseType: 10, Data: null })) // null Data on a routed type → dropped, no throw
    r.sockets[0]!.fire('message', frame({ ResponseType: 11, Data: null })) // trigger-only ignores payload

    expect(r.events.length).toBe(baseline + 1)
    expect(r.events.at(-1)).toEqual({ type: 'roster-changed', platform: 'chilloutvr' })
    r.pipeline.stop()
  })

  it('send is gated on the OPEN window: false pre-open and false after close (never silent-drop)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()

    // Socket constructed but 'open' not yet fired — ws would throw here.
    expect(r.pipeline.sendFriendRequest('cvr_pre')).toBe(false)
    expect(r.sockets[0]!.sent).toHaveLength(0)

    r.sockets[0]!.fire('open')
    expect(r.pipeline.sendFriendRequest('cvr_mid')).toBe(true)

    // After close (the ws CLOSING/CLOSED window silently drops frames).
    r.sockets[0]!.fire('close')
    expect(r.pipeline.sendFriendRequest('cvr_post')).toBe(false)
    expect(r.sockets[0]!.sent).toHaveLength(1) // only the mid-window send
    r.pipeline.stop()
  })

  it('skips malformed ONLINE_FRIENDS entries — the rest survive (per-entry validation)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame({
        ResponseType: 10,
        Data: [{ nope: true }, { id: 'cvr_ok', isOnline: true, instance: null }, 42]
      })
    )

    const e = r.events.at(-1)
    if (e?.type !== 'presence-snapshot') throw new Error('expected presence-snapshot')
    expect(e.entries).toHaveLength(1)
    expect(e.entries[0]!.platformUserId).toBe('cvr_ok')
    r.pipeline.stop()
  })

  it('maps FRIEND_LIST_UPDATED to roster-changed (trigger-only)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire('message', frame({ ResponseType: 11, Data: null }))

    expect(r.events.at(-1)).toEqual({ type: 'roster-changed', platform: 'chilloutvr' })
    r.pipeline.stop()
  })

  it('drops recognized-unrouted, unknown, and malformed frames without throwing', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')
    const baseline = r.events.length

    r.sockets[0]!.fire('message', frame({ ResponseType: 25, Data: [] })) // FRIEND_REQUESTS: unrouted
    r.sockets[0]!.fire('message', frame({ ResponseType: 2, Data: {} })) // PUSH_NOTIFICATION: unrouted
    r.sockets[0]!.fire('message', frame({ ResponseType: 99, Data: {} })) // unknown
    r.sockets[0]!.fire('message', 'not json')
    r.sockets[0]!.fire('message', frame({ Message: 'no type field' }))
    r.sockets[0]!.fire('message', Buffer.from(frame({ ResponseType: 11 }))) // Buffer decode

    expect(r.events.length).toBe(baseline + 1) // only the Buffer roster-changed
    expect(r.events.at(-1)).toEqual({ type: 'roster-changed', platform: 'chilloutvr' })
    r.pipeline.stop()
  })

  it('sends the correct RequestType payloads for the action family (AC)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')
    const sock = r.sockets[0]!

    expect(r.pipeline.sendFriendRequest('cvr_9')).toBe(true)
    expect(r.pipeline.sendInvite('cvr_9', 'i_lounge')).toBe(true)
    expect(r.pipeline.block('cvr_9')).toBe(true)

    expect(JSON.parse(sock.sent[0]!)).toEqual({ RequestType: 5, Data: { id: 'cvr_9' } })
    expect(JSON.parse(sock.sent[1]!)).toEqual({
      RequestType: 10,
      Data: { id: 'cvr_9', instanceId: 'i_lounge' }
    })
    expect(JSON.parse(sock.sent[2]!)).toEqual({ RequestType: 30, Data: { id: 'cvr_9' } })
    r.pipeline.stop()
  })

  it('send while disconnected returns false and never throws (no queueing)', () => {
    const r = rig()
    // never started — no socket
    expect(r.pipeline.sendFriendRequest('cvr_9')).toBe(false)
    expect(r.pipeline.unblock('cvr_9')).toBe(false)
  })

  it('waits without dialing when headers are unavailable (no session)', async () => {
    const r = rig({ headers: null })
    r.pipeline.start()
    await tick()
    await tick()

    expect(r.dials).toHaveLength(0)
    expect(r.events).toContainEqual({
      type: 'connection',
      platform: 'chilloutvr',
      health: 'down'
    })
    r.pipeline.stop()
  })

  it('reconnects after close with FRESH headers (inherited discipline)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')
    r.sockets[0]!.fire('close')
    await tick()
    await tick()

    expect(r.events).toContainEqual({
      type: 'connection',
      platform: 'chilloutvr',
      health: 'reconnecting'
    })
    expect(r.headersProvider.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(r.dials.length).toBeGreaterThanOrEqual(2)
    r.pipeline.stop()
  })
})
