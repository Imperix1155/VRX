import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent, InstanceInfo } from '@shared/types'
import { CvrAdapter } from './CvrAdapter'
import { ApiAdmissionController } from './ApiAdmissionController'
import { CVRRateLimitError } from './errors'
import { jsonResponse, instantAdmission } from './__testutils__/adapterTestKit'
import { AccountSession } from '../accountSession'
import {
  fakeStore,
  authPayload,
  envelope,
  creds,
  markSessionEstablishedForTest
} from './__testutils__/cvrAdapterTestKit'

describe('CvrAdapter', () => {
  it('coalesces simultaneous CVR name warming and renderer roster reads', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn(async () => {
      await held
      return jsonResponse({
        message: 'ok',
        data: [
          {
            id: 'a1b2c3d4-0000-0000-0000-000000000001',
            name: 'Shared',
            imageUrl: null,
            categories: []
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = markSessionEstablishedForTest(
      new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), instantAdmission())
    )
    const drive = adapter as unknown as { handlePipelineEvent(event: AdapterEvent): void }
    drive.handlePipelineEvent({ type: 'connection', platform: 'chilloutvr', health: 'live' })
    const callers = Array.from({ length: 20 }, () => adapter.getFriends())
    release()
    const results = await Promise.all(callers)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(results.every((result) => result === results[0])).toBe(true)
    expect(adapter.resolveFriendName('a1b2c3d4-0000-0000-0000-000000000001')).toBe('Shared')
  })
  it('stops roster 429 on its first physical attempt and suppresses repeat refreshes', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': '60' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = markSessionEstablishedForTest(
      new CvrAdapter(fakeStore({ username: 'u', accessKey: 'k' }), instantAdmission())
    )
    await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRRateLimitError)
    await expect(adapter.getFriends()).rejects.toBeInstanceOf(CVRRateLimitError)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((await adapter.getAuthStatus()).state).toBe('authenticated')
  })
  it('sends neither access key for an obsolete queued roster after switching', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const admission = new ApiAdmissionController()
    await admission.acquire()
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(envelope(authPayload({ username: 'account-b', accessKey: 'key-b' })))
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = markSessionEstablishedForTest(
      new CvrAdapter(fakeStore({ username: 'account-a', accessKey: 'key-a' }), admission)
    )
    const roster = adapter.getFriends().catch((error: unknown) => error)
    const login = adapter.login(creds)
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(login).resolves.toEqual({ ok: true })
    expect(((await roster) as Error).message).toBe('Session ended')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('AccessKey')).toBeNull()
  })

  it('cancels a superseded login before dispatch', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const admission = new ApiAdmissionController()
    // An earlier request holds the request spacing, so the next login waits its turn.
    await admission.acquire()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({}, 401)))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new CvrAdapter(fakeStore(), admission)
    const first = adapter.login({ username: 'account-a', password: 'fake-a' })
    const second = adapter.login({ username: 'account-b', password: 'fake-b' })
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(first).resolves.toMatchObject({ ok: false })
    await expect(second).resolves.toMatchObject({ ok: false })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      Username: 'account-b'
    })
  })
  it('sends no queued roster after logout', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const admission = new ApiAdmissionController()
    admission.deferUntil(70_000)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'ok', data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const adapter = markSessionEstablishedForTest(
      new CvrAdapter(fakeStore({ username: 'account-a', accessKey: 'key-a' }), admission)
    )
    const roster = adapter.getFriends().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    adapter.clearSession()
    await vi.advanceTimersByTimeAsync(0)
    expect(admission.pendingCount).toBe(0)
    await vi.advanceTimersByTimeAsync(65_000)
    expect(await roster).toBeInstanceOf(Error)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(admission.pendingCount).toBe(0)
  })
  it('rejects control-character direct credentials before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await new CvrAdapter(fakeStore(), instantAdmission()).login({
      username: 'trinity\u007f',
      password: 'whiterabbit'
    })

    expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-printable issued access key instead of persisting it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload({ accessKey: 'key\npoison' }))))
    )
    const store = fakeStore()

    const result = await new CvrAdapter(store, instantAdmission()).login(creds)

    expect(result).toEqual({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    expect(store.saved).toEqual([])
  })

  it('signs in when the reply carries only the fields VRX reads', async () => {
    const minimal = {
      username: 'trinity',
      accessKey: 'key-1',
      userId: 'a1b2c3d4-0000-0000-0000-000000000001'
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope(minimal))))

    await expect(new CvrAdapter(fakeStore(), instantAdmission()).login(creds)).resolves.toEqual({
      ok: true
    })
  })

  it('sends valid Unicode direct-login credentials without altering them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload())))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      new CvrAdapter(fakeStore(), instantAdmission()).login({
        username: ' ユーザー ',
        password: '秘密🔐'
      })
    ).resolves.toEqual({ ok: true })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      Username: ' ユーザー ',
      Password: '秘密🔐'
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('AccountSession boundary ordering', () => {
    function wiring(
      accountSession: AccountSession,
      boundary = vi.fn()
    ): {
      onIdentity: (accountId: string | null) => void
      onSessionBoundary: () => void
    } {
      return {
        onIdentity: (accountId) => accountSession.setIdentity('chilloutvr', accountId),
        onSessionBoundary: () => {
          expect(accountSession.getAccountId('chilloutvr')).toBeNull()
          boundary()
        }
      }
    }

    it('clears AccountSession before restored-session adoption', () => {
      const accountSession = new AccountSession()
      accountSession.setIdentity('chilloutvr', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      const boundary = vi.fn()

      new CvrAdapter(fakeStore({ username: 'restored', accessKey: 'key-a' }), instantAdmission(), {
        onIdentity: (accountId) => accountSession.setIdentity('chilloutvr', accountId),
        onSessionBoundary: () => {
          expect(accountSession.getAccountId('chilloutvr')).toBeNull()
          boundary()
        }
      })

      expect(boundary).toHaveBeenCalledTimes(1)
    })

    it('clears AccountSession before fresh-login adoption', async () => {
      const accountSession = new AccountSession()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(envelope(authPayload())))
        .mockResolvedValueOnce(
          jsonResponse(
            envelope(
              authPayload({
                username: 'morpheus',
                accessKey: 'key-2',
                userId: 'a1b2c3d4-0000-0000-0000-000000000002'
              })
            )
          )
        )
      vi.stubGlobal('fetch', fetchMock)
      const boundary = vi.fn()
      const adapter = new CvrAdapter(
        fakeStore(),
        instantAdmission(),
        wiring(accountSession, boundary)
      )

      await adapter.login(creds)
      await expect(adapter.login(creds)).resolves.toEqual({ ok: true })
      expect(accountSession.getAccountId('chilloutvr')).toBe('a1b2c3d4-0000-0000-0000-000000000002')
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before access-key rotation adoption', async () => {
      const accountSession = new AccountSession()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(envelope(authPayload({ accessKey: 'rotated-key' }))))
      )
      const boundary = vi.fn()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'old-key' }),
        instantAdmission(),
        wiring(accountSession, boundary)
      )
      accountSession.setIdentity('chilloutvr', authPayload().userId as string)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before non-emitting invalidation', async () => {
      const accountSession = new AccountSession()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'denied' }, { status: 401 }))
      )
      const boundary = vi.fn()
      const adapter = new CvrAdapter(
        fakeStore({ username: 'trinity', accessKey: 'dead-key' }),
        instantAdmission(),
        wiring(accountSession, boundary)
      )
      accountSession.setIdentity('chilloutvr', authPayload().userId as string)

      await expect(adapter.getAuthStatus()).resolves.toMatchObject({ state: 'unauthenticated' })
      expect(boundary).toHaveBeenCalledTimes(2)
    })

    it('clears AccountSession before emitting invalidation', async () => {
      const accountSession = new AccountSession()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(envelope(authPayload())))
        .mockResolvedValueOnce(jsonResponse({ message: 'denied' }, { status: 401 }))
      vi.stubGlobal('fetch', fetchMock)
      const boundary = vi.fn()
      const adapter = new CvrAdapter(
        fakeStore(),
        instantAdmission(),
        wiring(accountSession, boundary)
      )

      await adapter.login(creds)
      await expect(adapter.getFriends()).rejects.toBeInstanceOf(Error)
      expect(accountSession.getAccountId('chilloutvr')).toBeNull()
      expect(boundary).toHaveBeenCalledTimes(2)
    })
  })

  describe('contract surface', () => {
    it('keeps join URLs pure and self-invite unsupported', async () => {
      const adapter = new CvrAdapter(fakeStore(), instantAdmission())
      expect(
        adapter.buildJoinUrl(
          { instanceId: 'i+bab275f822c020a0-152002-e81321-1fe976f9' } as InstanceInfo,
          'vr'
        )
      ).toBe(
        'chilloutvr://instance/join?instanceId=i%2Bbab275f822c020a0-152002-e81321-1fe976f9&startInVR=true'
      )
      await expect(adapter.selfInvite()).rejects.toThrow('not supported')
    })
  })
})

