import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientContext, useMutation, useQuery } from '@tanstack/react-query'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'

const MAX_NOTE_LENGTH = 500

type NoteData = IpcInvoke['get-friend-note']['res']
type SaveResult = IpcInvoke['set-friend-note']['res']

interface DraftState {
  key: string
  value: string
  dirty: boolean
}

interface SaveVariables {
  key: string
  epoch: number
  platform: Platform
  friendId: string
  note: string
}

interface SaveState {
  saving: boolean
  queued: string | null
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

function sameNote(left: string, right: string | null | undefined): boolean {
  return left.trimEnd() === (right ?? '').trimEnd()
}

function emptyDraft(key: string): DraftState {
  return { key, value: '', dirty: false }
}

/** Load and edit a per-account, per-friend private note through the preload bridge. */
export function useFriendNote({ platform, friendId }: UseFriendNoteOptions): UseFriendNoteResult {
  const providedClient = useContext(QueryClientContext)
  const [fallbackClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  )
  const queryClient = providedClient ?? fallbackClient
  const [boundaryEpoch, setBoundaryEpoch] = useState(0)
  const key = `${platform}:${friendId}:${boundaryEpoch}`
  const queryKey =
    friendId === ''
      ? (['friend-note-disabled'] as const)
      : (['friend-note', platform, friendId, boundaryEpoch] as const)
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(key))
  const saveStatesRef = useRef(new Map<string, SaveState>())

  const getFriendNote =
    typeof window !== 'undefined' && typeof window.vrx?.getFriendNote === 'function'
      ? window.vrx.getFriendNote
      : null
  const setFriendNote =
    typeof window !== 'undefined' && typeof window.vrx?.setFriendNote === 'function'
      ? window.vrx.setFriendNote
      : null
  const query = useQuery(
    {
      queryKey,
      queryFn: () => {
        if (getFriendNote === null) throw new Error('bridge_unavailable')
        return getFriendNote({ platform, friendId })
      },
      staleTime: Infinity,
      enabled: getFriendNote !== null && friendId !== ''
    },
    queryClient
  )

  if (draft.key !== key) {
    setDraft(emptyDraft(key))
  } else if (query.data !== undefined) {
    const differs = !sameNote(draft.value, query.data.note)
    if (!draft.dirty && differs) {
      setDraft({ ...draft, value: query.data.note ?? '' })
    } else if (draft.dirty && !differs) {
      setDraft({ ...draft, dirty: false })
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.vrx?.onIdentityBoundary !== 'function') {
      return
    }
    return window.vrx.onIdentityBoundary(({ platform: boundaryPlatform }) => {
      if (boundaryPlatform === platform) setBoundaryEpoch((epoch) => epoch + 1)
    })
  }, [platform])

  const { mutate } = useMutation(
    {
      mutationFn: async (save: SaveVariables) => {
        const saveQueryKey = ['friend-note', save.platform, save.friendId, save.epoch] as const
        const saveState = saveStatesRef.current.get(save.key)
        if (saveState === undefined) return
        let note: string | null = save.note
        try {
          while (note !== null) {
            const revision = queryClient.getQueryData<NoteData>(saveQueryKey)?.revision
            if (revision === undefined) return
            let result: SaveResult | undefined
            try {
              if (setFriendNote === null) return
              result = await setFriendNote({
                platform: save.platform,
                friendId: save.friendId,
                note,
                revision
              })
            } catch {
              // Quiet failure: keep the draft dirty so the next blur retries.
            }
            const currentRevision = queryClient.getQueryData<NoteData>(saveQueryKey)?.revision
            if (
              currentRevision?.platformAccountId !== revision.platformAccountId ||
              currentRevision?.epoch !== revision.epoch
            ) {
              return
            }
            if (result?.ok) {
              queryClient.setQueryData(saveQueryKey, { note, revision })
            } else if (result?.reason === 'stale') {
              await queryClient.refetchQueries({ queryKey: saveQueryKey, exact: true })
            }
            const queued = saveState.queued
            saveState.queued = null
            const persisted = queryClient.getQueryData<NoteData>(saveQueryKey)?.note
            note = queued !== null && !sameNote(queued, persisted) ? queued : null
          }
        } finally {
          saveState.saving = false
          if (saveStatesRef.current.get(save.key) === saveState) {
            saveStatesRef.current.delete(save.key)
          }
        }
      }
    },
    queryClient
  )

  const onBlur = useCallback(() => {
    if (!draft.dirty || query.data?.revision === undefined || setFriendNote === null) {
      return
    }
    const saveState = saveStatesRef.current.get(key)
    if (saveState?.saving) {
      saveState.queued = draft.value
      return
    }
    saveStatesRef.current.set(key, { saving: true, queued: null })
    mutate({
      key,
      epoch: boundaryEpoch,
      platform,
      friendId,
      note: draft.value
    })
  }, [boundaryEpoch, draft, friendId, key, mutate, platform, query.data?.revision, setFriendNote])

  const setValue = useCallback(
    (value: string) => {
      setDraft((current) => {
        const next = value.slice(0, MAX_NOTE_LENGTH)
        return { ...current, value: next, dirty: !sameNote(next, query.data?.note) }
      })
    },
    [query.data?.note]
  )

  return { value: draft.value, setValue, onBlur }
}
