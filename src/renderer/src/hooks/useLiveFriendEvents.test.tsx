// @vitest-environment jsdom
/**
 * useLiveFriendEvents — CVR presence-snapshot race (2026-07-08).
 *
 * CVR pushes the ONLINE_FRIENDS snapshot on WS connect, which BEATS the slower
 * REST roster fetch. If the snapshot is only applied live it hits an empty cache
 * and is dropped — leaving every friend offline (the bug the owner saw). The fix
 * buffers the latest snapshot per platform and re-applies it when the roster
 * fetch resolves. These tests pin that, and the no-re-apply-loop guard.
 */
import { render, screen, cleanup, act, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Friend } from '@shared/types'
import { friendsQueryKey, useFriends } from '../queries/friends'
import { authStatusQueryKey } from '../queries/auth'
import { QUERY_CACHE_STORAGE_KEY } from '../queries/cache'
import { useProfileSelection } from '../stores/profileSelection'
import { useFriendsStore } from '../stores/friends'
import FriendsList from '../components/FriendsList'
import i18n from '../i18n'
import { useLiveFriendEvents } from './useLiveFriendEvents'

const G1 = '11111111-1111-1111-1111-111111111111'

function cvrFriend(state: 'in-game' | 'offline'): Friend {
  return {
    platformUserId: G1,
    platform: 'chilloutvr',
    displayName: 'K',
    avatarUrl: null,
    presence: { state },
    status: null,
    statusDescription: null,
    instance: null,
    trustRank: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  } as unknown as Friend
}

function vrcFriend(displayName: string): Friend {
  return {
    ...cvrFriend('offline'),
    platformUserId: `usr_${displayName.toLowerCase()}`,
    platform: 'vrchat',
    displayName
  }
}

const snapshotEvent = {
  type: 'presence-snapshot',
  platform: 'chilloutvr',
  entries: [{ platformUserId: G1, presence: { state: 'in-game' }, instance: null }]
}

let fireFriendEvent: ((e: unknown) => void) | undefined
let fireIdentityBoundary: ((payload: { platform: 'vrchat' | 'chilloutvr' }) => void) | undefined
const unsubscribeFriendEvent = vi.fn()
const unsubscribeIdentityBoundary = vi.fn()

function stubBridge(overrides: Record<string, unknown> = {}): void {
  const onFriendEvent = (cb: (e: unknown) => void): (() => void) => {
    fireFriendEvent = cb
    return () => {
      fireFriendEvent = undefined
      unsubscribeFriendEvent()
    }
  }
  const onIdentityBoundary = (
    cb: (payload: { platform: 'vrchat' | 'chilloutvr' }) => void
  ): (() => void) => {
    fireIdentityBoundary = cb
    return () => {
      fireIdentityBoundary = undefined
      unsubscribeIdentityBoundary()
    }
  }
  Object.assign(window, { vrx: { onFriendEvent, onIdentityBoundary, ...overrides } })
}

function Probe(): React.JSX.Element {
  useLiveFriendEvents()
  return <></>
}

const mount = (client: QueryClient): void => {
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  )
}

function FriendsProbe({
  onData
}: {
  onData: (friends: Friend[] | undefined) => void
}): React.JSX.Element {
  useLiveFriendEvents()
  const friends = useFriends('vrchat').data
  useEffect(() => onData(friends), [friends, onData])
  return <></>
}

const mountFriends = (
  client: QueryClient,
  onData: (friends: Friend[] | undefined) => void
): ReturnType<typeof render> =>
  render(
    <QueryClientProvider client={client}>
      <FriendsProbe onData={onData} />
    </QueryClientProvider>
  )

afterEach(() => {
  cleanup()
  fireFriendEvent = undefined
  fireIdentityBoundary = undefined
  unsubscribeFriendEvent.mockClear()
  unsubscribeIdentityBoundary.mockClear()
  window.localStorage.clear()
  Object.assign(window, { vrx: undefined })
  useFriendsStore.setState({ search: '', platformFilter: 'all' })
  useProfileSelection.getState().select(null)
})

