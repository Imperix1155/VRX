import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { RosterRefresh } from '../../../main/services/adapters/RosterRefresh'
import { MAX_FRIENDS } from '@shared/constants'
import type { AdapterEvent, Friend } from '@shared/types'
import { fullFriend } from '../test-utils/friendFixture'
import { applyFriendEvent } from '../utils/applyFriendEvent'
import { friendsQueryKey } from './friends'
import { queryClient } from './queryClient'
import {
  FriendEventReplayOverflowError,
  clearFriendEventReplay,
  shareFriendReplayResult,
  recordFriendEventForReplay,
  withFriendEventReplay
} from './friendEventReplay'

const key = friendsQueryKey('vrchat')
const alice = fullFriend('Alice', 'vrchat')
const removed: AdapterEvent = {
  type: 'friend-removed',
  platform: 'vrchat',
  platformUserId: alice.platformUserId
}
function deferred(): {
  promise: Promise<Friend[]>
  resolve: (friends: Friend[]) => void
  reject: (error: Error) => void
} {
  let resolve!: (friends: Friend[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Friend[]>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function start(client: QueryClient, response: Promise<Friend[]>): Promise<Friend[]> {
  return client.fetchQuery({
    queryKey: key,
    structuralSharing: shareFriendReplayResult,
    queryFn: ({ signal }) => withFriendEventReplay(client, signal, () => response)
  })
}
function deliver(client: QueryClient, event: AdapterEvent): void {
  recordFriendEventForReplay(client, event)
  client.setQueryData<Friend[]>(key, (cached) =>
    cached === undefined ? undefined : applyFriendEvent(cached, event)
  )
}

describe('transport-owned friend event replay', () => {
  it('releases failed and abandoned reads before a genuinely fresh read', async () => {
    const client = new QueryClient()
    const failed = deferred()
    const failedRequest = start(client, failed.promise)
    deliver(client, removed)
    failed.reject(new Error('network failed'))
    await expect(failedRequest).rejects.toThrow('network failed')
    await start(client, Promise.resolve([alice]))
    expect(client.getQueryData(key)).toEqual([alice])
    const cancelled = deferred()
    const cancelledRequest = start(client, cancelled.promise).catch(() => undefined)
    deliver(client, removed)
    await client.cancelQueries({ queryKey: key })
    await cancelledRequest
    cancelled.resolve([alice])
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await start(client, Promise.resolve([alice]))
    expect(client.getQueryData(key)).toEqual([alice])
    client.clear()
  })

  it('replays add, profile, presence, and metadata in order on the first roster', async () => {
    const client = new QueryClient()
    const response = deferred()
    const request = start(client, response.promise)
    const bob = fullFriend('Bob', 'vrchat')
    const moved: Friend = {
      ...alice,
      presence: { state: 'in-game' },
      instance: {
        worldId: 'world-new',
        instanceId: 'instance-new',
        worldName: null,
        thumbnailUrl: null,
        type: 'public',
        openness: 'public',
        isGroup: false,
        groupName: null,
        groupId: null,
        groupImageUrl: null,
        region: null,
        userCount: null
      }
    }
    deliver(client, { type: 'friend-added', platform: 'vrchat', friend: bob })
    deliver(client, { type: 'friend-presence', platform: 'vrchat', friend: moved })
    deliver(client, {
      type: 'friend-updated',
      platform: 'vrchat',
      friend: { ...alice, displayName: 'Renamed' }
    })
    deliver(client, {
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'world-new',
      worldName: 'New World',
      thumbnailUrl: null
    })
    expect(client.getQueryData(key)).toBeUndefined()
    response.resolve([alice])
    await request
    expect(client.getQueryData<Friend[]>(key)).toEqual([
      { ...moved, displayName: 'Renamed', instance: { ...moved.instance, worldName: 'New World' } },
      bob
    ])
    client.clear()
  })

  it('does not carry deletions into a later genuinely fresh request', async () => {
    const client = new QueryClient()
    const first = deferred()
    const request = start(client, first.promise)
    deliver(client, removed)
    first.resolve([alice])
    await request
    expect(client.getQueryData(key)).toEqual([])
    await start(client, Promise.resolve([alice]))
    expect(client.getQueryData(key)).toEqual([alice])
    client.clear()
  })

  it('ignores pre-request events and isolates independent query clients', async () => {
    const firstClient = new QueryClient()
    const secondClient = new QueryClient()
    deliver(firstClient, removed)
    const first = deferred()
    const request = start(firstClient, first.promise)
    const otherRequest = start(secondClient, first.promise)
    deliver(secondClient, removed)
    first.resolve([alice])
    await Promise.all([request, otherRequest])
    expect(firstClient.getQueryData(key)).toEqual([alice])
    expect(secondClient.getQueryData(key)).toEqual([])
    firstClient.clear()
    secondClient.clear()
  })

  it('discards old-account transport without losing replacement-account events', async () => {
    const client = new QueryClient()
    client.setQueryData(key, [alice])
    const old = deferred()
    const oldRequest = start(client, old.promise).catch(() => undefined)
    deliver(client, removed)
    clearFriendEventReplay(client)
    await client.cancelQueries({ queryKey: key })
    const fresh = deferred()
    const freshRequest = start(client, fresh.promise)
    old.reject(new Error('late old failure'))
    await oldRequest
    // Let the cancelled load's catch run after the replacement registered.
    await Promise.resolve()
    await Promise.resolve()
    deliver(client, removed)
    fresh.resolve([alice])
    await freshRequest
    expect(client.getQueryData(key)).toEqual([])
    client.clear()
  })

  it.each([false, true])(
    'overflow preserves live data (warm=%s), never retries, and permits explicit recovery',
    async (warm) => {
      const client = new QueryClient({ defaultOptions: queryClient.getDefaultOptions() })
      if (warm) client.setQueryData(key, [alice])
      const response = deferred()
      const request = start(client, response.promise)
      for (let count = 0; count <= MAX_FRIENDS; count++) deliver(client, removed)
      await expect(request).rejects.toBeInstanceOf(FriendEventReplayOverflowError)
      expect(client.getQueryState(key)?.status).toBe('error')
      expect(client.getQueryState(key)?.fetchStatus).toBe('idle')
      expect(client.getQueryData(key)).toEqual(warm ? [] : undefined)
      // Releasing the abandoned IPC result must not publish its old roster.
      response.resolve([alice])
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      await start(client, Promise.resolve([alice]))
      expect(client.getQueryData(key)).toEqual([alice])
      client.clear()
    }
  )

  it('keeps the journal through cache publication, not just load resolution', async () => {
    const client = new QueryClient()
    let inject = true
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        !event.action.manual &&
        inject
      ) {
        inject = false
        deliver(client, removed)
      }
    })
    await start(client, Promise.resolve([alice]))
    expect(client.getQueryData(key)).toEqual([])
    unsubscribe()
    client.clear()
  })
})

