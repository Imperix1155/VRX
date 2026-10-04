import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FriendEvent, IpcInvoke } from '@shared/ipc'
import type { Friend } from '@shared/types'
import { RosterRefresh } from '../../../main/services/adapters/RosterRefresh'
import type { FriendRoster } from '../../../main/services/adapters/IPlatformAdapter'
import { stubPlatformAdapter } from '../../../main/services/adapters/__testutils__/adapterTestKit'
import { RateLimitError } from '../../../main/services/adapters/errors'
import { LocationAuthority } from '../../../main/services/locationAuthority'
import { AppStatusService } from '../../../main/services/appStatus'
import { fullFriend } from '../test-utils/friendFixture'
import { applyFriendEvent } from '../utils/applyFriendEvent'
import { fetchFriendRoster, friendsQueryKey } from './friends'
import {
  clearFriendEventReplay,
  recordFriendEventForReplay,
  shareFriendReplayResult,
  withFriendEventReplay
} from './friendEventReplay'

const handlers = new Map<
  string,
  (event: unknown, req: unknown) => Promise<IpcInvoke['get-friends']['res']>
>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: typeof handlers extends Map<string, infer H> ? H : never) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('../../../main/ipc/security', () => ({ isTrustedIpcSender: () => true }))
import { registerFriendsHandlers } from '../../../main/ipc/friends'

const alice = fullFriend('Alice', 'vrchat')
const bob = fullFriend('Bob', 'vrchat')
const key = friendsQueryKey('vrchat')
afterEach(() => vi.unstubAllGlobals())

function setup(): {
  client: QueryClient
  replaceAccount: () => Promise<void>
  start: () => Promise<Friend[]>
  reads: Array<{ resolve: (roster: FriendRoster) => void; reject: (error: Error) => void }>
  refresh: RosterRefresh
  request: Promise<Friend[]>
  deliver: (event: FriendEvent) => void
  offline: (friend: Friend) => void
  getFriends: () => Promise<IpcInvoke['get-friends']['res']>
} {
  const client = new QueryClient()
  const authority = new LocationAuthority()
  const reads: Array<{ resolve: (roster: FriendRoster) => void; reject: (error: Error) => void }> =
    []
  const refresh = new RosterRefresh(
    () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    () => 0,
    () => authority.captureSeedRevision('vrchat')
  )
  const adapter = stubPlatformAdapter()
  let controller = new AbortController()
  let lease = { generation: 0, signal: controller.signal, isCurrent: () => true }
  vi.mocked(adapter.getFriends).mockImplementation(() => refresh.get(lease))
  registerFriendsHandlers(new Map([['vrchat', adapter]]), authority, new AppStatusService())
  const getFriends = vi.fn(() =>
    handlers.get('get-friends')!({ senderFrame: {} }, { platform: 'vrchat' })
  )
  vi.stubGlobal('window', { vrx: { getFriends } })
  client.setQueryData(key, [alice, bob])
  const start = (): Promise<Friend[]> =>
    client.fetchQuery({
      queryKey: key,
      structuralSharing: shareFriendReplayResult,
      queryFn: ({ signal }) =>
        withFriendEventReplay(client, signal, () =>
          fetchFriendRoster('vrchat', () => client.getQueryData(key))
        )
    })
  const request = start()
  const replaceAccount = async (): Promise<void> => {
    controller.abort()
    refresh.clear()
    authority.consume({ type: 'auth-invalidated', platform: 'vrchat' })
    controller = new AbortController()
    lease = { ...lease, generation: lease.generation + 1, signal: controller.signal }
    clearFriendEventReplay(client)
    await client.cancelQueries({ queryKey: key })
    client.setQueryData(key, [])
  }
  const deliver = (event: FriendEvent): void => {
    authority.consume(event)
    const published = { ...event, rosterRevision: authority.captureEventRevision() }
    recordFriendEventForReplay(client, published)
    client.setQueryData<Friend[]>(key, (current) => applyFriendEvent(current ?? [], published))
  }
  const offline = (friend: Friend): void =>
    deliver({ type: 'friend-offline', platform: 'vrchat', platformUserId: friend.platformUserId })
  return { client, reads, refresh, request, deliver, offline, getFriends, start, replaceAccount }
}

