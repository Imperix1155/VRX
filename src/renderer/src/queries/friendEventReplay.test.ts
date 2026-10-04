import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { MAX_FRIENDS } from '@shared/constants'
import type { AdapterEvent, Friend } from '@shared/types'
import { fullFriend } from '../test-utils/friendFixture'
import { applyFriendEvent } from '../utils/applyFriendEvent'
import { friendsQueryKey } from './friends'
import { queryClient } from './queryClient'
import {
  FriendEventReplayOverflowError,
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
    queryFn: ({ signal }) => withFriendEventReplay(client, signal, () => response)
  })
}
function deliver(client: QueryClient, event: AdapterEvent): void {
  recordFriendEventForReplay(client, event)
  client.setQueryData<Friend[]>(key, (cached) =>
    cached === undefined ? undefined : applyFriendEvent(cached, event)
  )
}

describe('request-local friend event replay', () => {
  it('releases request subscriptions on ordinary failures, cancellation, overflow, and success', async () => {
    const client = new QueryClient()
    const cache = client.getQueryCache()
    const subscribe = cache.subscribe.bind(cache)
    let active = 0
    const spy = vi.spyOn(cache, 'subscribe').mockImplementation((listener) => {
      active++
      const stop = subscribe(listener)
      return () => {
        active--
        stop()
      }
    })
    const failed = deferred()
    const failedRequest = start(client, failed.promise)
    expect(active).toBe(1)
    failed.reject(new Error('network failed'))
    await expect(failedRequest).rejects.toThrow('network failed')
    expect(active).toBe(0)
    const cancelled = deferred()
    const cancelledRequest = start(client, cancelled.promise).catch(() => undefined)
    await client.cancelQueries({ queryKey: key })
    await cancelledRequest
    expect(active).toBe(0)
    const overloaded = deferred()
    const overloadedRequest = start(client, overloaded.promise)
    for (let count = 0; count <= MAX_FRIENDS; count++) deliver(client, removed)
    await expect(overloadedRequest).rejects.toBeInstanceOf(FriendEventReplayOverflowError)
    expect(active).toBe(0)
    await start(client, Promise.resolve([alice]))
    expect(active).toBe(0)
    spy.mockRestore()
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

  it('disposes cancelled attempts without losing the replacement attempt events', async () => {
    const client = new QueryClient()
    client.setQueryData(key, [alice])
    const old = deferred()
    const oldRequest = start(client, old.promise).catch(() => undefined)
    deliver(client, removed)
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
      await Promise.resolve()
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
