/**
 * VrcPipeline tests (VRX-146).
 *
 * A fake socket drives the full lifecycle — connect, double-decode, per-event
 * mapping, malformed-frame tolerance, reconnect backoff, stop. No network.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import type { PipelineSocket } from './VrcPipeline'
import { VrcPipeline } from './VrcPipeline'

// ─── Harness ──────────────────────────────────────────────────────────────────

type Listener = (...args: unknown[]) => void

class FakeSocket implements PipelineSocket {
  listeners = new Map<string, Listener[]>()
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

  fire(event: string, ...args: unknown[]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(...args)
  }
}

/** Let pending microtask/immediate chains settle. */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

interface Rig {
  pipeline: VrcPipeline
  events: AdapterEvent[]
  sockets: FakeSocket[]
  urls: string[]
  sleeps: number[]
  tokenProvider: ReturnType<typeof vi.fn>
}

function rig(opts: { token?: string | null | (() => string | null) } = {}): Rig {
  const events: AdapterEvent[] = []
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const sleeps: number[] = []
  const tokenValue = 'token' in opts ? opts.token : 'authcookie_tok1'
  const tokenProvider = vi.fn(() =>
    Promise.resolve(typeof tokenValue === 'function' ? tokenValue() : (tokenValue ?? null))
  )

  const pipeline = new VrcPipeline({
    tokenProvider,
    onEvent: (e) => events.push(e),
    socketFactory: (url) => {
      urls.push(url)
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    sleepFn: (ms) => {
      sleeps.push(ms)
      return tick()
    }
  })

  return { pipeline, events, sockets, urls, sleeps, tokenProvider }
}

/** Wire frame builder — outer envelope with DOUBLE-ENCODED content. */
const frame = (type: string, content: unknown): string =>
  JSON.stringify({ type, content: JSON.stringify(content) })

const USER = {
  id: 'usr_1',
  displayName: 'Alice',
  currentAvatarThumbnailImageUrl: 'https://example.com/a.png',
  status: 'join me',
  statusDescription: 'exploring',
  tags: ['system_trust_known']
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VrcPipeline', () => {
  it('connects with the token in the query string and emits live on open', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()

    expect(r.urls[0]).toBe('wss://pipeline.vrchat.cloud/?authToken=authcookie_tok1')
    r.sockets[0]!.fire('open')
    expect(r.events).toEqual([{ type: 'connection', platform: 'vrchat', health: 'live' }])
    r.pipeline.stop()
  })

  it('maps friend-online to friend-presence with state in-game and a parsed instance', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame('friend-online', {
        userId: 'usr_1',
        user: USER,
        location: 'wrld_abc:123~region(us)'
      })
    )

    const e = r.events.at(-1)
    expect(e).toMatchObject({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: {
        platformUserId: 'usr_1',
        displayName: 'Alice',
        presence: { state: 'in-game' },
        status: 'join-me',
        trustRank: 'user' // system_trust_known → display rank 'user' (offset ladder)
      }
    })
    if (e?.type !== 'friend-presence') throw new Error('unreachable')
    expect(e.friend.instance).toMatchObject({ worldId: 'wrld_abc', region: 'us' })
    r.pipeline.stop()
  })

  it('maps friend-active to state active with no instance', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire('message', frame('friend-active', { userId: 'usr_1', user: USER }))

    expect(r.events.at(-1)).toMatchObject({
      type: 'friend-presence',
      friend: { presence: { state: 'active' }, instance: null }
    })
    r.pipeline.stop()
  })

  it('maps friend-location traveling to in-game with a null instance (the Private approximation)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame('friend-location', {
        userId: 'usr_1',
        user: { ...USER, location: 'wrld_old:1' },
        location: 'traveling',
        travelingToLocation: 'wrld_next:9'
      })
    )

    // The event-level location wins over user.location; 'traveling' → null.
    expect(r.events.at(-1)).toMatchObject({
      type: 'friend-presence',
      friend: { presence: { state: 'in-game' }, instance: null }
    })
    r.pipeline.stop()
  })

  it('maps friend-offline to the userId-only delta', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire('message', frame('friend-offline', { userId: 'usr_1' }))

    expect(r.events.at(-1)).toEqual({
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'usr_1'
    })
    r.pipeline.stop()
  })

  it('maps friend-add / friend-delete / friend-update', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire('message', frame('friend-add', { userId: 'usr_1', user: USER }))
    expect(r.events.at(-1)).toMatchObject({
      type: 'friend-added',
      friend: { platformUserId: 'usr_1' }
    })

    r.sockets[0]!.fire('message', frame('friend-update', { userId: 'usr_1', user: USER }))
    expect(r.events.at(-1)).toMatchObject({
      type: 'friend-updated',
      friend: { displayName: 'Alice' }
    })

    r.sockets[0]!.fire('message', frame('friend-delete', { userId: 'usr_1' }))
    expect(r.events.at(-1)).toEqual({
      type: 'friend-removed',
      platform: 'vrchat',
      platformUserId: 'usr_1'
    })
    r.pipeline.stop()
  })

  it('drops unknown types, notifications (unrouted until VRX-84), and malformed frames without throwing', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')
    const baseline = r.events.length

    r.sockets[0]!.fire('message', frame('some-future-event', { anything: 1 }))
    r.sockets[0]!.fire('message', frame('notification-v2', { id: 'not_1' }))
    r.sockets[0]!.fire('message', 'not json at all')
    r.sockets[0]!.fire('message', JSON.stringify({ type: 'friend-online' })) // no content
    r.sockets[0]!.fire('message', JSON.stringify({ type: 'friend-online', content: '{broken' }))
    r.sockets[0]!.fire('message', frame('friend-online', { userId: 'usr_1' })) // no user object
    r.sockets[0]!.fire('message', Buffer.from(frame('friend-offline', { userId: 'usr_b' })))

    // Only the Buffer frame (valid, exercises binary decode) produced an event.
    expect(r.events.length).toBe(baseline + 1)
    expect(r.events.at(-1)).toMatchObject({ type: 'friend-offline', platformUserId: 'usr_b' })
    r.pipeline.stop()
  })

  it('accepts an already-decoded object content (defensive: double-encode is mock-verified)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    // content as an OBJECT, not a stringified JSON payload.
    r.sockets[0]!.fire(
      'message',
      JSON.stringify({ type: 'friend-offline', content: { userId: 'usr_obj' } })
    )

    expect(r.events.at(-1)).toEqual({
      type: 'friend-offline',
      platform: 'vrchat',
      platformUserId: 'usr_obj'
    })
    r.pipeline.stop()
  })

  it('a friend-active event never yields an instance even if the payload carries a location (§5)', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.sockets[0]!.fire(
      'message',
      frame('friend-active', {
        userId: 'usr_1',
        user: { ...USER, location: 'wrld_x:1' },
        location: 'wrld_x:1'
      })
    )

    expect(r.events.at(-1)).toMatchObject({
      type: 'friend-presence',
      friend: { presence: { state: 'active' }, instance: null }
    })
    r.pipeline.stop()
  })

  it('reconnects after close with a FRESH token and growing backoff', async () => {
    let n = 0
    const r = rig({ token: () => `authcookie_tok${++n}` })
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')
    r.sockets[0]!.fire('close')
    await tick()
    await tick()

    expect(r.events).toContainEqual({
      type: 'connection',
      platform: 'vrchat',
      health: 'reconnecting'
    })
    expect(r.tokenProvider.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(r.urls[1]).toContain('authToken=authcookie_tok2')

    // Second failure → larger backoff window (1s→2s base, both +jitter<250).
    r.sockets[1]!.fire('close')
    await tick()
    await tick()
    expect(r.sleeps[0]!).toBeGreaterThanOrEqual(1000)
    expect(r.sleeps[0]!).toBeLessThan(1250)
    expect(r.sleeps[1]!).toBeGreaterThanOrEqual(2000)
    expect(r.sleeps[1]!).toBeLessThan(2250)
    r.pipeline.stop()
  })

  it('waits without connecting when the token provider yields null (no session)', async () => {
    const r = rig({ token: null })
    r.pipeline.start()
    await tick()
    await tick()

    expect(r.urls).toHaveLength(0) // never dialed
    expect(r.events).toContainEqual({ type: 'connection', platform: 'vrchat', health: 'down' })
    r.pipeline.stop()
  })

  it('stop() closes the socket and halts reconnection', async () => {
    const r = rig()
    r.pipeline.start()
    await tick()
    r.sockets[0]!.fire('open')

    r.pipeline.stop()
    await tick()
    await tick()

    expect(r.sockets[0]!.closeCalls).toBe(1)
    expect(r.sockets).toHaveLength(1) // no new dial after stop
    const healths = r.events.filter((e) => e.type === 'connection').map((e) => e.health)
    expect(healths).not.toContain('reconnecting') // stop is silent, not a reconnect
  })

  it('a throwing event handler never kills the message loop', async () => {
    const events: AdapterEvent[] = []
    let first = true
    const sockets: FakeSocket[] = []
    const pipeline = new VrcPipeline({
      tokenProvider: () => Promise.resolve('authcookie_t'),
      onEvent: (e) => {
        if (first) {
          first = false
          throw new Error('consumer bug')
        }
        events.push(e)
      },
      socketFactory: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s
      },
      sleepFn: () => tick()
    })
    pipeline.start()
    await tick()

    sockets[0]!.fire('open') // handler throws on the live event
    sockets[0]!.fire('message', frame('friend-offline', { userId: 'usr_1' }))

    expect(events).toHaveLength(1) // the second event still flowed
    pipeline.stop()
  })

  it('start() is idempotent while running (one loop, one socket)', async () => {
    const r = rig()
    r.pipeline.start()
    r.pipeline.start()
    await tick()
    await tick()

    expect(r.sockets).toHaveLength(1)
    r.pipeline.stop()
  })
})
