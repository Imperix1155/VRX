import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { QueryClient, QueryClientContext, useMutation, useQuery } from '@tanstack/react-query'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'

const MAX_NOTE_LENGTH = 500

type NoteData = IpcInvoke['get-friend-note']['res']
type SaveResult = IpcInvoke['set-friend-note']['res']

interface DraftState {
  key: string
  generation: number
  baseline: string
  value: string
  dirty: boolean
  intentVersion: number
  hasLocalIntent: boolean
  platformAccountId: string | null
}

// The drawer is deliberately not the owner of a write. It can unmount while a
// retry is pending (navigation, a different drawer, StrictMode), but that must
// not create a second writer for the same friend or let an old completion win
// over the remounted editor. These are renderer-lifetime only and are cleared
// by the identity-boundary listener below; nothing here is persisted.
interface SaveState {
  saving: boolean
  queued: { generation: number; intentVersion: number; note: string } | null
}

interface FriendNoteCoordinatorHmrData {
  coordinator: FriendNoteCoordinator
}

interface FriendNoteCoordinator {
  saveStates: Map<string, SaveState>
  latestDrafts: Map<string, DraftState>
  boundaryEpochs: Map<Platform, number>
  boundaryListeners: Set<() => void>
  retainedFailedDrafts: ReadonlyMap<string, DraftState>
  failedDraftListeners: Set<() => void>
  nextIntentVersion: number
  removeBoundaryListener: (() => void) | null
}

const hmrData = import.meta.hot?.data as Partial<FriendNoteCoordinatorHmrData> | undefined
const coordinator: FriendNoteCoordinator = hmrData?.coordinator ?? {
  saveStates: new Map<string, SaveState>(),
  latestDrafts: new Map<string, DraftState>(),
  boundaryEpochs: new Map<Platform, number>(),
  boundaryListeners: new Set<() => void>(),
  retainedFailedDrafts: new Map<string, DraftState>(),
  failedDraftListeners: new Set<() => void>(),
  nextIntentVersion: 0,
  removeBoundaryListener: null
}
const saveStates = coordinator.saveStates
const latestDrafts = coordinator.latestDrafts
const boundaryEpochs = coordinator.boundaryEpochs
const boundaryListeners = coordinator.boundaryListeners

function epochFor(platform: Platform): number {
  return boundaryEpochs.get(platform) ?? 0
}
function rememberDraft(key: string, draft: DraftState): void {
  latestDrafts.delete(key)
  if (saveStates.get(key)?.saving) latestDrafts.set(key, draft)
}
function subscribeBoundary(listener: () => void): () => void {
  boundaryListeners.add(listener)
  return () => boundaryListeners.delete(listener)
}
function ensureFriendNoteCoordinator(): void {
  if (coordinator.removeBoundaryListener !== null || typeof window === 'undefined') return
  const subscribe = window.vrx?.onIdentityBoundary
  if (typeof subscribe !== 'function') return
  coordinator.removeBoundaryListener = subscribe(({ platform }) => {
    boundaryEpochs.set(platform, epochFor(platform) + 1)
    // Fence and discard every old-account draft/operation. An already-issued
    // IPC call can settle, but its old key can no longer affect current state.
    for (const key of latestDrafts.keys())
      if (key.startsWith(`${platform}:`)) latestDrafts.delete(key)
    for (const key of saveStates.keys()) if (key.startsWith(`${platform}:`)) saveStates.delete(key)
    updateFailedDrafts((current) => {
      const next = new Map(current)
      for (const key of next.keys()) if (key.startsWith(`${platform}:`)) next.delete(key)
      return next
    })
    boundaryListeners.forEach((listener) => listener())
  })
}

// Renderer-lifetime only: deliberately no disk persistence.  The listener is
// installed once and outlives individual drawers/routes so an off-screen
// identity boundary cannot leave another account's failed draft recoverable.
const failedDraftListeners = coordinator.failedDraftListeners
function subscribeFailedDrafts(listener: () => void): () => void {
  failedDraftListeners.add(listener)
  return () => failedDraftListeners.delete(listener)
}
function notifyFailedDrafts(): void {
  coordinator.failedDraftListeners.forEach((listener) => listener())
}
function updateFailedDrafts(
  updater: (current: ReadonlyMap<string, DraftState>) => ReadonlyMap<string, DraftState>
): void {
  const next = updater(coordinator.retainedFailedDrafts)
  if (next === coordinator.retainedFailedDrafts) return
  coordinator.retainedFailedDrafts = next
  notifyFailedDrafts()
}
/** Test-only cleanup; production retention lasts for the renderer process. */
export function resetFriendNoteFailureStoreForTests(): void {
  coordinator.removeBoundaryListener?.()
  coordinator.removeBoundaryListener = null
  coordinator.retainedFailedDrafts = new Map()
  saveStates.clear()
  latestDrafts.clear()
  boundaryEpochs.clear()
  coordinator.nextIntentVersion = 0
  notifyFailedDrafts()
}