describe('useLiveFriendEvents — CVR presence-snapshot race', () => {
  it('buffers a snapshot that beats the roster, then applies it once the roster fetch resolves', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    // Snapshot arrives BEFORE the roster is cached → dropped live, but buffered.
    act(() => fireFriendEvent!(snapshotEvent))
    expect(client.getQueryData(friendsQueryKey('chilloutvr'))).toBeUndefined()

    // Roster fetch resolves (a non-manual 'success') → buffered snapshot re-applies.
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })

    const cached = client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))
    expect(cached?.[0]?.presence.state).toBe('in-game') // presence applied, not stuck offline
  })

  it('applies a snapshot immediately when the roster is already cached (normal path, no re-apply loop)', () => {
    stubBridge()
    const client = new QueryClient()
    client.setQueryData(friendsQueryKey('chilloutvr'), [cvrFriend('offline')])
    mount(client)

    // If the re-apply subscription re-triggered on our own setQueryData writes,
    // this would recurse/hang; it completes because manual writes are filtered.
    act(() => fireFriendEvent!(snapshotEvent))

    const cached = client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))
    expect(cached?.[0]?.presence.state).toBe('in-game')
  })

  it('drops the buffer on a WS drop so a REST reconcile cannot resurrect stale in-game presence (Codex)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    // Snapshot buffered + roster loaded → presence applied (buffer is now active).
    act(() => fireFriendEvent!(snapshotEvent))
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))?.[0]?.presence.state).toBe(
      'in-game'
    )

    // WS drops — the buffered snapshot is now stale and must be discarded.
    act(() => fireFriendEvent!({ type: 'connection', platform: 'chilloutvr', health: 'down' }))

    // A periodic REST reconcile during the outage returns everyone offline.
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })

    // Stale in-game must NOT come back — the friend stays offline while we're blind.
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))?.[0]?.presence.state).toBe(
      'offline'
    )
  })

  it('on auth-invalidated: re-checks auth AND drops the stale friend roster (VRX-195)', () => {
    stubBridge()
    const client = new QueryClient()
    // A cached CVR roster from before the session died.
    client.setQueryData(friendsQueryKey('chilloutvr'), [cvrFriend('in-game')])
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    mount(client)

    act(() => fireFriendEvent!({ type: 'auth-invalidated', platform: 'chilloutvr' }))

    // (1) auth is re-checked so the Accounts card flips to reconnect.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: authStatusQueryKey('chilloutvr') })
    // (2) the now-unauthorized roster is emptied without removing the mounted query.
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))).toEqual([])
  })

  it('on auth-invalidated: persists the corrected empty roster (VRX-155)', () => {
    stubBridge()
    const client = new QueryClient()
    window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, '{"clientState":{}}')
    mount(client)

    act(() => fireFriendEvent!({ type: 'auth-invalidated', platform: 'chilloutvr' }))

    expect(window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('"data":[]')
  })

  it('quarantines a dead-session platform: a LATE snapshot after auth-invalidated is not applied (Codex)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => fireFriendEvent!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    // A late ONLINE_FRIENDS from the still-open dead socket must be ignored (not buffered).
    act(() => fireFriendEvent!(snapshotEvent))
    // A roster fetch resolves (reconcile / reconnect attempt) — while quarantined
    // even a successful roster is forced back to [], so there's nothing for the
    // stale snapshot to re-apply onto.
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })

    // Quarantined → roster stays empty; the stale snapshot was never applied.
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))).toEqual([])
  })

  it('quarantines a late friends-query SUCCESS: a fetch resolving after auth-invalidated is forced back to [] (Codex)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => fireFriendEvent!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    // A late / in-flight friends request resolves SUCCESSFULLY with the old roster.
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('in-game')])
      })
    })

    // The quarantine invariant forces the roster back to [] — the stale/
    // unauthorized data never survives across the auth boundary.
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))).toEqual([])
  })

  it('lifts the quarantine even when re-auth is written via setQueryData (manual), not only a refetch (Codex)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => fireFriendEvent!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    expect(client.getQueryData(friendsQueryKey('chilloutvr'))).toEqual([]) // quarantined

    // Re-login writes auth-status directly (a MANUAL setQueryData, not an
    // invalidate/refetch). The lift must still fire so the platform can't get
    // stuck quarantined regardless of HOW the login flow writes auth-status.
    act(() => {
      client.setQueryData(authStatusQueryKey('chilloutvr'), { state: 'authenticated' as const })
    })

    // Quarantine lifted → a real (non-manual) friends fetch now POPULATES instead
    // of being forced back to []. If the manual auth write had NOT lifted it, the
    // quarantine invariant would force this fetch empty.
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))?.[0]?.presence.state).toBe(
      'offline'
    )
  })

  it('lifts the quarantine when the platform RE-AUTHENTICATES (auth-status success), not only on connection:live (Codex)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => fireFriendEvent!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    expect(client.getQueryData(friendsQueryKey('chilloutvr'))).toEqual([]) // quarantined

    // Re-login: the auth query resolves to `authenticated` (no connection:live yet).
    await act(async () => {
      await client.fetchQuery({
        queryKey: authStatusQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve({ state: 'authenticated' as const })
      })
    })
    // Quarantine lifted → a friends fetch now POPULATES (not forced back to []).
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })

    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))?.[0]?.presence.state).toBe(
      'offline'
    )
  })

  it('does NOT lift the quarantine on connection:live alone — socket-open is not proof of re-auth (Codex)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => fireFriendEvent!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    // A socket opens (an in-flight reconnect can open with a STALE token before
    // the server rejects it) → 'live' fires, but that is NOT proof of re-auth.
    act(() => fireFriendEvent!({ type: 'connection', platform: 'chilloutvr', health: 'live' }))
    act(() => fireFriendEvent!(snapshotEvent))
    // 'live' while quarantined must re-verify auth, NOT refetch friends — a friends
    // invalidation would wake the useFriends observer → hit the dead session → 401
    // → auth-invalidated churn (CodeRabbit). Only auth-status is invalidated here.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: authStatusQueryKey('chilloutvr') })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: friendsQueryKey('chilloutvr') })
    // A friends fetch resolving after 'live' is STILL forced back to [] — the
    // quarantine held; only an authenticated auth-status releases it (test above).
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })

    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))).toEqual([])
  })

  it('ignores a roster-changed from a lingering dead socket while quarantined (no refetch → no 401 loop) (Codex)', () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    const invalidate = vi.spyOn(client, 'invalidateQueries')
    act(() => fireFriendEvent!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    // The old socket lingers and emits a roster change AFTER the session died.
    act(() => fireFriendEvent!({ type: 'roster-changed', platform: 'chilloutvr' }))

    // It must NOT invalidate (→ refetch → 401) the friends query while quarantined
    // — auth-invalidated only ever invalidates auth-status, never friends.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: friendsQueryKey('chilloutvr') })
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))).toEqual([])
  })
})