describe('roster transport publication', () => {
  it.each(['friend-removed', 'friend-offline'] as const)(
    'preserves %s across replacement queries sharing a main read',
    async (type) => {
      const client = new QueryClient()
      client.setQueryData(key, [alice])
      const physical = deferred()
      const read = vi.fn(async () => ({
        friends: await physical.promise,
        completeness: 'complete' as const
      }))
      const main = new RosterRefresh(read, () => 0)
      const lease = { generation: 0, signal: new AbortController().signal, isCurrent: () => true }
      const bridge = vi.fn(async () => (await main.get(lease)).friends)
      const request = client.fetchQuery({
        queryKey: key,
        structuralSharing: shareFriendReplayResult,
        queryFn: ({ signal }) => withFriendEventReplay(client, signal, bridge)
      })
      deliver(client, { type, platform: 'vrchat', platformUserId: alice.platformUserId })
      const replacement = client.refetchQueries({ queryKey: key })
      physical.resolve([alice])
      await Promise.allSettled([request, replacement])
      const result = client.getQueryData<Friend[]>(key)!
      if (type === 'friend-removed') expect(result).toEqual([])
      else expect(result[0]?.presence.state).toBe('offline')
      expect(read).toHaveBeenCalledOnce()
      expect(bridge).toHaveBeenCalledOnce()
      client.clear()
    }
  )

  it('owns publication when a success listener starts a reentrant request', async () => {
    const client = new QueryClient()
    const next = deferred()
    let second: Promise<Friend[]> | undefined
    const stop = client.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        !event.action.manual &&
        !second
      ) {
        second = start(client, next.promise)
      }
    })
    await start(client, Promise.resolve([alice]))
    deliver(client, removed)
    next.resolve([alice])
    await second
    expect(client.getQueryData(key)).toEqual([])
    stop()
    client.clear()
  })

  it('never publishes a stale intermediate roster to cache subscribers', async () => {
    const client = new QueryClient()
    const seen: Friend[][] = []
    const observed: Friend[][] = []
    const observer = new QueryObserver<Friend[]>(client, { queryKey: key, enabled: false })
    const stopObserver = observer.subscribe((result) => {
      if (result.data) observed.push(result.data)
    })
    const stop = client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success')
        seen.push(event.query.state.data as Friend[])
    })
    const response = deferred()
    const request = start(client, response.promise)
    deliver(client, removed)
    response.resolve([alice])
    await request
    expect(seen).toEqual([[]])
    expect(observed).toEqual([[]])
    stopObserver()
    stop()
    client.clear()
  })
})