/** Test-only visibility into renderer-lifetime coordinator cleanup. */
export function friendNoteCoordinatorCountsForTests(): {
  writers: number
  drafts: number
  failed: number
} {
  return {
    writers: saveStates.size,
    drafts: latestDrafts.size,
    failed: coordinator.retainedFailedDrafts.size
  }
}

/** Test seam for the Vite dispose lifecycle; does not clear renderer-lifetime state. */
export function disposeFriendNoteCoordinatorForHmrTests(): void {
  coordinator.removeBoundaryListener?.()
  coordinator.removeBoundaryListener = null
}

interface SaveVariables {
  key: string
  generation: number
  intentVersion: number
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
  isWritable: boolean
  setValue: (value: string) => void
  onBlur: () => void
  saveFailed: boolean
  retry: () => void
}

function sameNote(left: string, right: string | null | undefined): boolean {
  return left.trimEnd() === (right ?? '').trimEnd()
}

function emptyDraft(key: string, generation = 0): DraftState {
  return {
    key,
    generation,
    baseline: '',
    value: '',
    dirty: false,
    intentVersion: 0,
    hasLocalIntent: false,
    platformAccountId: null
  }
}

/** Load and edit a per-account, per-friend private note through the preload bridge. */
export function useFriendNote({ platform, friendId }: UseFriendNoteOptions): UseFriendNoteResult {
  const providedClient = useContext(QueryClientContext)
  const [fallbackClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  )
  const queryClient = providedClient ?? fallbackClient
  ensureFriendNoteCoordinator()
  const boundaryEpoch = useSyncExternalStore(
    subscribeBoundary,
    () => epochFor(platform),
    () => 0
  )
  const key = `${platform}:${friendId}:${boundaryEpoch}`
  const queryKey =
    friendId === ''
      ? (['friend-note-disabled'] as const)
      : (['friend-note', platform, friendId, boundaryEpoch] as const)
  const [draft, setDraft] = useState<DraftState>(() => latestDrafts.get(key) ?? emptyDraft(key))
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  // Failed drafts are session-only and fully account scoped.  Keeping this
  // separately from the active draft lets a drawer switch restore an actionable
  // failure without retaining ordinary unsaved edits.
  const failedDrafts = useSyncExternalStore(
    subscribeFailedDrafts,
    () => coordinator.retainedFailedDrafts,
    () => coordinator.retainedFailedDrafts
  )
  const failedDraftKey = (draftKey: string, platformAccountId: string | null): string | null =>
    platformAccountId === null ? null : `${draftKey}:${platformAccountId}`

  const getFriendNote =
    typeof window !== 'undefined' && typeof window.vrx?.getFriendNote === 'function'
      ? window.vrx.getFriendNote
      : null
  const setFriendNote =
    typeof window !== 'undefined' && typeof window.vrx?.setFriendNote === 'function'
      ? window.vrx.setFriendNote
      : null
  const isWritable = getFriendNote !== null && setFriendNote !== null && friendId !== ''
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
    // Ordinary in-place edits are discarded when selection changes, but a
    // submitted draft still owns an active writer and must remain recoverable
    // if that write later rejects. Actual route remounts use the same
    // coordinator-backed behavior through the useState initializer above.
    const pending = saveStates.get(key)?.saving ? latestDrafts.get(key) : undefined
    const next = pending ?? emptyDraft(key, draft.generation + 1)
    rememberDraft(key, next)
    setDraft(next)
  } else if (query.data?.revision !== undefined) {
    const baseline = query.data.note ?? ''
    const accountId = query.data.revision.platformAccountId
    const retained = failedDrafts.get(failedDraftKey(key, accountId) ?? '')
    const accountChanged = draft.platformAccountId !== null && draft.platformAccountId !== accountId
    if (retained !== undefined && !draft.hasLocalIntent && draft.platformAccountId !== accountId) {
      const restored = {
        ...retained,
        key,
        generation: draft.generation,
        platformAccountId: accountId
      }
      setDraft(restored)
      rememberDraft(key, restored)
    } else if (!sameNote(draft.baseline, baseline) || draft.platformAccountId !== accountId) {
      const nextDraft = {
        ...draft,
        baseline,
        value: accountChanged || !draft.hasLocalIntent ? baseline : draft.value,
        dirty: accountChanged
          ? false
          : draft.hasLocalIntent
            ? !sameNote(draft.value, baseline)
            : false,
        hasLocalIntent: accountChanged
          ? false
          : draft.hasLocalIntent && !sameNote(draft.value, baseline),
        platformAccountId: accountId
      }
      setDraft(nextDraft)
      rememberDraft(key, nextDraft)
      if (!nextDraft.dirty) {
        updateFailedDrafts((current) => {
          const failedKey = failedDraftKey(key, accountId)
          if (failedKey === null || !current.has(failedKey)) return current
          const next = new Map(current)
          next.delete(failedKey)
          return next
        })
      }
    }
  }

  const { mutate } = useMutation(
    {
      mutationFn: async (save: SaveVariables) => {
        const saveQueryKey = ['friend-note', save.platform, save.friendId, save.epoch] as const
        const stateKey = save.key
        const saveState = saveStates.get(stateKey)
        if (saveState === undefined) return
        let note: string | null = save.note
        let generation = save.generation
        let intentVersion = save.intentVersion
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
              // Quiet failure: keep the draft dirty for the explicit Retry.
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
              // A late completion may only dismiss feedback when it saved the
              // draft still visible for this friend/account boundary.
              const currentDraft = latestDrafts.get(save.key)
              if (
                currentDraft !== undefined &&
                currentDraft.generation === generation &&
                sameNote(currentDraft.value, note)
              ) {
                updateFailedDrafts((current) => {
                  const failedKey = failedDraftKey(save.key, revision.platformAccountId)
                  if (failedKey === null || !current.has(failedKey)) return current
                  const next = new Map(current)
                  next.delete(failedKey)
                  return next
                })
              }
              if (
                currentDraft !== undefined &&
                currentDraft.generation === generation &&
                currentDraft.intentVersion === intentVersion
              ) {
                const activeDraft =
                  draftRef.current.key === save.key ? draftRef.current : currentDraft
                const nextDraft = {
                  ...currentDraft,
                  baseline: note,
                  dirty:
                    activeDraft.intentVersion === intentVersion
                      ? false
                      : !sameNote(activeDraft.value, note),
                  hasLocalIntent:
                    activeDraft.intentVersion === intentVersion
                      ? false
                      : !sameNote(activeDraft.value, note)
                }
                rememberDraft(save.key, nextDraft)
                if (draftRef.current.key === save.key) {
                  draftRef.current = nextDraft
                  setDraft(nextDraft)
                }
                if (!nextDraft.dirty) latestDrafts.delete(save.key)
              } else if (currentDraft !== undefined && currentDraft.key === save.key) {
                // The request landed, but input changed while it was in
                // flight. Advance only the baseline: this preserves the newer
                // local value while making a deliberate revert savable.
                const nextDraft = {
                  ...currentDraft,
                  baseline: note,
                  dirty: !sameNote(currentDraft.value, note),
                  hasLocalIntent: !sameNote(currentDraft.value, note)
                }
                rememberDraft(save.key, nextDraft)
                if (draftRef.current.key === save.key) {
                  draftRef.current = nextDraft
                  setDraft(nextDraft)
                }
                if (!nextDraft.dirty) latestDrafts.delete(save.key)
              }
            } else if (result?.reason === 'stale') {
              await queryClient.refetchQueries({ queryKey: saveQueryKey, exact: true })
            }
            if (!result?.ok) {
              // This is intentionally a one-shot state, not an automatic
              // retry: the latest draft remains in the editor until the user
              // explicitly asks to retry it.
              const persisted = queryClient.getQueryData<NoteData>(saveQueryKey)?.note
              const queuedGeneration = saveState.queued?.generation
              const currentDraft = latestDrafts.get(save.key)
              const activeDraftIsPersisted =
                currentDraft !== undefined && sameNote(currentDraft.value, persisted)
              if (
                currentDraft !== undefined &&
                currentDraft.generation === (queuedGeneration ?? generation) &&
                currentDraft.hasLocalIntent &&
                !activeDraftIsPersisted
              ) {
                updateFailedDrafts((current) => {
                  const failedKey = failedDraftKey(save.key, currentRevision.platformAccountId)
                  if (failedKey === null) return current
                  const next = new Map(current)
                  next.delete(failedKey)
                  next.set(failedKey, { ...currentDraft })
                  return next
                })
              } else if (
                currentDraft !== undefined &&
                currentDraft.generation === (queuedGeneration ?? generation) &&
                activeDraftIsPersisted
              ) {
                updateFailedDrafts((current) => {
                  const failedKey = failedDraftKey(save.key, currentRevision.platformAccountId)
                  if (failedKey === null || !current.has(failedKey)) return current
                  const next = new Map(current)
                  next.delete(failedKey)
                  return next
                })
              }
              // A rejected save is a terminal attempt. Do not auto-drain a
              // queued edit: only the explicit Retry control may try again.
              saveState.queued = null
              break
            }
            const queued = saveState.queued
            saveState.queued = null
            const persisted = queryClient.getQueryData<NoteData>(saveQueryKey)?.note
            if (queued !== null && !sameNote(queued.note, persisted)) {
              note = queued.note
              generation = queued.generation
              intentVersion = queued.intentVersion
            } else {
              note = null
            }
          }
        } finally {
          saveState.saving = false
          if (saveStates.get(stateKey) === saveState) {
            saveStates.delete(stateKey)
            latestDrafts.delete(stateKey)
          }
        }
      }
    },
    queryClient
  )

  const saveDraft = useCallback(
    (isRetry: boolean) => {
      if (query.data?.revision === undefined || setFriendNote === null) {
        return
      }
      const stateKey = key
      const saveState = saveStates.get(stateKey)
      const activeFailedKey = failedDraftKey(key, draft.platformAccountId)
      if (!isRetry && activeFailedKey !== null && failedDrafts.has(activeFailedKey)) return
      if (isRetry && activeFailedKey !== null && failedDrafts.has(activeFailedKey)) {
        // Keep the retained snapshot current before it joins an existing
        // writer or starts a new one.
        updateFailedDrafts((current) => {
          const retained = current.get(activeFailedKey)
          if (retained === undefined) return current
          const next = new Map(current)
          next.delete(activeFailedKey)
          next.set(activeFailedKey, retained)
          return next
        })
      }
      if (saveState?.saving) {
        saveState.queued = {
          generation: draft.generation,
          intentVersion: draft.intentVersion,
          note: draft.value
        }
        return
      }
      if (!draft.dirty) return
      saveStates.set(stateKey, {
        saving: true,
        queued: null
      })
      rememberDraft(stateKey, draft)
      mutate({
        key,
        generation: draft.generation,
        intentVersion: draft.intentVersion,
        epoch: boundaryEpoch,
        platform,
        friendId,
        note: draft.value
      })
    },
    [
      boundaryEpoch,
      draft,
      failedDrafts,
      friendId,
      key,
      mutate,
      platform,
      query.data?.revision,
      setFriendNote
    ]
  )

  const onBlur = useCallback(() => saveDraft(false), [saveDraft])
  const retry = useCallback(() => saveDraft(true), [saveDraft])

  const setValue = useCallback(
    (value: string) => {
      if (!isWritable) return
      const next = value.slice(0, MAX_NOTE_LENGTH)
      // Completion handlers can run in the same React batch as input. Keep
      // their guard in step with the visible draft rather than waiting for the
      // passive synchronization effect.
      const liveEpoch = epochFor(platform)
      const current =
        liveEpoch === boundaryEpoch
          ? draftRef.current
          : emptyDraft(`${platform}:${friendId}:${liveEpoch}`, draftRef.current.generation + 1)
      const nextDraft = {
        ...current,
        value: next,
        dirty: !sameNote(next, draftRef.current.baseline),
        intentVersion: ++coordinator.nextIntentVersion,
        hasLocalIntent: true
      }
      draftRef.current = nextDraft
      rememberDraft(nextDraft.key, nextDraft)
      setDraft(nextDraft)
      if (!nextDraft.dirty) {
        updateFailedDrafts((current) => {
          const failedKey = failedDraftKey(nextDraft.key, nextDraft.platformAccountId)
          if (failedKey === null || !current.has(failedKey)) return current
          const updated = new Map(current)
          updated.delete(failedKey)
          return updated
        })
      } else {
        // Once a save has failed, edits replace the retained snapshot as they
        // happen, including while its Retry is off-screen.
        updateFailedDrafts((current) => {
          const failedKey = failedDraftKey(nextDraft.key, nextDraft.platformAccountId)
          if (failedKey === null || !current.has(failedKey)) return current
          const updated = new Map(current)
          updated.delete(failedKey)
          updated.set(failedKey, nextDraft)
          return updated
        })
      }
    },
    [boundaryEpoch, friendId, isWritable, platform]
  )

  return {
    value: draft.value,
    isWritable,
    setValue,
    onBlur,
    saveFailed: (() => {
      const failedKey = failedDraftKey(key, draft.platformAccountId)
      return failedKey !== null && failedDrafts.has(failedKey)
    })(),
    retry
  }
}

// Vite replaces this module in development without remounting every drawer.
// Transfer the one coordinator and unsubscribe its old bridge callback first,
// so the replacement owns exactly one boundary subscription and the same
// writer maps rather than creating a competing in-memory coordinator.
if (import.meta.hot) {
  import.meta.hot.dispose((data: FriendNoteCoordinatorHmrData) => {
    disposeFriendNoteCoordinatorForHmrTests()
    data.coordinator = coordinator
  })
}
