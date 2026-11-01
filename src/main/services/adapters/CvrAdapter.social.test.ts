import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CVRCredentials } from './CvrApiClient'
import type { CvrCredentialStore } from './CvrAdapter'
import { CvrAdapter } from './CvrAdapter'
import { SocialDataError, SocialNotSentError } from './SocialActionAdapter'
import { RequestCancelledError } from './errors'
import { instantAdmission, jsonResponse } from './__testutils__/adapterTestKit'

const ME = '3a1661f1-3eeb-426e-92ec-1b2f08e609b5'
const FRIEND = 'b81d5892-5119-4f44-b473-7bf4ffda0458'

type Listener = (...args: unknown[]) => void

function store(): CvrCredentialStore {
  const credentials: CVRCredentials = { username: 'cvr-user', accessKey: 'cvr-access-key' }
  return { load: () => credentials, save: () => {}, delete: () => {} }
}

function socketRig(): {
  socket: { on: (e: string, l: Listener) => void; close: () => void; send: (d: string) => void }
  fire: (event: string, ...args: unknown[]) => void
  sent: unknown[]
} {
  const listeners = new Map<string, Listener[]>()
  const sent: unknown[] = []
  return {
    socket: {
      on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
      close: () => {},
      send: (data) => sent.push(JSON.parse(data))
    },
    fire: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    sent
  }
}

function signedIn(rig?: ReturnType<typeof socketRig>): CvrAdapter {
  const adapter = new CvrAdapter(store(), instantAdmission(), {
    socketFactory: () => (rig ?? socketRig()).socket
  })
  Object.assign(
    adapter as unknown as { validated: boolean; accountId: string; displayName: string },
    { validated: true, accountId: ME, displayName: 'Guide visitor' }
  )
  return adapter
}

async function connected(): Promise<{
  adapter: CvrAdapter
  rig: ReturnType<typeof socketRig>
  stop: () => void
}> {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ message: 'ok', data: [] })))
  )
  const rig = socketRig()
  const adapter = signedIn(rig)
  const stop = adapter.subscribe(() => {})
  await new Promise((resolve) => setImmediate(resolve))
  rig.fire('open')
  return { adapter, rig, stop }
}

describe('CvrAdapter unfriend and block', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads isBlocked from the person record', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ message: 'ok', data: { id: FRIEND.toUpperCase(), isBlocked: true } })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = signedIn()

    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).resolves.toBe(true)
    expect(new URL(String((fetchMock.mock.calls[0] as unknown[])[0])).pathname).toBe(
      `/1/users/${FRIEND}`
    )
  })

  it('answers null when the record does not say, and refuses another person', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ message: 'ok', data: { id: FRIEND } }))
        .mockResolvedValueOnce(jsonResponse({ message: 'ok', data: { id: ME, isBlocked: true } }))
    )
    const adapter = signedIn()
    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).resolves.toBeNull()
    await expect(adapter.getBlocked(FRIEND, adapter.captureSocialLease())).rejects.toBeInstanceOf(
      SocialDataError
    )
  })

  it('sends one socket message per action with the lower-case ID', async () => {
    const { adapter, rig, stop } = await connected()
    const upper = FRIEND.toUpperCase()

    await adapter.unfriend(upper, adapter.captureSocialLease())
    await adapter.block(upper, adapter.captureSocialLease())
    await adapter.unblock(upper, adapter.captureSocialLease())

    expect(rig.sent).toEqual([
      { RequestType: 8, Data: { id: FRIEND } },
      { RequestType: 30, Data: { id: FRIEND } },
      { RequestType: 31, Data: { id: FRIEND } }
    ])
    stop()
  })

  it('sends nothing and says so while the socket is closed', async () => {
    const adapter = signedIn()
    await expect(adapter.block(FRIEND, adapter.captureSocialLease())).rejects.toBeInstanceOf(
      SocialNotSentError
    )
    const { adapter: live, rig, stop } = await connected()
    rig.fire('close', 1006, Buffer.from(''))
    await expect(live.unfriend(FRIEND, live.captureSocialLease())).rejects.toBeInstanceOf(
      SocialNotSentError
    )
    expect(rig.sent).toEqual([])
    stop()
  })

  it('refuses an old account lease and a malformed ID without sending', async () => {
    const { adapter, rig, stop } = await connected()
    const lease = adapter.captureSocialLease()
    adapter.clearSession()
    await expect(adapter.block(FRIEND, lease)).rejects.toBeInstanceOf(RequestCancelledError)
    stop()

    const second = await connected()
    await expect(
      second.adapter.block('../users/auth', second.adapter.captureSocialLease())
    ).rejects.toBeInstanceOf(SocialDataError)
    expect(rig.sent).toEqual([])
    expect(second.rig.sent).toEqual([])
    second.stop()
  })
})