it('keeps events received in the promise-to-publication gap without a stale notification', async () => {
  const client = new QueryClient()
  const seen: Friend[][] = []
  const stop = client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success')
      seen.push(event.query.state.data as Friend[])
  })
  await client.fetchQuery({
    queryKey: key,
    structuralSharing: shareFriendReplayResult,
    queryFn: ({ signal }) => {
      const result = withFriendEventReplay(client, signal, async () => [alice])
      void result.then(() => deliver(client, removed))
      return result
    }
  })
  expect(seen).toEqual([[]])
  stop()
  client.clear()
})

it('does not reopen an overflowed transport before it settles', async () => {
  const client = new QueryClient({ defaultOptions: queryClient.getDefaultOptions() })
  const response = deferred()
  const load = vi.fn(() => response.promise)
  const fetch = (): Promise<Friend[]> =>
    client.fetchQuery({
      queryKey: key,
      structuralSharing: shareFriendReplayResult,
      queryFn: ({ signal }) => withFriendEventReplay(client, signal, load)
    })
  const first = fetch()
  for (let i = 0; i <= MAX_FRIENDS; i++) deliver(client, removed)
  await expect(first).rejects.toBeInstanceOf(FriendEventReplayOverflowError)
  await expect(fetch()).rejects.toBeInstanceOf(FriendEventReplayOverflowError)
  expect(load).toHaveBeenCalledOnce()
  response.resolve([alice])
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await fetch()
  expect(load).toHaveBeenCalledTimes(2)
  expect(client.getQueryData(key)).toEqual([alice])
  client.clear()
})

it.each(['success', 'failure', 'abort', 'overflow', 'boundary'] as const)(
  'releases abort listeners on %s and permits a later fresh read',
  async (outcome) => {
    const client = new QueryClient()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const response = deferred()
    const result = withFriendEventReplay(client, controller.signal, () => response.promise)
    const settled = result.catch(() => undefined)
    expect(add).toHaveBeenCalledOnce()
    if (outcome === 'failure') response.reject(new Error('failed'))
    if (outcome === 'abort') controller.abort()
    if (outcome === 'boundary') clearFriendEventReplay(client)
    if (outcome === 'overflow')
      for (let i = 0; i <= MAX_FRIENDS; i++) recordFriendEventForReplay(client, removed)
    if (outcome !== 'failure') response.resolve([alice])
    const value = await settled
    if (outcome === 'success') shareFriendReplayResult(undefined, value)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(remove).toHaveBeenCalledOnce()
    await start(client, Promise.resolve([alice]))
    expect(client.getQueryData(key)).toEqual([alice])
    client.clear()
  }
)