describe('useLiveFriendEvents — identity boundary', () => {
  it('drops cached friend notes while the drawer hook is unmounted', () => {
    stubBridge()
    const client = new QueryClient()
    const vrcNoteKey = ['friend-note', 'vrchat', 'usr_a', 0] as const
    const cvrNoteKey = ['friend-note', 'chilloutvr', G1, 0] as const
    client.setQueryData(vrcNoteKey, { note: 'Account A private note' })
    client.setQueryData(cvrNoteKey, { note: 'Other platform note' })
    mount(client)

    act(() => fireIdentityBoundary!({ platform: 'vrchat' }))

    expect(client.getQueryData(vrcNoteKey)).toBeUndefined()
    expect(client.getQueryData(cvrNoteKey)).toEqual({ note: 'Other platform note' })
  })

  it('clears a mounted useFriends observer immediately and refetches the new account (real QueryClient)', async () => {
    const accountA = [vrcFriend('Account A')]
    let resolveAccountB: ((friends: Friend[]) => void) | undefined
    const getFriends = vi
      .fn()
      .mockResolvedValueOnce(accountA)
      .mockImplementationOnce(() => new Promise<Friend[]>((resolve) => (resolveAccountB = resolve)))
    stubBridge({
      getAuthStatus: vi.fn().mockResolvedValue({ state: 'authenticated' }),
      getFriends
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observeData = vi.fn<(friends: Friend[] | undefined) => void>()
    client.setQueryData(authStatusQueryKey('vrchat'), { state: 'authenticated' })
    mountFriends(client, observeData)

    await waitFor(() => expect(observeData).toHaveBeenLastCalledWith(accountA))

    await act(async () => {
      fireIdentityBoundary!({ platform: 'vrchat' })
      await Promise.resolve()
    })

    // The mounted observer stays settled at [] while the boundary invalidation
    // triggers the new account's refetch.
    expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual([])
    expect(getFriends).toHaveBeenCalledTimes(2)

    await act(async () => resolveAccountB?.([vrcFriend('Account B')]))
  })

  it('never reapplies account A snapshot when account B roster resolves before connection live (real QueryClient)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => fireFriendEvent!(snapshotEvent))
    act(() => fireIdentityBoundary!({ platform: 'chilloutvr' }))
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })

    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))?.[0]?.presence.state).toBe(
      'offline'
    )
  })

  it('isolates a VRChat boundary from ChilloutVR cache and snapshot buffer', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => fireFriendEvent!(snapshotEvent))
    act(() => fireIdentityBoundary!({ platform: 'vrchat' }))
    await act(async () => {
      await client.fetchQuery({
        queryKey: friendsQueryKey('chilloutvr'),
        queryFn: () => Promise.resolve([cvrFriend('offline')])
      })
    })

    expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual([])
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))?.[0]?.presence.state).toBe(
      'in-game'
    )
  })

  it('subscribes to identity boundaries once and unsubscribes on unmount', () => {
    const onIdentityBoundary = vi.fn(
      (callback: (payload: { platform: 'vrchat' | 'chilloutvr' }) => void) => {
        fireIdentityBoundary = callback
        return unsubscribeIdentityBoundary
      }
    )
    stubBridge({ onIdentityBoundary })
    const client = new QueryClient()

    const mounted = render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )

    expect(onIdentityBoundary).toHaveBeenCalledOnce()
    mounted.unmount()
    expect(unsubscribeIdentityBoundary).toHaveBeenCalledOnce()
  })

  it('persists the corrected empty roster on identity boundary (VRX-155)', () => {
    stubBridge()
    const client = new QueryClient()
    window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, '{"clientState":{}}')
    mount(client)

    act(() => fireIdentityBoundary!({ platform: 'vrchat' }))

    expect(window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('"data":[]')
  })
})

