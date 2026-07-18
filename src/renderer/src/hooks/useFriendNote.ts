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

  // A queued save drains from INSIDE the settle updaters below. React applies
  // queued updaters in order, so a commitSave scheduled on a microtask from a
  // settle updater always runs against the settled state (pending → null). No
  // timers and no committed-state reads: CI proved every "wait for the commit"
  // variant flaky (macrotask starved on ubuntu, microtask raced the ref sync).
  // The ref keeps the drain pointing at the CURRENT friend's saver.
  const commitSaveRef = useRef<(draft: string) => void>(() => {})

  const commitSave = useCallback(
    (draft: string): void => {
      setState((current) => {
        if (current.revision === null || current.pending !== null) return current
        const seq = current.nextSeq
        const epoch = boundaryEpoch
        const revision = current.revision
        const saveKey = current.key

        // Resolve the queued follow-up draft once this save settles: drop it
        // when it matches what the settle leaves on disk, otherwise resubmit
        // it after this flush. commitSave's pending-guard makes StrictMode's
        // double-invoked updaters harmless — the second submission bails.
        const settleQueued = (inner: NoteState, loadedAfter: string | null): string | null => {
          if (inner.queued === null) return null
          if (inner.queued.trimEnd() === (loadedAfter ?? '').trimEnd()) return null
          const next = inner.queued
          queueMicrotask(() => commitSaveRef.current(next))
          return next
        }

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
                return { ...inner, pending: null, queued: settleQueued(inner, inner.loaded) }
              }
              const loaded = inner.pending.draft
              const dirty = inner.draft.trimEnd() !== loaded.trimEnd()
              return { ...inner, loaded, dirty, pending: null, queued: settleQueued(inner, loaded) }
            })
          })
          .catch(() => {
            setState((inner) =>
              inner.pending?.seq === seq
                ? { ...inner, pending: null, queued: settleQueued(inner, inner.loaded) }
                : inner
            )
          })

        return {
          ...current,
          pending: { seq, key: saveKey, revision, draft },
          queued: null,
          nextSeq: seq + 1
        }
      })
    },
    [platform, friendId, boundaryEpoch]
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
