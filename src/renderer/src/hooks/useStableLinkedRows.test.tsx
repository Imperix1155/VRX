// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import type { LinkedRow } from '../utils/projectLinkedFriends'
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
