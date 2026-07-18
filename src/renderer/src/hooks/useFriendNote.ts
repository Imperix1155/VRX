import { useCallback, useEffect, useState } from 'react'
import type { Platform } from '@shared/types'

const MAX_NOTE_LENGTH = 500

interface NoteRevision {
  platformAccountId: string
  epoch: number
}

interface PendingSave {
  seq: number
  key: string
  revision: NoteRevision
  draft: string
}

interface NoteState {
  key: string
  loaded: string | null
  draft: string
  revision: NoteRevision | null
  dirty: boolean
  pending: PendingSave | null
  nextSeq: number
}

export interface UseFriendNoteOptions {
  platform: Platform
  friendId: string
}

export interface UseFriendNoteResult {
  value: string
  setValue: (value: string) => void
  onBlur: () => void
}

function initialState(key: string): NoteState {
  return { key, loaded: null, draft: '', revision: null, dirty: false, pending: null, nextSeq: 1 }
}

/** Load and edit a per-account, per-friend private note through the preload bridge. */
export function useFriendNote({ platform, friendId }: UseFriendNoteOptions): UseFriendNoteResult {
  const key = `${platform}:${friendId}`
  const [state, setState] = useState<NoteState>(() => initialState(key))
  const [boundaryEpoch, setBoundaryEpoch] = useState(0)

  // Reset local state when the target friend changes. Done during render so the
  // effect body can stay free of synchronous setState calls.
  if (state.key !== key) {
    setState(initialState(key))
  }

  // Clear all note state when the platform's account identity changes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.vrx?.onIdentityBoundary !== 'function') {
      return
    }
    return window.vrx.onIdentityBoundary(({ platform: boundaryPlatform }) => {
      if (boundaryPlatform !== platform) return
      setBoundaryEpoch((e) => e + 1)
      setState((current) => initialState(current.key))
    })
  }, [platform])

  // Load the saved note for the current friend/account.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.vrx?.getFriendNote !== 'function') return

    let active = true
    const epoch = boundaryEpoch
    window.vrx
      .getFriendNote({ platform, friendId })
      .then((res) => {
        if (!active || boundaryEpoch !== epoch) return
        setState((current) => {
          if (current.key !== key) return current
          const revision = res?.revision ?? null
          if (current.dirty) {
            // Don't clobber a draft the user is editing, but capture the lease
            // so a subsequent save can still prove it belongs to this account.
            return { ...current, revision }
          }
          const note = res?.note ?? null
          return { ...current, loaded: note, draft: note ?? '', revision, dirty: false }
        })
      })
      .catch(() => {
        // Quiet failure: keep empty read-only draft until the bridge recovers.
      })

    return () => {
      active = false
    }
  }, [platform, friendId, boundaryEpoch, key])

  const onBlur = useCallback(() => {
    const revision = state.revision
    if (revision === null) return
    if (state.pending !== null) return

    const trimmed = state.draft.trimEnd()
    if (trimmed === (state.loaded ?? '').trimEnd()) return
    if (typeof window === 'undefined' || typeof window.vrx?.setFriendNote !== 'function') return

    const seq = state.nextSeq
    const epoch = boundaryEpoch
    const payload = state.draft
    setState((current) => ({
      ...current,
      pending: { seq, key: current.key, revision, draft: payload },
      nextSeq: seq + 1
    }))

    window.vrx
      .setFriendNote({ platform, friendId, note: payload, revision })
      .then((res) => {
        setState((current) => {
          // Key/revision/sequence match every completion to the request that
          // spawned it; boundary crossings or friend switches must not apply
          // stale responses.
          if (current.pending?.seq !== seq || boundaryEpoch !== epoch || current.key !== key) {
            return current
          }
          if (!res.ok) {
            return { ...current, pending: null }
          }
          const loaded = current.pending.draft
          const dirty = current.draft.trimEnd() !== loaded.trimEnd()
          return { ...current, loaded, dirty, pending: null }
        })
      })
      .catch(() => {
        setState((current) =>
          current.pending?.seq === seq ? { ...current, pending: null } : current
        )
      })
  }, [
    state.draft,
    state.loaded,
    state.revision,
    state.pending,
    state.nextSeq,
    boundaryEpoch,
    platform,
    friendId,
    key
  ])

  const setValue = useCallback((value: string) => {
    setState((current) => {
      const draft = value.slice(0, MAX_NOTE_LENGTH)
      const dirty = draft.trimEnd() !== (current.loaded ?? '').trimEnd()
      return { ...current, draft, dirty }
    })
  }, [])

  return { value: state.draft, setValue, onBlur }
}
