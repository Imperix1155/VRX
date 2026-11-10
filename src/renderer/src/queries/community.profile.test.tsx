// @vitest-environment jsdom
/**
 * A friend's full profile and its Unfriend or block options must not get stuck
 * on an answer that was only true for a moment: "unknown person" while main is
 * still loading the friends list, or "is a friend" from before the friendship
 * started or ended.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PersonProfile, ProfileResult } from '@shared/community'
import type { RelationshipResult } from '@shared/socialActions'
import type { AuthStatus, Friend, Platform } from '@shared/types'
import {
  PROFILE_WAIT_MS,
  PROFILE_WAIT_TRIES,
  communityQueryKey,
  useFollowFriendship,
  useProfile
} from './community'
import { EMPTY_ROSTER_PLACEHOLDER, friendsQueryKey } from './friends'

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth')>()),
  useAuthStatus: (platform: Platform) => {
    const data: AuthStatus = {
      platform,
      state: 'authenticated',
      accountId: `${platform}-me`,
      displayName: 'Me'
    }
    return { data, isSuccess: true, isFetching: false, isPending: false }
  }
}))

const VRC_ID = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const CVR_ID = '5a3c1e2d-0000-4000-8000-00000000000a'

function profile(platform: Platform, userId: string, isFriend: boolean): PersonProfile {
  return { platform, userId, displayName: 'Lumen', isFriend } as PersonProfile
}

function friend(platform: Platform, platformUserId: string): Friend {
  return { id: `${platform}:${platformUserId}`, platform, platformUserId } as unknown as Friend
}

const bridge = {
  getProfile: vi.fn<(req: { platform: Platform; userId: string }) => Promise<ProfileResult>>()
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  Object.defineProperty(window, 'vrx', { value: bridge, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  Reflect.deleteProperty(window, 'vrx')
})

describe('useProfile', () => {
  it('keeps loading while main does not know the friend yet, then shows the profile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    bridge.getProfile
      .mockResolvedValueOnce({ ok: false, reason: 'unknown-person' })
      .mockResolvedValueOnce({ ok: false, reason: 'unknown-person' })
      .mockResolvedValue({ ok: true, profile: profile('vrchat', VRC_ID, true) })
    const { result } = renderHook(() => useProfile('vrchat', VRC_ID), {
      wrapper: wrapper(newClient())
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROFILE_WAIT_MS * 2)
    })
    await waitFor(() => expect(result.current.data?.ok).toBe(true))
    expect(bridge.getProfile).toHaveBeenCalledTimes(3)
  })

  it('stops asking after a while and answers "unknown person"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    bridge.getProfile.mockResolvedValue({ ok: false, reason: 'unknown-person' })
    const { result } = renderHook(() => useProfile('vrchat', VRC_ID), {
      wrapper: wrapper(newClient())
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROFILE_WAIT_MS * (PROFILE_WAIT_TRIES + 3))
    })
    await waitFor(() =>
      expect(result.current.data).toEqual({ ok: false, reason: 'unknown-person' })
    )
    expect(bridge.getProfile).toHaveBeenCalledTimes(PROFILE_WAIT_TRIES)
  })

  it('asks nothing more once the profile closes during the wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    bridge.getProfile.mockResolvedValue({ ok: false, reason: 'unknown-person' })
    const client = newClient()
    renderHook(() => useProfile('vrchat', VRC_ID), { wrapper: wrapper(client) })
    await waitFor(() => expect(bridge.getProfile).toHaveBeenCalledTimes(1))
    await act(async () => {
      await client.cancelQueries()
      await vi.advanceTimersByTimeAsync(PROFILE_WAIT_MS * 3)
    })
    expect(bridge.getProfile).toHaveBeenCalledTimes(1)
  })

  it('asks again on the next open after "unknown person", but keeps a platform failure', async () => {
    const client = newClient()
    bridge.getProfile.mockResolvedValue({ ok: false, reason: 'unavailable' })
    const first = renderHook(() => useProfile('chilloutvr', CVR_ID), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.data).toBeDefined())
    first.unmount()
    renderHook(() => useProfile('chilloutvr', CVR_ID), { wrapper: wrapper(client) })
    // A platform failure has its own Try again; opening again doesn't re-ask.
    expect(bridge.getProfile).toHaveBeenCalledTimes(1)

    const signedOutForNow: ProfileResult = { ok: false, reason: 'not-authenticated' }
    client.setQueryData(
      communityQueryKey('profile', 'chilloutvr', 'chilloutvr-me', CVR_ID),
      signedOutForNow
    )
    bridge.getProfile.mockResolvedValue({ ok: true, profile: profile('chilloutvr', CVR_ID, true) })
    const again = renderHook(() => useProfile('chilloutvr', CVR_ID), { wrapper: wrapper(client) })
    await waitFor(() => expect(again.result.current.data?.ok).toBe(true))
    expect(bridge.getProfile).toHaveBeenCalledTimes(2)
  })
})

describe('useFollowFriendship', () => {
  function seed(client: QueryClient, platform: Platform, userId: string, isFriend: boolean): void {
    const account = `${platform}-me`
    const relationship: RelationshipResult = {
      ok: true,
      relationship: { platform, userId, isFriend, blocked: false }
    }
    client.setQueryData(communityQueryKey('relationship', platform, account, userId), relationship)
    const shown: ProfileResult = { ok: true, profile: profile(platform, userId, isFriend) }
    client.setQueryData(communityQueryKey('profile', platform, account, userId), shown)
  }

  function saved(client: QueryClient, platform: Platform, userId: string): [unknown, unknown] {
    const account = `${platform}-me`
    const relationship = client.getQueryData<RelationshipResult>(
      communityQueryKey('relationship', platform, account, userId)
    )
    const shown = client.getQueryData<ProfileResult>(
      communityQueryKey('profile', platform, account, userId)
    )
    return [
      relationship?.ok ? relationship.relationship.isFriend : undefined,
      shown?.ok ? shown.profile.isFriend : undefined
    ]
  }

  it('turns a saved "not a friend" into a friend once they are on the list', () => {
    const client = newClient()
    seed(client, 'chilloutvr', CVR_ID, false)
    client.setQueryData(friendsQueryKey('chilloutvr'), [friend('chilloutvr', CVR_ID.toUpperCase())])
    renderHook(() => useFollowFriendship('chilloutvr', CVR_ID), { wrapper: wrapper(client) })
    expect(saved(client, 'chilloutvr', CVR_ID)).toEqual([true, true])
  })

  it('follows a friendship that starts and ends while the profile shows', () => {
    const client = newClient()
    seed(client, 'vrchat', VRC_ID, false)
    client.setQueryData(friendsQueryKey('vrchat'), [])
    renderHook(() => useFollowFriendship('vrchat', VRC_ID), { wrapper: wrapper(client) })
    expect(saved(client, 'vrchat', VRC_ID)).toEqual([false, false])

    act(() => {
      client.setQueryData(friendsQueryKey('vrchat'), [friend('vrchat', VRC_ID)])
    })
    expect(saved(client, 'vrchat', VRC_ID)).toEqual([true, true])

    act(() => {
      client.setQueryData(friendsQueryKey('vrchat'), [])
    })
    expect(saved(client, 'vrchat', VRC_ID)).toEqual([false, false])
  })

  it('never calls someone not a friend from a list that is still loading', () => {
    const client = newClient()
    seed(client, 'vrchat', VRC_ID, true)
    renderHook(() => useFollowFriendship('vrchat', VRC_ID), { wrapper: wrapper(client) })
    act(() => {
      client.setQueryData(friendsQueryKey('vrchat'), [], EMPTY_ROSTER_PLACEHOLDER)
    })
    expect(saved(client, 'vrchat', VRC_ID)).toEqual([true, true])
    // A list that loads without them, with no departure seen, isn't proof.
    act(() => {
      client.setQueryData(friendsQueryKey('vrchat'), [friend('vrchat', 'usr_other')])
    })
    expect(saved(client, 'vrchat', VRC_ID)).toEqual([true, true])
  })
})
