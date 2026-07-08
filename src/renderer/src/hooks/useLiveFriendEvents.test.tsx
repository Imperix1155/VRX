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
import { render, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Friend } from '@shared/types'
import { friendsQueryKey } from '../queries/friends'
import { authStatusQueryKey } from '../queries/auth'
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

const snapshotEvent = {
  type: 'presence-snapshot',
  platform: 'chilloutvr',
  entries: [{ platformUserId: G1, presence: { state: 'in-game' }, instance: null }]
}

let fire: ((e: unknown) => void) | undefined
function stubBridge(): void {
  const onFriendEvent = (cb: (e: unknown) => void): (() => void) => {
    fire = cb
    return () => {
      fire = undefined
    }
  }
  Object.assign(window, { vrx: { onFriendEvent } })
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

afterEach(() => {
  cleanup()
  fire = undefined
  Object.assign(window, { vrx: undefined })
})

describe('useLiveFriendEvents — CVR presence-snapshot race', () => {
  it('buffers a snapshot that beats the roster, then applies it once the roster fetch resolves', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    // Snapshot arrives BEFORE the roster is cached → dropped live, but buffered.
    act(() => fire!(snapshotEvent))
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
    act(() => fire!(snapshotEvent))

    const cached = client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))
    expect(cached?.[0]?.presence.state).toBe('in-game')
  })

  it('drops the buffer on a WS drop so a REST reconcile cannot resurrect stale in-game presence (Codex)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    // Snapshot buffered + roster loaded → presence applied (buffer is now active).
    act(() => fire!(snapshotEvent))
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
    act(() => fire!({ type: 'connection', platform: 'chilloutvr', health: 'down' }))

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

    act(() => fire!({ type: 'auth-invalidated', platform: 'chilloutvr' }))

    // (1) auth is re-checked so the Accounts card flips to reconnect.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: authStatusQueryKey('chilloutvr') })
    // (2) the now-unauthorized roster is dropped — not shown across the auth
    // boundary in Friends / Dashboard / TopBar (Codex).
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))).toEqual([])
  })

  it('quarantines a dead-session platform: a LATE snapshot after auth-invalidated is not applied (Codex)', async () => {
    stubBridge()
    const client = new QueryClient()
    mount(client)

    act(() => fire!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    // A late ONLINE_FRIENDS from the still-open dead socket must be ignored (not buffered).
    act(() => fire!(snapshotEvent))
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

    act(() => fire!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
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

    act(() => fire!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
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

    act(() => fire!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
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

    act(() => fire!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    // A socket opens (an in-flight reconnect can open with a STALE token before
    // the server rejects it) → 'live' fires, but that is NOT proof of re-auth.
    act(() => fire!({ type: 'connection', platform: 'chilloutvr', health: 'live' }))
    act(() => fire!(snapshotEvent))
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
    act(() => fire!({ type: 'auth-invalidated', platform: 'chilloutvr' }))
    // The old socket lingers and emits a roster change AFTER the session died.
    act(() => fire!({ type: 'roster-changed', platform: 'chilloutvr' }))

    // It must NOT invalidate (→ refetch → 401) the friends query while quarantined
    // — auth-invalidated only ever invalidates auth-status, never friends.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: friendsQueryKey('chilloutvr') })
    expect(client.getQueryData<Friend[]>(friendsQueryKey('chilloutvr'))).toEqual([])
  })
})
