import { useCallback, useEffect, useState } from 'react'
import type { Platform } from '@shared/types'

const MAX_NOTE_LENGTH = 500

interface NoteState {
  key: string
  loaded: string | null
  draft: string
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

/** Load and edit a per-account, per-friend private note through the preload bridge. */
export function useFriendNote({ platform, friendId }: UseFriendNoteOptions): UseFriendNoteResult {
  const key = `${platform}:${friendId}`
  const [state, setState] = useState<NoteState>({ key, loaded: null, draft: '' })

  // Reset local state when the target friend changes. Done during render so the
  // effect body can stay free of synchronous setState calls.
  if (state.key !== key) {
    setState({ key, loaded: null, draft: '' })
  }

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.vrx?.getFriendNote !== 'function') return

    let active = true
    window.vrx
      .getFriendNote({ platform, friendId })
      .then((res) => {
        if (!active) return
        const note = res?.note ?? null
        setState((current) => ({ ...current, loaded: note, draft: note ?? '' }))
      })
      .catch(() => {
        // Quiet failure: keep empty read-only draft until the bridge recovers.
      })

    return () => {
      active = false
    }
  }, [platform, friendId])

  const onBlur = useCallback(() => {
    const trimmed = state.draft.trimEnd()
    if (trimmed === (state.loaded ?? '').trimEnd()) return
    if (typeof window === 'undefined' || typeof window.vrx?.setFriendNote !== 'function') return

    window.vrx
      .setFriendNote({ platform, friendId, note: state.draft })
      .then((res) => {
        if (res.ok) {
          setState((current) => ({ ...current, loaded: current.draft }))
        }
        // On failure the draft stays editable and the next blur retries.
      })
      .catch(() => {
        // Quiet failure.
      })
  }, [state.draft, state.loaded, platform, friendId])

  const setValue = useCallback((value: string) => {
    setState((current) => ({ ...current, draft: value.slice(0, MAX_NOTE_LENGTH) }))
  }, [])

  return { value: state.draft, setValue, onBlur }
}
