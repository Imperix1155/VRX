import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import { CvrAdapter } from './CvrAdapter'
import { jsonResponse, instantAdmission } from './__testutils__/adapterTestKit'
import {
  fakeStore,
  authPayload,
  envelope,
  markSessionEstablishedForTest
} from './__testutils__/cvrAdapterTestKit'

class Socket extends EventEmitter {
  close = vi.fn(() => {
    this.emit('close')
  })
}

/** /users/auth answers from the queue; any other request fails the test. */
function routed(authResponses: Array<() => Promise<Response>>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: RequestInfo | URL) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (!href.endsWith('/users/auth')) throw new Error(`unexpected request ${href}`)
    const next = authResponses.shift()
    if (!next) throw new Error('unexpected reauth')
    return next()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function setup(): {
  adapter: CvrAdapter
  store: ReturnType<typeof fakeStore>
  events: AdapterEvent[]
  sockets: Socket[]
} {
  const sockets: Socket[] = []
  const events: AdapterEvent[] = []
  const store = fakeStore({ username: 'trinity', accessKey: 'key-1' })
  const adapter = new CvrAdapter(store, instantAdmission(), {
    socketFactory: () => {
      const socket = new Socket()
      sockets.push(socket)
      return socket
    }
  })
  markSessionEstablishedForTest(adapter)
  adapter.subscribe((e) => events.push(e))
  return { adapter, store, events, sockets }
}

const refuse = (socket: Socket, statusCode: number): void => {
  socket.emit('upgrade-rejected', { statusCode, retryAfter: null })
  socket.emit('close')
}

describe('CvrAdapter live socket refused as unauthorized', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('signs out and says ChilloutVR ended it when the key is refused too', async () => {
    const fetchMock = routed([
      () => Promise.resolve(jsonResponse({ message: 'denied' }, { status: 401 }))
    ])
    const { adapter, store, events, sockets } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets).toHaveLength(1)

    refuse(sockets[0]!, 401)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(store.deleted).toBe(1)
    expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'chilloutvr' })
    expect(await adapter.getAuthStatus()).toMatchObject({
      state: 'unauthenticated',
      endedByPlatform: true
    })
    // The signed-out pipeline stops dialing.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sockets).toHaveLength(1)
  })

  it('keeps a key that still works and asks only once per session', async () => {
    const fetchMock = routed([() => Promise.resolve(jsonResponse(envelope(authPayload())))])
    const { adapter, store, events, sockets } = setup()
    await vi.advanceTimersByTimeAsync(0)

    refuse(sockets[0]!, 403)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(store.deleted).toBe(0)
    expect(events.some((e) => e.type === 'auth-invalidated')).toBe(false)

    // The socket keeps backing off and retrying, without new sign-in checks.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sockets).toHaveLength(2)
    refuse(sockets[1]!, 401)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((await adapter.getAuthStatus()).state).toBe('authenticated')
  })

  it('asks only once per session even when the check got no answer', async () => {
    const fetchMock = routed([() => Promise.reject(new TypeError('offline'))])
    const { store, sockets } = setup()
    await vi.advanceTimersByTimeAsync(0)

    refuse(sockets[0]!, 401)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sockets).toHaveLength(2)
    refuse(sockets[1]!, 401)
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(store.deleted).toBe(0)
  })

  it('leaves the session alone for a refusal that is not about sign-in', async () => {
    const fetchMock = routed([])
    const { sockets } = setup()
    await vi.advanceTimersByTimeAsync(0)

    refuse(sockets[0]!, 500)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
