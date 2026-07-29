import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { QueryClient, QueryClientContext, useMutation, useQuery } from '@tanstack/react-query'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'

const MAX_NOTE_LENGTH = 500

type NoteData = IpcInvoke['get-friend-note']['res']
type SaveResult = IpcInvoke['set-friend-note']['res']

interface DraftState {
  key: string
  generation: number
  value: string
  dirty: boolean
}

interface SaveVariables {
  generation: number
  epoch: number
  platform: Platform
  friendId: string
  note: string
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

function emptyDraft(key: string, generation = 0): DraftState {
  return { key, generation, value: '', dirty: false }
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
  const queryKey = ['friend-note', platform, friendId, boundaryEpoch] as const
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(key))
  const generationRef = useRef(0)
  const savingRef = useRef(false)
  const queuedRef = useRef<string | null>(null)

  const bridgeCanRead =
    typeof window !== 'undefined' && typeof window.vrx?.getFriendNote === 'function'
  const query = useQuery(
    {
      queryKey,
      queryFn: () => window.vrx.getFriendNote({ platform, friendId }),
      staleTime: Infinity,
      enabled: bridgeCanRead
    },
    queryClient
  )

  if (draft.key !== key) {
    setDraft(emptyDraft(key, draft.generation + 1))
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

  useEffect(() => {
    generationRef.current = draft.generation
    savingRef.current = false
    queuedRef.current = null
  }, [draft.generation])

  const { mutate } = useMutation(
    {
      mutationFn: async (save: SaveVariables) => {
        const saveQueryKey = ['friend-note', save.platform, save.friendId, save.epoch] as const
        let note: string | null = save.note
        try {
          while (note !== null) {
            const revision = queryClient.getQueryData<NoteData>(saveQueryKey)?.revision
            if (revision === undefined) return
            let result: SaveResult | undefined
            try {
              result = await window.vrx.setFriendNote({
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
              generationRef.current !== save.generation ||
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
            const queued = queuedRef.current
            queuedRef.current = null
            const persisted = queryClient.getQueryData<NoteData>(saveQueryKey)?.note
            note = queued !== null && !sameNote(queued, persisted) ? queued : null
          }
        } finally {
          if (generationRef.current === save.generation) savingRef.current = false
        }
      }
    },
    queryClient
  )

  const onBlur = useCallback(() => {
    if (
      !draft.dirty ||
      query.data?.revision === undefined ||
      typeof window === 'undefined' ||
      typeof window.vrx?.setFriendNote !== 'function'
    ) {
      return
    }
    if (savingRef.current) {
      queuedRef.current = draft.value
      return
    }
    savingRef.current = true
    queuedRef.current = null
    mutate({
      generation: generationRef.current,
      epoch: boundaryEpoch,
      platform,
      friendId,
      note: draft.value
    })
  }, [boundaryEpoch, draft, friendId, mutate, platform, query.data?.revision])

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
