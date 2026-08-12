import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent } from '@shared/types'
import { VrcAdapter, type VrcCredentialStore } from './VrcAdapter'
import { jsonResponse, noopSleep } from './__testutils__/adapterTestKit'
import { createGroupResolver, type GroupResolver } from './vrchat/GroupResolver'

function fakeStore(initial?: string): VrcCredentialStore & { saved: string[]; deleted: number } {
  let value = initial
  const store = {
    saved: [] as string[],
    deleted: 0,
    load: () => value,
    save: (cookie: string, accountId: string | null) => {
      void accountId
      value = cookie
      store.saved.push(cookie)
    },
    delete: () => {
      value = undefined
      store.deleted++
    }
  }
  return store
}

type SocketListener = (...args: unknown[]) => void
class DrivableVrcSocket {
  private readonly listeners = new Map<string, SocketListener[]>()
  closed = false

  on(event: string, listener: SocketListener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  close(): void {
    this.closed = true
    this.fire('close')
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

const pipelineFrame = (type: string, content: unknown): string =>
  JSON.stringify({ type, content: JSON.stringify(content) })

const liveUser = {
  id: 'usr_live',
  displayName: 'Live Friend',
  currentAvatarThumbnailImageUrl: null,
  status: 'active',
  statusDescription: null,
  tags: []
}

function onlineFrame(worldId: string, instanceId: string, groupId?: string): string {
  let location = `${worldId}:${instanceId}`
  if (groupId !== undefined) {
    location += `~group(${groupId})~groupAccessType(plus)`
  }
  return pipelineFrame('friend-online', {
    userId: liveUser.id,
    user: liveUser,
    location
  })
}

describe('VrcAdapter group enrichment (VRX-260)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getFriends snapshots cached group metadata and kicks a group-metadata event for uncached groups', async () => {
    const groupId = 'grp_x'
    const worldId = 'wrld_group'
    const location = `${worldId}:inst~group(${groupId})~groupAccessType(plus)`
    const groupMeta = { name: 'Pixel Pals', iconUrl: 'https://example.com/pals.png' }

    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (href.endsWith('/auth/user')) {
        return Promise.resolve(
          jsonResponse({
            id: 'usr_self',
            displayName: 'Self',
            onlineFriends: ['usr_friend'],
            activeFriends: [],
            offlineFriends: []
          })
        )
      }
      if (href.includes('/auth/user/friends')) {
        return Promise.resolve(
          jsonResponse(
            href.includes('offline=true')
              ? []
              : [
                  {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    currentAvatarThumbnailImageUrl: null,
                    status: 'active',
                    statusDescription: null,
                    tags: [],
                    location
                  }
                ]
          )
        )
      }
      if (href.includes(`/worlds/${worldId}`)) {
        return Promise.resolve(jsonResponse({ name: 'Group World', thumbnailImageUrl: null }))
      }
      if (href.includes(`/groups/${groupId}`)) {
        return Promise.resolve(jsonResponse(groupMeta))
      }
      return Promise.reject(new Error(`Unexpected URL: ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)
    const unsubscribe = adapter.subscribe((event) => events.push(event))

    try {
      const first = await adapter.getFriends()
      expect(first.friends).toHaveLength(1)
      expect(first.friends[0]!.instance!.groupId).toBe(groupId)
      expect(first.friends[0]!.instance!.groupName).toBeNull()

      await vi.waitFor(() => expect(events.some((e) => e.type === 'group-metadata')).toBe(true))
      const metaEvent = events.find((e) => e.type === 'group-metadata')
      expect(metaEvent).toMatchObject({
        type: 'group-metadata',
        platform: 'vrchat',
        groupId,
        groupName: groupMeta.name,
        groupImageUrl: groupMeta.iconUrl
      })

      const { applyFriendEvent } = await import('../../../renderer/src/utils/applyFriendEvent')
      const enriched = applyFriendEvent(first.friends, metaEvent!)
      expect(enriched[0]!.instance!.groupName).toBe(groupMeta.name)
      expect(enriched[0]!.instance!.groupImageUrl).toBe(groupMeta.iconUrl)

      const second = await adapter.getFriends()
      expect(second.friends[0]!.instance!.groupName).toBe(groupMeta.name)
      expect(second.friends[0]!.instance!.groupImageUrl).toBe(groupMeta.iconUrl)
    } finally {
      unsubscribe()
    }
  })

  it('clears the group resolver on session boundary so the next account does not inherit cached entries', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const groupId = 'grp_session'
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (href.endsWith('/auth/user')) {
        return Promise.resolve(
          jsonResponse({
            id: 'usr_self',
            displayName: 'Self',
            onlineFriends: [],
            activeFriends: [],
            offlineFriends: []
          })
        )
      }
      if (href.includes(`/groups/${groupId}`)) {
        return gate.then(() => jsonResponse({ name: 'Cached Group', iconUrl: null }))
      }
      return Promise.reject(new Error(`Unexpected URL: ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep)
    const resolver = (adapter as unknown as { groupResolver: GroupResolver }).groupResolver

    const inFlight = resolver.resolve(groupId)
    adapter.clearSession()
    release()
    await inFlight

    expect(resolver.peek(groupId)).toBeUndefined()
  })
})

describe('live pipeline group enrichment (VRX-260)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a live friend-presence for a cached group carries the cached groupName', async () => {
    const groupId = 'grp_cached_live'
    const worldId = 'wrld_cached_live'
    const groupMeta = { name: 'Cached Live Group', iconUrl: 'https://example.com/group-cached.jpg' }
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/groups/${groupId}`)) return Promise.resolve(jsonResponse(groupMeta))
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    const resolver = (adapter as unknown as { groupResolver: GroupResolver }).groupResolver
    await resolver.resolve(groupId)
    events.length = 0

    sockets[0]!.fire('message', onlineFrame(worldId, 'inst1', groupId))

    const emitted = events.find((e) => e.type === 'friend-presence')
    expect(emitted).toMatchObject({
      type: 'friend-presence',
      platform: 'vrchat',
      friend: {
        platformUserId: liveUser.id,
        instance: {
          worldId,
          instanceId: `inst1~group(${groupId})~groupAccessType(plus)`,
          groupId,
          groupName: 'Cached Live Group',
          groupImageUrl: 'https://example.com/group-cached.jpg'
        }
      }
    })
    unsubscribe()
  })

  it('an unseen group is resolved exactly once across repeated live events, then one group-metadata emits', async () => {
    const groupId = 'grp_unseen'
    const worldId = 'wrld_unseen'
    let groupRequests = 0
    let releaseGroup!: (response: Response) => void
    const heldGroup = new Promise<Response>((resolve) => {
      releaseGroup = resolve
    })
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/groups/${groupId}`)) {
        groupRequests += 1
        return heldGroup
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a', groupId))
    sockets[0]!.fire('message', onlineFrame(worldId, 'b', groupId))
    await vi.waitFor(() => expect(groupRequests).toBe(1))

    releaseGroup(jsonResponse({ name: 'Unseen Group', iconUrl: null }))

    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'group-metadata')).toHaveLength(1)
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(groupRequests).toBe(1)
    expect(events.filter((e) => e.type === 'group-metadata')).toEqual([
      {
        type: 'group-metadata',
        platform: 'vrchat',
        groupId,
        groupName: 'Unseen Group',
        groupImageUrl: null
      }
    ])
    unsubscribe()
  })

  it('a failed group resolution is not re-kicked within the negative-cache window', async () => {
    const groupId = 'grp_fail'
    const worldId = 'wrld_fail'
    let groupRequests = 0
    let now = 0
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/groups/${groupId}`)) {
        groupRequests += 1
        return Promise.reject(new Error('group offline'))
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })

    // Inject a clocked resolver so we can advance the negative TTL deterministically.
    const resolverFetch = vi.fn(async (id: string) => {
      const response = await fetch(`https://api.vrchat.cloud/api/1/groups/${id}`)
      if (!response.ok) throw new Error('group offline')
      return response.json()
    })
    const customResolver = createGroupResolver({
      fetcher: resolverFetch,
      clock: () => now,
      negativeTtlMs: 100
    })
    ;(adapter as unknown as { groupResolver: GroupResolver }).groupResolver = customResolver

    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a', groupId))
    await vi.waitFor(() => expect(groupRequests).toBe(1))

    sockets[0]!.fire('message', onlineFrame(worldId, 'b', groupId))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(groupRequests).toBe(1)

    now = 200
    sockets[0]!.fire('message', onlineFrame(worldId, 'c', groupId))
    await vi.waitFor(() => expect(groupRequests).toBe(2))

    expect(events.filter((e) => e.type === 'group-metadata')).toHaveLength(0)
    unsubscribe()
  })

  it('a group resolution landing with a stale sessionGeneration emits nothing', async () => {
    const groupId = 'grp_stalegen'
    const worldId = 'wrld_stalegen'
    let releaseGroup!: (response: Response) => void
    const heldGroup = new Promise<Response>((resolve) => {
      releaseGroup = resolve
    })
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      const headers = (options?.headers ?? {}) as Record<string, string>
      if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (href.includes(`/groups/${groupId}`)) return heldGroup
      if (headers.Authorization !== undefined) {
        return Promise.resolve(
          jsonResponse({ id: 'NEW', displayName: 'New' }, { setCookies: ['auth=new'] })
        )
      }
      return Promise.reject(new Error(`unexpected: ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=old'), noopSleep, {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a', groupId))
    await vi.waitFor(() => expect(sockets[0]!.closed).toBe(false))

    await adapter.login({ username: 'new', password: 'pw' })
    events.length = 0

    releaseGroup(jsonResponse({ name: 'Stale Group', iconUrl: null }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events.filter((e) => e.type === 'group-metadata')).toHaveLength(0)
    unsubscribe()
  })

  it('unconditionally sweeps pendingGroupResolutions after a live-event 401 so the group refetches after re-login', async () => {
    const groupId = 'grp_unconditional'
    const worldId = 'wrld_unconditional'
    let groupFetches = 0
    const pendingGroups: Array<(response: Response) => void> = []
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: RequestInfo | URL, options?: RequestInit) => {
      const href =
        typeof url === 'string' ? url : url instanceof URL ? url.href : (url as { url: string }).url
      const headers = (options?.headers ?? {}) as Record<string, string>
      if (href.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (href.includes(`/groups/${groupId}`)) {
        groupFetches += 1
        return new Promise<Response>((resolve) => {
          pendingGroups.push(resolve)
        })
      }
      if (href.endsWith('/auth/user') && headers.Authorization !== undefined) {
        return Promise.resolve(
          jsonResponse({ id: 'NEW', displayName: 'New' }, { setCookies: ['auth=new'] })
        )
      }
      return Promise.reject(new Error(`unexpected: ${href}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=old'), noopSleep, {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a', groupId))
    await vi.waitFor(() => expect(groupFetches).toBe(1))

    pendingGroups.shift()!(jsonResponse({ error: 'unauthorized' }, { status: 401 }))
    await vi.waitFor(() =>
      expect(events).toContainEqual({ type: 'auth-invalidated', platform: 'vrchat' })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const pending = (adapter as unknown as { pendingGroupResolutions: Set<string> })
      .pendingGroupResolutions
    expect(pending.has(groupId)).toBe(false)

    await adapter.login({ username: 'new', password: 'pw' })
    await vi.waitFor(() => expect(sockets).toHaveLength(3))
    const newSocket = sockets[2]!
    expect(newSocket.closed).toBe(false)
    newSocket.fire('open')

    events.length = 0
    newSocket.fire('message', onlineFrame(worldId, 'b', groupId))
    await vi.waitFor(() => expect(groupFetches).toBe(2))

    pendingGroups.shift()!(jsonResponse({ name: 'Re-fetched Group', iconUrl: null }))
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'group-metadata',
          platform: 'vrchat',
          groupId,
          groupName: 'Re-fetched Group'
        })
      )
    )
    unsubscribe()
  })

  it('a live move to a cached group resolves the name without a refetch', async () => {
    const groupId = 'grp_manual'
    const worldId = 'wrld_manual'
    const groupMeta = {
      name: 'Manual Reconcile Group',
      iconUrl: 'https://example.com/manual-group.jpg'
    }
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/groups/${groupId}`)) return Promise.resolve(jsonResponse(groupMeta))
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    const resolver = (adapter as unknown as { groupResolver: GroupResolver }).groupResolver
    await resolver.resolve(groupId)
    fetchMock.mockClear()
    events.length = 0

    sockets[0]!.fire('message', onlineFrame(worldId, 'inst1', groupId))

    const emitted = events.find((e) => e.type === 'friend-presence')
    expect(emitted).toMatchObject({
      type: 'friend-presence',
      friend: {
        instance: {
          worldId,
          groupId,
          groupName: 'Manual Reconcile Group',
          groupImageUrl: 'https://example.com/manual-group.jpg'
        }
      }
    })
    expect(fetchMock).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('a 403 on a live-event group fetch is not negative-cached and re-fetches on the next event', async () => {
    const groupId = 'grp_403live'
    const worldId = 'wrld_403live'
    let groupRequests = 0
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes(`/groups/${groupId}`)) {
        groupRequests += 1
        return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }))
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AdapterEvent[] = []
    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    sockets[0]!.fire('message', onlineFrame(worldId, 'a', groupId))
    await vi.waitFor(() => expect(groupRequests).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const resolver = (adapter as unknown as { groupResolver: GroupResolver }).groupResolver
    expect(resolver.peek(groupId)).toBeUndefined()

    sockets[0]!.fire('message', onlineFrame(worldId, 'b', groupId))
    await vi.waitFor(() => expect(groupRequests).toBe(2))

    unsubscribe()
  })

  it('three live-event 403 failures open the shared circuit for unrelated adapter calls', async () => {
    const groupIds = ['grp_403a', 'grp_403b', 'grp_403c']
    const worldId = 'wrld_403circuit'
    let groupRequests = 0
    const sockets: DrivableVrcSocket[] = []
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/auth')) return Promise.resolve(jsonResponse({ token: 'tok' }))
      if (url.includes('/groups/')) {
        groupRequests += 1
        return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }))
      }
      return Promise.reject(new Error(`unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new VrcAdapter(fakeStore('auth=x'), noopSleep, {
      socketFactory: () => {
        const socket = new DrivableVrcSocket()
        sockets.push(socket)
        return socket
      }
    })
    const unsubscribe = adapter.subscribe(() => {})
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.fire('open')

    for (let i = 0; i < groupIds.length; i++) {
      sockets[0]!.fire('message', onlineFrame(worldId, `inst${i}`, groupIds[i]))
    }
    await vi.waitFor(() => expect(groupRequests).toBe(3))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(adapter.selfInvite('wrld_circuit:12345~private(usr_self)')).rejects.toThrow(
      /Circuit open/
    )
    unsubscribe()
  })
})
