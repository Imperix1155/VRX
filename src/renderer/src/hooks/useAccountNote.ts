import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { AccountNoteSyncMode, AccountNoteSyncResult } from '@shared/accountNotes'
import type { Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import type { UseAccountFriendNoteResult } from './useFriendNote'

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
  /** VRX's saved copy as this entry last saw it; a different one is an edit. */
  seenNote: string | null
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
function update(key: string, change: Partial<Entry>): void {
  const current = entries.get(key) ?? { view: { kind: 'idle' }, at: 0, seenNote: null }
  entries.set(key, { ...current, ...change })
  version += 1
  listeners.forEach((listener) => listener())
}

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
 * Checks after the drawer has been open a moment, saves after each saved edit,
 * takes the account copy on its own only when VRX's copy did not change, and
 * otherwise leaves the choice to the user.
 */
export function useAccountNote(
  platform: Platform,
  friendId: string,
  note: UseAccountFriendNoteResult
): UseAccountNoteResult {
  const enabled = useSettingsStore((s) => s.settings.saveNotesToAccounts)
  const { persisted, isEditing, adoptPersisted } = note
  const sync =
    typeof window !== 'undefined' && typeof window.vrx?.syncFriendNote === 'function'
      ? window.vrx.syncFriendNote
      : null
  const active = enabled && sync !== null && friendId !== '' && persisted !== null
  const key = active
    ? `${platform}:${persisted.revision.platformAccountId}:${persisted.revision.epoch}:${friendId}`
    : null
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  )
  const entry = key === null ? undefined : entries.get(key)

  const run = useCallback(
    async (mode: AccountNoteSyncMode): Promise<void> => {
      if (key === null || sync === null || persisted === null) return
      update(key, { view: { kind: 'working', mode } })
      let result: AccountNoteSyncResult
      try {
        result = await sync({ platform, friendId, revision: persisted.revision, mode })
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
      const seenNote = entries.get(key)?.seenNote ?? persisted.note
      if (result.note.trimEnd() !== seenNote.trimEnd()) {
        // Main saved the account copy as VRX's copy; show it without counting
        // it as an edit.
        update(key, { seenNote: result.note })
        adoptPersisted(result.note)
      }
      switch (result.state) {
        case 'off':
          update(key, { view: { kind: 'idle' }, at })
          return
        case 'account-changed':
          update(key, {
            view: {
              kind: 'account-changed',
              accountNote: result.accountNote,
              localNote: result.note
            },
            at
          })
          return
        case 'conflict':
          update(key, { view: { kind: 'conflict', accountNote: result.accountNote }, at })
          return
        default:
          update(key, { view: { kind: result.state }, at })
      }
    },
    [adoptPersisted, friendId, key, persisted, platform, sync]
  )

  // A saved edit: VRX's copy changed under the same key.
  useEffect(() => {
    if (key === null || persisted === null) return
    const current = entries.get(key)
    if (current === undefined || current.seenNote === null) {
      update(key, { seenNote: persisted.note })
      return
    }
    if (current.seenNote.trimEnd() === persisted.note.trimEnd()) return
    update(key, { seenNote: persisted.note })
    void run('save')
  }, [key, persisted, run])

  // The first look once the drawer stays open, and again after 5 minutes.
  useEffect(() => {
    if (key === null) return
    const current = entries.get(key)
    if (current !== undefined && current.at > 0 && performance.now() - current.at < CHECK_FRESH_MS)
      return
    if (current?.view.kind === 'working') return
    const timer = setTimeout(() => {
      const latest = entries.get(key)
      if (latest?.view.kind === 'working') return
      void run('check')
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
    void run('use-account')
  }, [entry, isEditing, key, persisted, run])

  const view: AccountNoteView = key === null ? { kind: 'idle' } : (entry?.view ?? { kind: 'idle' })
  const lastMode = view.kind === 'failed' ? view.mode : 'check'
  return {
    view,
    saveNow: useCallback(() => void run('save'), [run]),
    keepMine: useCallback(() => void run('keep-mine'), [run]),
    useAccountCopy: useCallback(() => void run('use-account'), [run]),
    retry: useCallback(() => void run(lastMode), [lastMode, run])
  }
}