describe('useLiveFriendEvents — auth-status quarantine guard (VRX-155)', () => {
  it('does not fabricate an empty roster for a never-signed-in platform when auth settles unauthenticated', () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => {
      client.setQueryData(authStatusQueryKey('chilloutvr'), {
        state: 'unauthenticated',
        accountId: null,
        displayName: null
      })
    })

    // Absent means "nothing known"; [] would be a false "signed in, zero friends" signal.
    expect(client.getQueryData(friendsQueryKey('chilloutvr'))).toBeUndefined()
    expect(window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull()
  })

  it('still clears a hydrated disk roster to [] and persists when auth settles to needs-2fa', () => {
    stubBridge()
    const client = new QueryClient()
    client.setQueryData(friendsQueryKey('vrchat'), [vrcFriend('Hydrated')])
    window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, '{"clientState":{}}')
    mount(client)

    act(() => {
      client.setQueryData(authStatusQueryKey('vrchat'), {
        state: 'needs-2fa',
        twoFactorMethod: 'totp',
        accountId: null,
        displayName: null
      })
    })

    expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual([])
    expect(window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('"data":[]')
  })

  it('keeps the all-platform FriendsList loading while the other platform fetch is still pending', async () => {
    function FriendsListProbe(): React.JSX.Element {
      useLiveFriendEvents()
      return <FriendsList />
    }

    stubBridge({
      getFriends: vi.fn(() => new Promise<Friend[]>(() => {}))
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    useFriendsStore.setState({ platformFilter: 'all', search: '' })
    useProfileSelection.getState().select(null)

    render(
      <QueryClientProvider client={client}>
        <FriendsListProbe />
      </QueryClientProvider>
    )

    await act(async () => {
      client.setQueryData(authStatusQueryKey('vrchat'), {
        state: 'authenticated',
        accountId: 'vrc-account',
        displayName: 'VRC'
      })
      client.setQueryData(authStatusQueryKey('chilloutvr'), {
        state: 'unauthenticated',
        accountId: null,
        displayName: null
      })
      await Promise.resolve()
    })

    // The VRChat fetch is still pending; CVR has no fabricated roster. The list
    // must stay in loading, not flash a false empty state.
    expect(await screen.findByText(i18n.t('friends.loading'))).toBeTruthy()
    expect(screen.queryByText(i18n.t('friends.empty'))).toBeNull()
  })
})

describe('useLiveFriendEvents — roster request ordering', () => {
  it.each(['complete', 'partial'] as const)(
    'keeps a first-load removal in a delayed %s roster',
    async (completeness) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const friend = vrcFriend('Alice')
      client.setQueryData(authStatusQueryKey('vrchat'), {
        state: 'authenticated',
        accountId: 'self',
        displayName: 'Self'
      })
      let resolve!: (value: Friend[] | { friends: Friend[]; completeness: 'partial' }) => void
      stubBridge({
        getFriends: () =>
          new Promise((done) => {
            resolve = done
          })
      })
      const mounted = mountFriends(client, () => {})
      await waitFor(() => expect(resolve).toBeTypeOf('function'))
      act(() =>
        fireFriendEvent!({
          type: 'friend-removed',
          platform: 'vrchat',
          platformUserId: friend.platformUserId
        })
      )
      expect(client.getQueryData(friendsQueryKey('vrchat'))).toBeUndefined()
      await act(async () => {
        resolve(
          completeness === 'complete' ? [friend] : { friends: [friend], completeness: 'partial' }
        )
      })
      await waitFor(() => expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual([]))
      mounted.unmount()
      client.clear()
    }
  )

  it('preserves partial-roster omissions while applying newer live removals', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const alice = vrcFriend('Alice')
    const omitted = vrcFriend('Omitted')
    client.setQueryData(authStatusQueryKey('vrchat'), {
      state: 'authenticated',
      accountId: 'self',
      displayName: 'Self'
    })
    client.setQueryData(friendsQueryKey('vrchat'), [alice, omitted])
    let resolve!: (value: { friends: Friend[]; completeness: 'partial' }) => void
    stubBridge({
      getFriends: () =>
        new Promise((done) => {
          resolve = done
        })
    })
    const mounted = mountFriends(client, () => {})
    let pending!: Promise<void>
    act(() => {
      pending = client.invalidateQueries({ queryKey: friendsQueryKey('vrchat') })
    })
    await waitFor(() => expect(resolve).toBeTypeOf('function'))
    act(() =>
      fireFriendEvent!({
        type: 'friend-removed',
        platform: 'vrchat',
        platformUserId: alice.platformUserId
      })
    )
    await act(async () => {
      resolve({ friends: [alice], completeness: 'partial' })
      await pending
    })
    expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual([omitted])
    mounted.unmount()
    client.clear()
  })

  it.each(['friend-offline', 'friend-removed'] as const)(
    'keeps a newer %s when an older roster completes',
    async (type) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const friend: Friend = {
        ...vrcFriend('Alice'),
        platform: 'vrchat',
        presence: { state: 'active' }
      }
      client.setQueryData(authStatusQueryKey('vrchat'), {
        platform: 'vrchat',
        state: 'authenticated',
        accountId: 'self',
        displayName: 'Self'
      })
      client.setQueryData(friendsQueryKey('vrchat'), [friend])
      let resolve!: (friends: Friend[]) => void
      const getFriends = vi.fn(
        () =>
          new Promise<Friend[]>((done) => {
            resolve = done
          })
      )
      stubBridge({ getFriends })
      const mounted = mountFriends(client, () => {})
      let pending!: Promise<void>
      act(() => {
        pending = client.invalidateQueries({ queryKey: friendsQueryKey('vrchat') })
      })
      await waitFor(() => expect(getFriends).toHaveBeenCalledTimes(1))
      act(() =>
        fireFriendEvent!({ type, platform: 'vrchat', platformUserId: friend.platformUserId })
      )
      const expected =
        type === 'friend-removed' ? [] : [{ ...friend, presence: { state: 'offline' } }]
      expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual(expected)
      await act(async () => {
        resolve([friend])
        await pending
      })
      expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual(expected)
      mounted.unmount()
      client.clear()
    }
  )
})