describe('CvrAdapter.reconnectNow (wake from sleep)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function liveSocket(): {
    on: (event: string, listener: (...args: unknown[]) => void) => void
    close: () => void
    terminate: ReturnType<typeof vi.fn<() => void>>
    fire: (event: string) => void
  } {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    const fire = (event: string): void => {
      for (const listener of listeners.get(event) ?? []) listener()
    }
    return {
      on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
      close: () => {},
      terminate: vi.fn<() => void>(() => fire('close')),
      fire
    }
  }

  it('drops the open socket so the pipeline reconnects', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const sockets: Array<ReturnType<typeof liveSocket>> = []
    const adapter = markSessionEstablishedForTest(
      new CvrAdapter(fakeStore({ username: 'trinity', accessKey: 'key-1' }), instantAdmission(), {
        socketFactory: () => {
          const socket = liveSocket()
          sockets.push(socket)
          return socket
        }
      })
    )
    const health: string[] = []
    const unsubscribe = adapter.subscribe((event) => {
      if (event.type === 'connection') health.push(event.health)
    })
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    adapter.reconnectNow()
    expect(sockets[0]!.terminate).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(health.at(-1)).toBe('reconnecting'))
    unsubscribe()
  })

  it('does nothing without a session', () => {
    const adapter = new CvrAdapter(fakeStore(), instantAdmission(), {
      socketFactory: () => liveSocket()
    })
    expect(() => adapter.reconnectNow()).not.toThrow()
    const unsubscribe = adapter.subscribe(() => {})
    expect(() => adapter.reconnectNow()).not.toThrow()
    unsubscribe()
  })
})
