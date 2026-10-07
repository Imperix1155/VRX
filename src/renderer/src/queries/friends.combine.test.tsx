// @vitest-environment jsdom
/**
 * combineFriendQueries hook wrapper tests (VRX-66 / audit OP-B1).
 *
 * Pins the memoization fix: the combined `friends` array must keep its
 * reference across renders when the underlying `vrc.data`/`cvr.data` arrays
 * have not changed, so downstream memoization in the view actually holds.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import { combineFriendQueries, useCombineFriendQueries, type FriendQuery } from './friends'

function query(overrides: Partial<FriendQuery> = {}): FriendQuery {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: async () => ({}) as never,
    ...overrides
  }
}

const vrcFriend: Friend = {
  platform: 'vrchat',
  platformUserId: 'usr_vrc',
  displayName: 'VRChat Friend',
  avatarUrl: null,
  presence: { state: 'offline' },
  status: null,
  statusDescription: null,
  trustRank: 'known',
  instance: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

const cvrFriend: Friend = {
  platform: 'chilloutvr',
  platformUserId: 'usr_cvr',
  displayName: 'CVR Friend',
  avatarUrl: null,
  presence: { state: 'offline' },
  status: null,
  statusDescription: null,
  trustRank: null,
  instance: null,
  isFavorite: false,
  favoriteGroupIds: [],
  linkedPersonId: null
}

describe('useCombineFriendQueries', () => {
  it('returns the same friends array reference on rerender when data is unchanged', () => {
    const vrc = query({ data: [vrcFriend] })
    const cvr = query({ data: [cvrFriend] })

    const { result, rerender } = renderHook(
      ({ vrc, cvr }) => useCombineFriendQueries('all', vrc, cvr),
      { initialProps: { vrc, cvr } }
    )
    const first = result.current.friends

    rerender({ vrc, cvr })
    expect(result.current.friends).toBe(first)
  })

  it('keeps the friends reference stable when only isFetching flips (background refetch)', () => {
    const vrc = query({ data: [vrcFriend] })
    const cvr = query({ data: [cvrFriend] })

    const { result, rerender } = renderHook(
      ({ vrc, cvr }) => useCombineFriendQueries('all', vrc, cvr),
      { initialProps: { vrc, cvr } }
    )
    const first = result.current.friends

    rerender({
      vrc: { ...vrc, isFetching: true },
      cvr: { ...cvr, isFetching: true }
    })
    expect(result.current.friends).toBe(first)
  })

  it('produces a new friends array when the data itself changes', () => {
    const vrc = query({ data: [vrcFriend] })
    const cvr = query({ data: [cvrFriend] })

    const { result, rerender } = renderHook(
      ({ vrc, cvr }) => useCombineFriendQueries('all', vrc, cvr),
      { initialProps: { vrc, cvr } }
    )
    const first = result.current.friends

    rerender({
      vrc: { ...vrc, data: [vrcFriend, { ...cvrFriend, platform: 'vrchat' }] },
      cvr
    })
    expect(result.current.friends).not.toBe(first)
  })
})

describe('combined query enablement', () => {
  it('ignores disabled pending/error state and does not bypass its auth gate on refresh', () => {
    const vrc = query({ isError: true, refetch: vi.fn() })
    const cvr = Object.assign(query({ isPending: true, refetch: vi.fn() }), { isEnabled: false })
    const pure = combineFriendQueries('all', vrc, cvr)
    const { result } = renderHook(() => useCombineFriendQueries('all', vrc, cvr))
    for (const view of [pure, result.current]) {
      expect(view).toMatchObject({ isPending: false, isError: true })
      view.refetch()
    }
    expect(vrc.refetch).toHaveBeenCalledTimes(2)
    expect(cvr.refetch).not.toHaveBeenCalled()

    const disabledError = Object.assign(query({ isError: true }), { isEnabled: false })
    expect(combineFriendQueries('all', query({ data: [] }), disabledError)).toMatchObject({
      friends: [],
      isError: false,
      isPending: false
    })
  })

  it('keeps an enabled paused first load pending instead of treating idle as signed out', () => {
    const vrc = Object.assign(query({ isPending: true, isFetching: false }), { isEnabled: true })
    const cvr = Object.assign(query({ isError: true }), { isEnabled: false })
    const { result } = renderHook(() => useCombineFriendQueries('all', vrc, cvr))
    expect(result.current).toMatchObject({ isPending: true, isError: false })
  })
})
