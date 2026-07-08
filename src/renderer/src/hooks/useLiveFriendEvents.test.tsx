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
import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Friend } from '@shared/types'
import { friendsQueryKey } from '../queries/friends'
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
})