describe('physical roster read provenance through IPC and renderer', () => {
  it.each(['complete', 'partial', 'rate-limited'] as const)(
    'orders a %s follow-up without losing retained first-read events',
    async (mode) => {
      const s = setup()
      s.offline(alice)
      s.offline(bob)
      s.refresh.invalidate()
      s.reads[0]!.resolve({ friends: [alice, bob], completeness: 'complete' })
      await vi.waitFor(() => expect(s.reads).toHaveLength(2))
      if (mode === 'rate-limited') s.reads[1]!.reject(new RateLimitError(1000))
      else s.reads[1]!.resolve({ friends: [alice], completeness: mode })
      await s.request
      const result = s.client.getQueryData<Friend[]>(key)!
      expect(result.find((f) => f.platformUserId === alice.platformUserId)?.presence.state).toBe(
        mode === 'rate-limited' ? 'offline' : 'active'
      )
      expect(result.find((f) => f.platformUserId === bob.platformUserId)?.presence.state).toBe(
        mode === 'complete' ? undefined : 'offline'
      )
      expect(s.getFriends).toHaveBeenCalledTimes(1)
      s.client.clear()
    }
  )

  it('preserves deltas received after the follow-up begins, including removals and additions', async () => {
    const s = setup()
    s.refresh.invalidate()
    s.reads[0]!.resolve({ friends: [alice, bob], completeness: 'complete' })
    await vi.waitFor(() => expect(s.reads).toHaveLength(2))
    s.offline(alice)
    s.deliver({ type: 'friend-removed', platform: 'vrchat', platformUserId: bob.platformUserId })
    const carol = fullFriend('Carol', 'vrchat')
    s.deliver({ type: 'friend-added', platform: 'vrchat', friend: carol })
    s.reads[1]!.resolve({ friends: [alice, bob], completeness: 'complete' })
    await s.request
    expect(
      s.client.getQueryData<Friend[]>(key)!.map((f) => [f.platformUserId, f.presence.state])
    ).toEqual([
      [alice.platformUserId, 'offline'],
      [carol.platformUserId, 'active']
    ])
    s.client.clear()
  })

  it('does not resurrect an addition preceding a complete follow-up omission', async () => {
    const s = setup()
    s.deliver({ type: 'friend-added', platform: 'vrchat', friend: bob })
    s.refresh.invalidate()
    s.reads[0]!.resolve({ friends: [alice], completeness: 'complete' })
    await vi.waitFor(() => expect(s.reads).toHaveLength(2))
    s.reads[1]!.resolve({ friends: [alice], completeness: 'complete' })
    await s.request
    expect(s.client.getQueryData(key)).toEqual([alice])
    s.client.clear()
  })

  it('orders multi-row world metadata separately for fresh and retained rows', async () => {
    const s = setup()
    const instance = {
      worldId: 'wrld_shared',
      instanceId: '1',
      worldName: 'First',
      thumbnailUrl: null,
      type: 'public' as const,
      isGroup: false,
      groupName: null,
      region: null,
      userCount: null
    }
    const first = [alice, bob].map((friend) => ({ ...friend, instance })) as Friend[]
    s.deliver({
      type: 'world-metadata',
      platform: 'vrchat',
      worldId: 'wrld_shared',
      worldName: 'Live',
      thumbnailUrl: null
    })
    s.refresh.invalidate()
    s.reads[0]!.resolve({ friends: first, completeness: 'complete' })
    await vi.waitFor(() => expect(s.reads).toHaveLength(2))
    s.reads[1]!.resolve({
      friends: [{ ...first[0]!, instance: { ...instance, worldName: 'New read' } } as Friend],
      completeness: 'partial'
    })
    await s.request
    expect(s.client.getQueryData<Friend[]>(key)!.map((f) => f.instance?.worldName)).toEqual([
      'New read',
      'Live'
    ])
    s.client.clear()
  })
})

it('fences a reconnect follow-up across account replacement and keeps the new journal', async () => {
  const s = setup()
  const oldRequest = s.request.catch(() => undefined)
  s.refresh.invalidate()
  s.reads[0]!.resolve({ friends: [alice], completeness: 'complete' })
  await vi.waitFor(() => expect(s.reads).toHaveLength(2))
  await s.replaceAccount()
  const next = s.start()
  expect(s.reads).toHaveLength(3)
  s.offline(bob)
  s.reads[1]!.resolve({ friends: [alice], completeness: 'complete' })
  await oldRequest
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(s.client.getQueryData(key)).toEqual([])
  s.reads[2]!.resolve({ friends: [bob], completeness: 'complete' })
  await next
  expect(
    s.client.getQueryData<Friend[]>(key)?.map((f) => [f.platformUserId, f.presence.state])
  ).toEqual([[bob.platformUserId, 'offline']])
  expect(s.getFriends).toHaveBeenCalledTimes(2)
  s.client.clear()
})
