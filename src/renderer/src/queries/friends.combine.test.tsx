// @vitest-environment jsdom
/**
 * combineFriendQueries hook wrapper tests (VRX-66 / audit OP-B1).
 *
 * Pins the memoization fix: the combined `friends` array must keep its
 * reference across renders when the underlying `vrc.data`/`cvr.data` arrays
 * have not changed, so downstream memoization in the view actually holds.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Friend } from '@shared/types'
import { useCombineFriendQueries, type FriendQuery } from './friends'

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
