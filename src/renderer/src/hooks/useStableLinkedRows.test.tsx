// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import type { LinkedProfile } from '@shared/linkedProfiles'
import { projectLinkedFriends, type LinkedRow } from '../utils/projectLinkedFriends'
import { useStableLinkedRows } from './useStableLinkedRows'

function friend(
  platform: Friend['platform'],
  id: string,
  name: string,
  state: Friend['presence']['state']
): Friend {
  if (platform === 'chilloutvr') {
    return {
      platform,
      platformUserId: id,
      displayName: name,
      avatarUrl: null,
      presence: { state: state === 'active' ? 'offline' : state },
      status: null,
      statusDescription: null,
      trustRank: null,
      instance: null,
      isFavorite: false,
      favoriteGroupIds: [],
      linkedPersonId: null
    }
  }
  return {
    platform,
    platformUserId: id,
    displayName: name,
    avatarUrl: null,
    presence: { state },
    status: 'online',
    statusDescription: null,
    trustRank: null,
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
}

const vrcOld = friend('vrchat', 'vrc-friend', 'VRC old', 'active')
const vrcNew = friend('vrchat', 'vrc-friend', 'VRC new', 'in-game')
const cvr = friend('chilloutvr', 'cvr-friend', 'CVR', 'in-game')

function accountRow(overrides: Partial<LinkedRow> = {}, account: Friend = vrcOld): LinkedRow {
  return {
    key: 'person:one:vrchat:vrc-friend',
    personKey: 'person:one',
    target: {
      kind: 'account',
      account: { platform: 'vrchat', friendId: 'vrc-friend' },
      personId: 'one'
    },
    accounts: [account],
    name: account.displayName,
    section: 'online',
    platformMark: 'vrchat',
    ...overrides
  }
}

function combinedRow(overrides: Partial<LinkedRow> = {}): LinkedRow {
  return {
    key: 'person:one',
    personKey: 'person:one',
    target: {
      kind: 'person',
      personId: 'one',
      anchor: { platform: 'vrchat', friendId: 'vrc-friend' }
    },
    accounts: [vrcOld, cvr],
    name: 'Combined old',
    section: 'online',
    platformMark: 'vrx',
    ...overrides
  }
}

afterEach(() => vi.useRealTimers())

describe('useStableLinkedRows', () => {
  it('keeps a section-moving held account row in place while patching its live payload', () => {
    const initial = [accountRow()]
    const moved = [
      accountRow({ accounts: [vrcNew], name: vrcNew.displayName, section: 'in-game' }, vrcNew)
    ]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: moved, heldKey: initial[0]?.key ?? null })
    expect(hook.result.current).toHaveLength(1)
    expect(hook.result.current[0]).toMatchObject({
      key: initial[0]?.key,
      section: 'online',
      target: initial[0]?.target,
      accounts: [vrcNew],
      name: 'VRC new'
    })
  })

  it('keeps the held account shape and only its current account through a split-to-combined transition', () => {
    const initial = [accountRow()]
    const combined = [
      combinedRow({ accounts: [vrcNew, cvr], name: 'Combined new', section: 'in-game' })
    ]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: combined, heldKey: initial[0]?.key ?? null })
    expect(hook.result.current).toHaveLength(1)
    expect(hook.result.current[0]).toMatchObject({
      key: 'person:one:vrchat:vrc-friend',
      target: initial[0]?.target,
      accounts: [vrcNew],
      name: 'VRC new'
    })
    expect(hook.result.current.some((row) => row.key === 'person:one')).toBe(false)
  })

  it('keeps the held combined shape and patches every current account through a combined-to-split transition', () => {
    const initial = [combinedRow()]
    const split = [
      accountRow({ accounts: [vrcNew], name: vrcNew.displayName, section: 'in-game' }, vrcNew),
      {
        ...accountRow({ key: 'person:one:chilloutvr:cvr-friend', name: cvr.displayName }, cvr),
        target: {
          kind: 'account' as const,
          account: { platform: 'chilloutvr' as const, friendId: 'cvr-friend' },
          personId: 'one'
        },
        platformMark: 'chilloutvr' as const
      }
    ]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: split, heldKey: initial[0]?.key ?? null })
    expect(hook.result.current).toHaveLength(1)
    expect(hook.result.current[0]).toMatchObject({
      key: 'person:one',
      target: initial[0]?.target,
      accounts: [vrcNew, cvr],
      name: 'Combined old'
    })
    expect(hook.result.current.filter((row) => row.personKey === 'person:one')).toHaveLength(1)
  })

  it('passes through a same-shape live update without delaying it', () => {
    const initial = [accountRow()]
    const updated = [accountRow({ accounts: [vrcNew], name: vrcNew.displayName }, vrcNew)]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: updated, heldKey: initial[0]?.key ?? null })
    expect(hook.result.current).toBe(updated)
  })

  it('shows the name a new search matched on a held row at once', () => {
    const initial = [accountRow()]
    const searched = [accountRow({ matchedName: 'VRC old alt' })]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: searched, heldKey: initial[0]?.key ?? null })
    expect(hook.result.current).toBe(searched)
    expect(hook.result.current[0]?.matchedName).toBe('VRC old alt')
  })

  it('gives a held row that moved the current search’s matched name, not the last one', () => {
    const initial = [accountRow({ matchedName: 'Old match' })]
    const moved = [
      accountRow(
        { accounts: [vrcNew], name: vrcNew.displayName, section: 'in-game', matchedName: 'New' },
        vrcNew
      )
    ]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: moved, heldKey: initial[0]?.key ?? null })
    // Still held in its old section, with the matched name the search now gives.
    expect(hook.result.current[0]).toMatchObject({ section: 'online', matchedName: 'New' })
  })

  describe('a held row whose person splits or merges while searching', () => {
    function profile(customName: string | null): LinkedProfile {
      return {
        id: 'one',
        members: [
          { platform: 'vrchat', platformAccountId: 'me-v', friendId: 'vrc-friend' },
          { platform: 'chilloutvr', platformAccountId: 'me-c', friendId: 'cvr-friend' }
        ],
        customName,
        defaultName: 'Default',
        preferredPlatform: 'vrchat',
        pictureMode: 'preferred',
        sharedNote: '',
        revision: 1
      }
    }
    function project(friends: Friend[], customName: string | null, search: string): LinkedRow[] {
      return projectLinkedFriends({
        friends,
        profiles: [profile(customName)],
        accountIds: { vrchat: 'me-v', chilloutvr: 'me-c' },
        filter: 'all',
        search
      }).rows
    }
    /** Holds the row named `heldName`, applies `after`, and returns what the
     *  held row shows. */
    function held(
      before: LinkedRow[],
      after: LinkedRow[],
      heldName: string,
      search: string
    ): LinkedRow | undefined {
      const key = before.find((row) => row.name === heldName)?.key ?? null
      const hook = renderHook(({ rows }) => useStableLinkedRows(rows, key, search), {
        initialProps: { rows: before }
      })
      hook.rerender({ rows: after })
      return hook.result.current.find((row) => row.key === key)
    }
    const vrc = (name: string, state: Friend['presence']['state']): Friend =>
      friend('vrchat', 'vrc-friend', name, state)
    const cvrAt = (name: string, state: Friend['presence']['state']): Friend =>
      friend('chilloutvr', 'cvr-friend', name, state)

    it('names the account that matched on a merge, with no custom name', () => {
      const before = project([vrc('Bob', 'active'), cvrAt('Carl', 'in-game')], null, 'bob')
      const after = project([vrc('Bob', 'active'), cvrAt('Carl', 'offline')], null, 'bob')
      expect(after).toHaveLength(1)
      expect(held(before, after, 'Carl', 'bob')).toMatchObject({
        name: 'Carl',
        matchedName: 'Bob'
      })
    })

    it('names the custom name that matched on a merge', () => {
      const before = project([vrc('Bob', 'active'), cvrAt('Carl', 'in-game')], 'Alice', 'ali')
      const after = project([vrc('Bob', 'in-game'), cvrAt('Carl', 'in-game')], 'Alice', 'ali')
      expect(held(before, after, 'Bob', 'ali')).toMatchObject({ name: 'Bob', matchedName: 'Alice' })
    })

    it('names an account that matched on a split when the combined name did not', () => {
      const before = project([vrc('Alice', 'in-game'), cvrAt('Alicia', 'in-game')], 'Zed', 'ali')
      const after = project([vrc('Alice', 'active'), cvrAt('Alicia', 'in-game')], 'Zed', 'ali')
      expect(held(before, after, 'Zed', 'ali')).toMatchObject({ name: 'Zed', matchedName: 'Alice' })
    })

    it('shows no other name when the held row’s own name matches', () => {
      const split = [vrc('Bob', 'active'), cvrAt('Carla', 'in-game')]
      expect(
        held(
          project([vrc('Bob', 'in-game'), cvrAt('Carla', 'in-game')], 'Alice', 'a'),
          project(split, 'Alice', 'a'),
          'Alice',
          'a'
        )?.matchedName
      ).toBeUndefined()
      const merged = [vrc('Alice', 'in-game'), cvrAt('Alicia', 'in-game')]
      expect(
        held(
          project([vrc('Alice', 'active'), cvrAt('Alicia', 'in-game')], 'Zed', 'ali'),
          project(merged, 'Zed', 'ali'),
          'Alicia',
          'ali'
        )?.matchedName
      ).toBeUndefined()
    })

    it('follows a new search while the row is held', () => {
      const friends = [vrc('Bob', 'in-game'), cvrAt('Carl', 'in-game')]
      const before = project([vrc('Bob', 'active'), cvrAt('Carl', 'in-game')], 'Alice', 'ali')
      const key = before.find((row) => row.name === 'Bob')?.key ?? null
      const hook = renderHook(({ rows, search }) => useStableLinkedRows(rows, key, search), {
        initialProps: { rows: before, search: 'ali' }
      })
      hook.rerender({ rows: project(friends, 'Alice', 'ali'), search: 'ali' })
      hook.rerender({ rows: project(friends, 'Alice', 'car'), search: 'car' })
      expect(hook.result.current.find((row) => row.key === key)?.matchedName).toBe('Carl')
      // The rows stay the same while only the text changes: still asked again.
      hook.rerender({ rows: project(friends, 'Alice', 'car'), search: 'bo' })
      expect(hook.result.current.find((row) => row.key === key)?.matchedName).toBeUndefined()
    })
  })

  it('passes through unchanged mixed rows with live payloads without hiding the sibling', () => {
    const cvrRow: LinkedRow = {
      ...accountRow({ key: 'person:one:chilloutvr:cvr-friend', name: cvr.displayName }, cvr),
      target: {
        kind: 'account',
        account: { platform: 'chilloutvr', friendId: 'cvr-friend' },
        personId: 'one'
      },
      platformMark: 'chilloutvr'
    }
    const initial = [accountRow({ section: 'in-game' }, vrcOld), cvrRow]
    const updated = [
      accountRow({ accounts: [vrcNew], name: vrcNew.displayName, section: 'in-game' }, vrcNew),
      cvrRow
    ]
    const heldKey = initial[0]?.key ?? null
    const hook = renderHook(({ rows }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial }
    })

    hook.rerender({ rows: updated })
    expect(hook.result.current).toBe(updated)
    expect(hook.result.current).toHaveLength(2)
  })

  it('holds a same-shape row in its old global slot when another row moves above it', () => {
    const held = accountRow()
    const other = {
      ...accountRow({ key: 'account:other', personKey: 'account:other', name: 'Other' }),
      accounts: [friend('vrchat', 'other-friend', 'Other', 'active')],
      target: {
        kind: 'account' as const,
        account: { platform: 'vrchat' as const, friendId: 'other-friend' },
        personId: null
      }
    }
    const initial = [other, held]
    const moved = [held, other]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: held.key }
    })

    hook.rerender({ rows: moved, heldKey: held.key })
    expect(hook.result.current.map((row) => row.key)).toEqual([other.key, held.key])
  })

  it('retains the current mixed sibling when only the held account moves slots', () => {
    const held = accountRow()
    const sibling: LinkedRow = {
      ...accountRow({ key: 'person:one:chilloutvr:cvr-friend', name: cvr.displayName }, cvr),
      target: {
        kind: 'account',
        account: { platform: 'chilloutvr', friendId: 'cvr-friend' },
        personId: 'one'
      },
      platformMark: 'chilloutvr'
    }
    const other = {
      ...accountRow({ key: 'account:other', personKey: 'account:other' }),
      accounts: [friend('vrchat', 'other', 'Other', 'active')],
      target: {
        kind: 'account' as const,
        account: { platform: 'vrchat' as const, friendId: 'other' },
        personId: null
      }
    }
    const initial = [other, held, sibling]
    const moved = [held, sibling, other]
    const hook = renderHook(({ rows }) => useStableLinkedRows(rows, held.key), {
      initialProps: { rows: initial }
    })

    hook.rerender({ rows: moved })
    expect(hook.result.current.map((row) => row.key)).toEqual([sibling.key, held.key, other.key])
    expect(hook.result.current.filter((row) => row.personKey === 'person:one')).toHaveLength(2)
  })

  it('keeps a removed held account structurally but clears unsafe payloads', () => {
    const initial = [accountRow()]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: [], heldKey: initial[0]?.key ?? null })
    expect(hook.result.current).toEqual([
      expect.objectContaining({
        key: initial[0]?.key,
        target: initial[0]?.target,
        accounts: [],
        name: ''
      })
    ])
  })

  it('releases at the first five-second deadline despite further updates', async () => {
    vi.useFakeTimers()
    const initial = [accountRow()]
    const moved = [accountRow({ accounts: [vrcNew], name: 'first', section: 'in-game' }, vrcNew)]
    const later = [accountRow({ accounts: [vrcNew], name: 'later', section: 'offline' }, vrcNew)]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: moved, heldKey: initial[0]?.key ?? null })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    hook.rerender({ rows: later, heldKey: initial[0]?.key ?? null })
    expect(hook.result.current[0]?.section).toBe('online')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(hook.result.current[0]?.section).toBe('online')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(hook.result.current).toBe(later)
  })

  it('releases immediately when the driver clears or changes the held identity', () => {
    const initial = [accountRow()]
    const moved = [
      accountRow({ accounts: [vrcNew], name: vrcNew.displayName, section: 'in-game' }, vrcNew)
    ]
    const hook = renderHook(({ rows, heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { rows: initial, heldKey: initial[0]?.key ?? null }
    })

    hook.rerender({ rows: moved, heldKey: initial[0]?.key ?? null })
    expect(hook.result.current[0]?.section).toBe('online')
    hook.rerender({ rows: moved, heldKey: null })
    expect(hook.result.current).toBe(moved)
    hook.rerender({ rows: initial, heldKey: 'another-row' })
    expect(hook.result.current).toBe(initial)
  })

  it('returns the exact input reference for unchanged rows without scheduling a render loop', () => {
    const rows = [accountRow()]
    const hook = renderHook(({ heldKey }) => useStableLinkedRows(rows, heldKey), {
      initialProps: { heldKey: null as string | null }
    })

    expect(hook.result.current).toBe(rows)
    hook.rerender({ heldKey: rows[0]?.key ?? null })
    expect(hook.result.current).toBe(rows)
  })
})
