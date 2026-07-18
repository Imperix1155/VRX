import { useCallback, useEffect, useRef, useState } from 'react'
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
  queued: string | null
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

function initialState(key: string, nextSeq = 1): NoteState {
  return {
    key,
    loaded: null,
    draft: '',
    revision: null,
    dirty: false,
    pending: null,
    queued: null,
    nextSeq
  }
}

/** Load and edit a per-account, per-friend private note through the preload bridge. */
export function useFriendNote({ platform, friendId }: UseFriendNoteOptions): UseFriendNoteResult {
  const key = `${platform}:${friendId}`
  const [state, setState] = useState<NoteState>(() => initialState(key))
  const [boundaryEpoch, setBoundaryEpoch] = useState(0)
  // Render-synced mirror so async completion callbacks can read the CURRENT
  // state when draining the queued save (no effect, no stale closure).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  // Reset local state when the target friend changes. Done during render so the
  // effect body can stay free of synchronous setState calls. The sequence
  // counter is carried forward so an old in-flight completion can never match a
  // new pending save after a fast switch.
  if (state.key !== key) {
    setState(initialState(key, state.nextSeq))
  }

  // Clear all note state when the platform's account identity changes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.vrx?.onIdentityBoundary !== 'function') {
      return
    }
    return window.vrx.onIdentityBoundary(({ platform: boundaryPlatform }) => {
      if (boundaryPlatform !== platform) return
      setBoundaryEpoch((e) => e + 1)
      setState((current) => initialState(current.key, current.nextSeq))
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

  // Drain any save that was queued while another save was in flight. Runs from
  // the completion callbacks (never an effect — a synchronous setState in an
  // effect body cascades renders, and the lint rule rightly refuses it): after
  // the active request settles we re-read the CURRENT state on a microtask via
  // render-synced refs, then either drop a no-op queue or submit it. The
  // commitSave ref keeps the drain pointing at the CURRENT friend's saver even
  // when a stale completion from a previous friend triggers it.
  const commitSaveRef = useRef<(draft: string) => void>(() => {})
  const drainQueuedSoon = useCallback((): void => {
    // Macrotask, not microtask: React batches promise-callback setStates and
    // may not have committed the settled state (pending→null) by microtask
    // time — the drain would read a stale ref and give up. A 0ms timeout runs
    // after commit + the ref-sync effect.
    window.setTimeout(() => {
      const current = stateRef.current
      if (current.queued === null || current.pending !== null || current.revision === null) return
      if (current.queued.trimEnd() === (current.loaded ?? '').trimEnd()) {
        setState((inner) => (inner.queued === null ? inner : { ...inner, queued: null }))
        return
      }
      commitSaveRef.current(current.queued)
    }, 0)
  }, [])

  const commitSave = useCallback(
    (draft: string): void => {
      setState((current) => {
        if (current.revision === null || current.pending !== null) return current
        const seq = current.nextSeq
        const epoch = boundaryEpoch
        const revision = current.revision
        const saveKey = current.key

        window.vrx
          .setFriendNote({ platform, friendId, note: draft, revision })
          .then((res) => {
            setState((inner) => {
              // Key/epoch/sequence match every completion to the request that
              // spawned it; boundary crossings or friend switches must not
              // apply stale responses.
              if (inner.pending?.seq !== seq || boundaryEpoch !== epoch || inner.key !== saveKey) {
                return inner
              }
              if (!res.ok) {
                return { ...inner, pending: null }
              }
              const loaded = inner.pending.draft
              const dirty = inner.draft.trimEnd() !== loaded.trimEnd()
              return { ...inner, loaded, dirty, pending: null }
            })
            drainQueuedSoon()
          })
          .catch(() => {
            setState((inner) => (inner.pending?.seq === seq ? { ...inner, pending: null } : inner))
            drainQueuedSoon()
          })

        return {
          ...current,
          pending: { seq, key: saveKey, revision, draft },
          queued: null,
          nextSeq: seq + 1
        }
      })
    },
    [platform, friendId, boundaryEpoch, drainQueuedSoon]
  )
  useEffect(() => {
    commitSaveRef.current = commitSave
  })

  const onBlur = useCallback(() => {
    const trimmed = state.draft.trimEnd()
    if (trimmed === (state.loaded ?? '').trimEnd()) return
    if (state.revision === null) return
    if (typeof window === 'undefined' || typeof window.vrx?.setFriendNote !== 'function') return

    if (state.pending !== null) {
      setState((current) => ({ ...current, queued: current.draft }))
      return
    }

    commitSave(state.draft)
  }, [state.draft, state.loaded, state.revision, state.pending, commitSave])

  const setValue = useCallback((value: string) => {
    setState((current) => {
      const draft = value.slice(0, MAX_NOTE_LENGTH)
      const dirty = draft.trimEnd() !== (current.loaded ?? '').trimEnd()
      return { ...current, draft, dirty }
    })
  }, [])

  return { value: state.draft, setValue, onBlur }
}
