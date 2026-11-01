import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { AccountNoteSyncMode, AccountNoteSyncResult } from '@shared/accountNotes'
import type { Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import { subscribeFriendNoteSaved, type UseAccountFriendNoteResult } from './useFriendNote'

/** A drawer that stays open this long checks the account copy. Flicking
 *  through friends never sends a read. */
export const ACCOUNT_NOTE_CHECK_DWELL_MS = 700
/** A check older than this runs again when the drawer reopens. */
const CHECK_FRESH_MS = 5 * 60_000

export type AccountNoteView =
  | { kind: 'idle' }
  | { kind: 'working'; mode: AccountNoteSyncMode }
  | { kind: 'saved' }
  | { kind: 'local-only' }
  | { kind: 'too-long' }
  | { kind: 'account-changed'; accountNote: string; localNote: string }
  | { kind: 'conflict'; accountNote: string }
  | { kind: 'failed'; mode: AccountNoteSyncMode }

interface Entry {
  view: AccountNoteView
  at: number
}

interface Target {
  platform: Platform
  friendId: string
  revision: { platformAccountId: string; epoch: number }
}

// Renderer-lifetime only. Keys carry the account and its epoch, so nothing
// here can cross an account boundary.
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let version = 0

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function update(key: string, entry: Entry): void {
  entries.set(key, entry)
  version += 1
  listeners.forEach((listener) => listener())
}
function keyFor({ platform, friendId, revision }: Target): string {
  return `${platform}:${revision.platformAccountId}:${revision.epoch}:${friendId}`
}
function bridge(): NonNullable<Window['vrx']>['syncFriendNote'] | null {
  return typeof window !== 'undefined' && typeof window.vrx?.syncFriendNote === 'function'
    ? window.vrx.syncFriendNote
    : null
}

/**
 * One call to main for one friend. Results land in the shared map, so a call
 * that outlives its drawer (a save flushed by closing it) still shows when the
 * drawer opens again. `adopt` shows the copy main saved after `use-account`.
 */
async function runSync(
  target: Target,
  mode: AccountNoteSyncMode,
  adopt?: (note: string) => void
): Promise<void> {
  const sync = bridge()
  if (sync === null) return
  const key = keyFor(target)
  update(key, { view: { kind: 'working', mode }, at: entries.get(key)?.at ?? 0 })
  let result: AccountNoteSyncResult
  try {
    result = await sync({ ...target, mode })
  } catch {
    result = { ok: false, reason: 'unavailable' }
  }
  const at = performance.now()
  if (!result.ok) {
    // Nothing to say about someone who is no longer a friend, or after an
    // account change; the drawer moves on.
    const quiet = result.reason === 'not-friend' || result.reason === 'stale'
    update(key, { view: quiet ? { kind: 'idle' } : { kind: 'failed', mode }, at })
    return
  }
  if (mode === 'use-account') adopt?.(result.note)
  switch (result.state) {
    case 'off':
      update(key, { view: { kind: 'idle' }, at })
      return
    case 'account-changed':
      update(key, {
        view: { kind: 'account-changed', accountNote: result.accountNote, localNote: result.note },
        at
      })
      return
    case 'conflict':
      update(key, { view: { kind: 'conflict', accountNote: result.accountNote }, at })
      return
    default:
      update(key, { view: { kind: result.state }, at })
  }
}

// Every saved edit goes to the account, including one flushed as its drawer
// closes or moves to another friend.
subscribeFriendNoteSaved(({ platform, friendId, revision }) => {
  if (!useSettingsStore.getState().settings.saveNotesToAccounts) return
  void runSync({ platform, friendId, revision }, 'save')
})

/** Test-only cleanup. */
export function resetAccountNotesForTests(): void {
  entries.clear()
  version += 1
}

export interface UseAccountNoteResult {
  view: AccountNoteView
  saveNow: () => void
  keepMine: () => void
  useAccountCopy: () => void
  retry: () => void
}

/**
 * Keeps one friend's note in step with the copy on the signed-in account.
 * Checks after the drawer has been open a moment, takes the account copy on
 * its own only when VRX's copy did not change, and otherwise leaves the
 * choice to the user. Saves after an edit run from the module listener above.
 */
export function useAccountNote(
  platform: Platform,
  friendId: string,
  note: UseAccountFriendNoteResult
): UseAccountNoteResult {
  const enabled = useSettingsStore((s) => s.settings.saveNotesToAccounts)
  const { persisted, isEditing, adoptPersisted } = note
  const active = enabled && bridge() !== null && friendId !== '' && persisted !== null
  const revision = persisted?.revision
  const target: Target | null =
    active && revision !== undefined ? { platform, friendId, revision } : null
  const key = target === null ? null : keyFor(target)
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  )
  const entry = key === null ? undefined : entries.get(key)

  const run = useCallback(
    (mode: AccountNoteSyncMode): void => {
      if (key === null || revision === undefined) return
      void runSync({ platform, friendId, revision }, mode, adoptPersisted)
    },
    [adoptPersisted, friendId, key, platform, revision]
  )

  // The first look once the drawer stays open, and again after 5 minutes.
  useEffect(() => {
    if (key === null) return
    const current = entries.get(key)
    if (current !== undefined && current.at > 0 && performance.now() - current.at < CHECK_FRESH_MS)
      return
    if (current?.view.kind === 'working') return
    const timer = setTimeout(() => {
      if (entries.get(key)?.view.kind === 'working') return
      run('check')
    }, ACCOUNT_NOTE_CHECK_DWELL_MS)
    return () => clearTimeout(timer)
  }, [key, run])

  // Only the account copy changed: take it, unless the user is typing or VRX's
  // copy changed since main compared them (then the save that follows decides).
  useEffect(() => {
    if (key === null || persisted === null || isEditing) return
    const current = entries.get(key)?.view
    if (current?.kind !== 'account-changed') return
    if (current.localNote.trimEnd() !== persisted.note.trimEnd()) return
    run('use-account')
  }, [entry, isEditing, key, persisted, run])

  const view: AccountNoteView = key === null ? { kind: 'idle' } : (entry?.view ?? { kind: 'idle' })
  const lastMode = view.kind === 'failed' ? view.mode : 'check'
  return {
    view,
    saveNow: useCallback(() => run('save'), [run]),
    keepMine: useCallback(() => run('keep-mine'), [run]),
    useAccountCopy: useCallback(() => run('use-account'), [run]),
    retry: useCallback(() => run(lastMode), [lastMode, run])
  }
}
