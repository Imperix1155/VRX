import { useEffect, useState } from 'react'
import type { Friend } from '@shared/types'
import type { LinkedRow, ProfileTarget } from '../utils/projectLinkedFriends'

const MAX_STABLE_LINKED_ROWS_MS = 5_000

interface DeferredRow {
  heldKey: string
  personKey: string
  row: LinkedRow
  index: number
}

interface StableRowsState {
  input: LinkedRow[]
  heldKey: string | null
  displayed: LinkedRow[]
  deferred: DeferredRow | null
  releasedHeldKey: string | null
}

function isSameAccount(
  friend: Friend,
  target: Extract<ProfileTarget, { kind: 'account' }>['account']
): boolean {
  return friend.platform === target.platform && friend.platformUserId === target.friendId
}

function currentFriends(rows: LinkedRow[], deferred: DeferredRow): Friend[] {
  const friends = rows
    .filter((row) => row.personKey === deferred.personKey)
    .flatMap((row) => row.accounts)
  const target = deferred.row.target
  const relevant =
    target.kind === 'account'
      ? friends.filter((friend) => isSameAccount(friend, target.account))
      : friends
  const unique = new Map<string, Friend>()
  for (const friend of relevant)
    unique.set(`${friend.platform}\u0000${friend.platformUserId}`, friend)
  return [...unique.values()]
}

function currentName(rows: LinkedRow[], deferred: DeferredRow, friends: Friend[]): string {
  if (deferred.row.target.kind === 'account') return friends.at(0)?.displayName ?? ''
  const combined = rows.find(
    (row) => row.personKey === deferred.personKey && row.target.kind === 'person'
  )
  return combined?.name ?? deferred.row.name
}

function deferRow(rows: LinkedRow[], deferred: DeferredRow): LinkedRow[] {
  const friends = currentFriends(rows, deferred)
  const retained: LinkedRow = {
    ...deferred.row,
    accounts: friends,
    name: currentName(rows, deferred, friends)
  }
  const heldStillExists = rows.some((row) => row.key === deferred.heldKey)
  const withoutPerson = rows.filter((row) =>
    heldStillExists ? row.key !== deferred.heldKey : row.personKey !== deferred.personKey
  )
  const index = Math.min(deferred.index, withoutPerson.length)
  return [...withoutPerson.slice(0, index), retained, ...withoutPerson.slice(index)]
}

function hasStructuralChange(
  previousRows: LinkedRow[],
  heldKey: string,
  rows: LinkedRow[]
): boolean {
  const previous = previousRows.find((row) => row.key === heldKey)
  if (previous === undefined) return false
  const previousPersonRows = previousRows.filter((row) => row.personKey === previous.personKey)
  const currentPersonRows = rows.filter((row) => row.personKey === previous.personKey)
  if (previousPersonRows.length !== currentPersonRows.length) return true
  if (
    rows.findIndex((row) => row.key === heldKey) !==
    previousRows.findIndex((row) => row.key === heldKey)
  ) {
    return true
  }
  return previousPersonRows.some((row, index) => {
    const current = currentPersonRows[index]
    return current === undefined || current.key !== row.key || current.section !== row.section
  })
}

function nextState(
  current: StableRowsState,
  rows: LinkedRow[],
  heldKey: string | null
): StableRowsState {
  if (current.input === rows && current.heldKey === heldKey) return current
  if (heldKey !== current.heldKey) {
    return { input: rows, heldKey, displayed: rows, deferred: null, releasedHeldKey: null }
  }
  if (heldKey === null || current.releasedHeldKey === heldKey) {
    return { ...current, input: rows, displayed: rows, deferred: null }
  }
  // Unlink/replacement changes identity, not placement. Never retain the old
  // person beside accounts now owned by a different projection identity.
  const oldRow = current.deferred?.row ?? current.displayed.find((row) => row.key === heldKey)
  if (
    oldRow &&
    rows.some(
      (row) =>
        row.personKey !== oldRow.personKey &&
        row.accounts.some((account) =>
          oldRow.accounts.some(
            (old) =>
              old.platform === account.platform && old.platformUserId === account.platformUserId
          )
        )
    )
  ) {
    return { input: rows, heldKey, displayed: rows, deferred: null, releasedHeldKey: heldKey }
  }
  if (current.deferred !== null) {
    return { ...current, input: rows, displayed: deferRow(rows, current.deferred) }
  }

  const previous = current.displayed.find((row) => row.key === heldKey)
  if (previous === undefined || !hasStructuralChange(current.displayed, heldKey, rows)) {
    return { ...current, input: rows, displayed: rows }
  }
  const deferred: DeferredRow = {
    heldKey,
    personKey: previous.personKey,
    row: previous,
    index: current.displayed.findIndex((row) => row.key === heldKey)
  }
  return { ...current, input: rows, displayed: deferRow(rows, deferred), deferred }
}

/**
 * Holds exactly one interacted linked row in its old placement while current
 * friend payloads continue to flow through it. The caller owns hover/focus
 * identity and clears it for account/session boundaries.
 */
export function useStableLinkedRows(rows: LinkedRow[], heldKey: string | null): LinkedRow[] {
  const [state, setState] = useState<StableRowsState>(() => ({
    input: rows,
    heldKey,
    displayed: rows,
    deferred: null,
    releasedHeldKey: null
  }))

  let displayed = state.displayed
  // Query combiners may allocate an equivalent array during this render.
  // Do not schedule render-phase state updates for reference-only changes.
  const equivalent =
    state.input === rows ||
    (state.input.length === rows.length &&
      state.input.every((row, index) => {
        const next = rows[index]!
        return (
          row.key === next.key &&
          row.name === next.name &&
          row.section === next.section &&
          row.platformMark === next.platformMark &&
          row.personKey === next.personKey &&
          JSON.stringify(row.target) === JSON.stringify(next.target) &&
          row.accounts.length === next.accounts.length &&
          row.accounts.every((account, i) => account === next.accounts[i])
        )
      }))
  if ((heldKey !== null && !equivalent) || state.heldKey !== heldKey) {
    const next = nextState(state, rows, heldKey)
    setState(next)
    displayed = next.displayed
  }

  useEffect(() => {
    const deferred = state.deferred
    if (deferred === null) return
    const timeout = window.setTimeout(() => {
      setState((current) => {
        if (current.deferred !== deferred) return current
        return {
          ...current,
          displayed: current.input,
          deferred: null,
          releasedHeldKey: deferred.heldKey
        }
      })
    }, MAX_STABLE_LINKED_ROWS_MS)
    return () => window.clearTimeout(timeout)
  }, [state.deferred])

  return heldKey === null ? rows : displayed
}