describe('all-platform FriendsList recovery with one signed-out platform', () => {
  it.each(['vrchat', 'chilloutvr'] as const)(
    'shows %s load failure and refreshes only that authenticated platform',
    async (platform) => {
      const other = platform === 'vrchat' ? 'chilloutvr' : 'vrchat'
      const getFriends = vi.fn().mockRejectedValue(new Error('synthetic unavailable roster'))
      stubBridge({ getFriends })
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      client.setQueryData(authStatusQueryKey(platform), {
        platform,
        state: 'authenticated',
        accountId: 'self',
        displayName: 'Self'
      })
      client.setQueryData(authStatusQueryKey(other), {
        platform: other,
        state: 'unauthenticated',
        accountId: null,
        displayName: null
      })
      function FriendsListProbe(): React.JSX.Element {
        useLiveFriendEvents()
        return <FriendsList />
      }
      const mounted = render(
        <QueryClientProvider client={client}>
          <FriendsListProbe />
        </QueryClientProvider>
      )
      await waitFor(() =>
        expect(client.getQueryState(friendsQueryKey(platform))?.status).toBe('error')
      )
      expect(await screen.findByText(i18n.t('friends.error'))).toBeTruthy()
      expect(screen.queryByText(i18n.t('friends.loading'))).toBeNull()
      expect(client.getQueryData(friendsQueryKey(other))).toBeUndefined()
      expect(getFriends.mock.calls).toEqual([[{ platform }]])

      getFriends.mockResolvedValue([])
      fireEvent.click(screen.getByRole('button', { name: i18n.t('friends.refresh') }))
      await waitFor(() => expect(screen.getByText(i18n.t('friends.empty'))).toBeTruthy())
      expect(screen.queryByText(i18n.t('friends.error'))).toBeNull()
      expect(getFriends.mock.calls).toEqual([[{ platform }], [{ platform }]])
      expect(client.getQueryData(friendsQueryKey(other))).toBeUndefined()
      mounted.unmount()
      client.clear()
    }
  )
})

it.each(['identity', 'auth-invalidated'] as const)(
  'abandons pending VRChat transport at %s boundary without publishing old data',
  async (boundary) => {
    const old = vrcFriend('Old account')
    const next = vrcFriend('Next account')
    let resolveOld!: (friends: Friend[]) => void
    let resolveNext!: (friends: Friend[]) => void
    const getFriends = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Friend[]>((resolve) => {
            resolveOld = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Friend[]>((resolve) => {
            resolveNext = resolve
          })
      )
    stubBridge({
      getFriends,
      getAuthStatus: vi
        .fn()
        .mockResolvedValue({ state: boundary === 'identity' ? 'authenticated' : 'unauthenticated' })
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(authStatusQueryKey('vrchat'), { state: 'authenticated' })
    const mounted = mountFriends(client, () => {})
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
    await act(async () => {
      if (boundary === 'identity') fireIdentityBoundary!({ platform: 'vrchat' })
      else fireFriendEvent!({ type: 'auth-invalidated', platform: 'vrchat' })
    })
    if (boundary === 'identity') await waitFor(() => expect(resolveNext).toBeTypeOf('function'))
    act(() =>
      fireFriendEvent!({
        type: 'friend-offline',
        platform: 'vrchat',
        platformUserId: next.platformUserId
      })
    )
    await act(async () => resolveOld([old]))
    expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual([])
    if (boundary === 'identity') {
      await act(async () => resolveNext([next]))
      await waitFor(() =>
        expect(client.getQueryData<Friend[]>(friendsQueryKey('vrchat'))?.[0]?.presence.state).toBe(
          'offline'
        )
      )
      expect(getFriends).toHaveBeenCalledTimes(2)
    } else expect(getFriends).toHaveBeenCalledOnce()
    mounted.unmount()
    client.clear()
  }
)

it('ignores an older push delivered after the newer native roster reply', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const friend: Friend = {
    ...vrcFriend('Alice'),
    platform: 'vrchat',
    presence: { state: 'active' }
  }
  client.setQueryData(authStatusQueryKey('vrchat'), { state: 'authenticated', accountId: 'self' })
  stubBridge({
    getFriends: async () => ({
      friends: [friend],
      completeness: 'complete',
      provenance: { baseRevision: 3, overrides: [] }
    })
  })
  const mounted = mountFriends(client, () => {})
  await waitFor(() => expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual([friend]))
  const event = {
    type: 'friend-offline' as const,
    platform: 'vrchat' as const,
    platformUserId: friend.platformUserId,
    rosterRevision: 2
  }
  act(() => fireFriendEvent!(event))
  expect(client.getQueryData(friendsQueryKey('vrchat'))).toEqual([friend])
  act(() => fireFriendEvent!({ ...event, rosterRevision: 4 }))
  expect(client.getQueryData<Friend[]>(friendsQueryKey('vrchat'))?.[0]?.presence.state).toBe(
    'offline'
  )
  mounted.unmount()
  client.clear()
})
