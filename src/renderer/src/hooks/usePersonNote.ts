import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import type { LinkSnapshot, LinkedProfile } from '@shared/linkedProfiles'
import {
  changeLinkedProfile,
  fetchLinkedProfiles,
  linkedProfilesKey,
  retainNewestLinkSnapshot
} from '../queries/linkedProfiles'
import type { UseFriendNoteResult } from './useFriendNote'

const MAX_NOTE_LENGTH = 500

interface DraftState {
  key: string
  baseline: string
  value: string
  dirty: boolean
  hasLocalIntent: boolean
  intentVersion: number
}

interface QueuedSave {
  note: string
  intentVersion: number
}

interface SaveState {
  saving: boolean
  queued: QueuedSave | null
}

interface PersonNoteCoordinator {
  epoch: number
  nextIntentVersion: number
  drafts: Map<string, DraftState>
  failedDrafts: Map<string, DraftState>
  saveStates: Map<string, SaveState>
  listeners: Set<() => void>
  removeBoundaryListener: (() => void) | null
}

interface PersonNoteCoordinatorHmrData {
  personNoteCoordinator: PersonNoteCoordinator
}

const hmrData = import.meta.hot?.data as Partial<PersonNoteCoordinatorHmrData> | undefined
const coordinator: PersonNoteCoordinator = hmrData?.personNoteCoordinator ?? {
  epoch: 0,
  nextIntentVersion: 0,
  drafts: new Map(),
  failedDrafts: new Map(),
  saveStates: new Map(),
  listeners: new Set(),
  removeBoundaryListener: null
}

function subscribe(listener: () => void): () => void {
  coordinator.listeners.add(listener)
  return () => coordinator.listeners.delete(listener)
}

function notify(): void {
  coordinator.listeners.forEach((listener) => listener())
}

function snapshotVersion(): number {
  return coordinator.nextIntentVersion + coordinator.epoch * 1_000_000_000
}

function sameNote(left: string, right: string | null | undefined): boolean {
  return left.trimEnd() === (right ?? '').trimEnd()
}

function emptyDraft(key: string): DraftState {
  return {
    key,
    baseline: '',
    value: '',
    dirty: false,
    hasLocalIntent: false,
    intentVersion: 0
  }
}

function setDraft(key: string, draft: DraftState): void {
  coordinator.drafts.set(key, draft)
  coordinator.nextIntentVersion += 1
  notify()
}

function deleteFailure(key: string): void {
  if (!coordinator.failedDrafts.delete(key)) return
  coordinator.nextIntentVersion += 1
  notify()
}

function retainFailure(key: string, draft: DraftState): void {
  coordinator.failedDrafts.set(key, draft)
  coordinator.nextIntentVersion += 1
  notify()
}

function subscribeBoundary(): (() => void) | null {
  if (typeof window === 'undefined' || typeof window.vrx?.onIdentityBoundary !== 'function')
    return null
  return window.vrx.onIdentityBoundary(() => {
    coordinator.epoch += 1
    coordinator.drafts.clear()
    coordinator.failedDrafts.clear()
    coordinator.saveStates.clear()
    notify()
  })
}

function ensureCoordinator(): void {
  if (coordinator.removeBoundaryListener !== null) return
  coordinator.removeBoundaryListener = subscribeBoundary()
}

function replaceCoordinator(): void {
  const previous = coordinator.removeBoundaryListener
  const replacement = subscribeBoundary()
  if (replacement === null) return
  coordinator.removeBoundaryListener = replacement
  previous?.()
}

// Keep the prior listener installed through Vite's async dispose/import gap.
// Successful replacement evaluation subscribes first and then retires it.
if (hmrData?.personNoteCoordinator === undefined) ensureCoordinator()
else replaceCoordinator()

export function resetPersonNoteCoordinatorForTests(): void {
  coordinator.removeBoundaryListener?.()
  coordinator.removeBoundaryListener = null
  coordinator.epoch = 0
  coordinator.nextIntentVersion = 0
  coordinator.drafts.clear()
  coordinator.failedDrafts.clear()
  coordinator.saveStates.clear()
  notify()
}

export function personNoteCoordinatorCountsForTests(): {
  writers: number
  drafts: number
  failed: number
} {
  return {
    writers: coordinator.saveStates.size,
    drafts: coordinator.drafts.size,
    failed: coordinator.failedDrafts.size
  }
}

/** Test seam for Vite's async dispose/import gap. */
export function retainPersonNoteCoordinatorForHmrTests(): void {
  ensureCoordinator()
}

/** Test seam for successful replacement-module evaluation. */
export function replacePersonNoteCoordinatorForHmrTests(): void {
  replaceCoordinator()
}

function findProfile(
  snapshot: LinkSnapshot | undefined,
  personId: string
): LinkedProfile | undefined {
  return snapshot?.profiles.find((candidate) => candidate.id === personId)
}

/** Blocks destructive review while any affected owner has local or in-flight text. */
export function usePersonNoteGuard(personIds: string[]): {
  blockedIds: string[]
  isBlocked: () => boolean
} {
  ensureCoordinator()
  useSyncExternalStore(subscribe, snapshotVersion, () => 0)
  const blockedIds = (): string[] =>
    personIds.filter((id) => {
      const key = `${id}:${coordinator.epoch}`
      return coordinator.drafts.get(key)?.dirty || coordinator.saveStates.get(key)?.saving
    })
  return { blockedIds: blockedIds(), isBlocked: () => blockedIds().length > 0 }
}

async function refreshProfiles(client: QueryClient): Promise<LinkSnapshot | undefined> {
  try {
    return await client.fetchQuery({
      queryKey: linkedProfilesKey,
      queryFn: ({ signal }) => fetchLinkedProfiles(signal),
      structuralSharing: retainNewestLinkSnapshot,
      staleTime: 0
    })
  } catch {
    return undefined
  }
}

async function runWriter(
  client: QueryClient,
  key: string,
  personId: string,
  epoch: number,
  first: QueuedSave
): Promise<void> {
  const state = coordinator.saveStates.get(key)
  if (state === undefined) return
  let pending: QueuedSave | null = first

  try {
    while (pending !== null) {
      if (coordinator.epoch !== epoch || coordinator.saveStates.get(key) !== state) return
      const currentSnapshot = client.getQueryData<LinkSnapshot>(linkedProfilesKey)
      const profile = findProfile(currentSnapshot, personId)
      if (currentSnapshot === undefined || profile === undefined) return

      const sent = pending
      const result = await changeLinkedProfile(client, currentSnapshot.lease, {
        kind: 'update',
        personId,
        expectedRevision: profile.revision,
        patch: { sharedNote: sent.note }
      })
      if (coordinator.epoch !== epoch || coordinator.saveStates.get(key) !== state) return

      if (!result.ok) {
        const refreshed = result.reason === 'stale' ? await refreshProfiles(client) : undefined
        if (coordinator.epoch !== epoch || coordinator.saveStates.get(key) !== state) return
        const latest = coordinator.drafts.get(key)
        const refreshedNote = findProfile(refreshed, personId)?.sharedNote
        if (
          latest !== undefined &&
          refreshedNote !== undefined &&
          sameNote(latest.value, refreshedNote)
        ) {
          setDraft(key, {
            ...latest,
            baseline: refreshedNote,
            dirty: false,
            hasLocalIntent: false
          })
          deleteFailure(key)
        } else if (latest !== undefined && latest.dirty) {
          retainFailure(key, latest)
        }
        state.queued = null
        return
      }

      const savedProfile = findProfile(result.value, personId)
      const savedNote = savedProfile?.sharedNote ?? sent.note
      const latest = coordinator.drafts.get(key)
      if (latest !== undefined) {
        const savedVisibleDraft =
          latest.intentVersion === sent.intentVersion && sameNote(latest.value, sent.note)
        const next = {
          ...latest,
          baseline: savedNote,
          dirty: savedVisibleDraft ? false : !sameNote(latest.value, savedNote),
          hasLocalIntent: savedVisibleDraft ? false : !sameNote(latest.value, savedNote)
        }
        setDraft(key, next)
        if (!next.dirty) deleteFailure(key)
      }

      const queued = state.queued
      state.queued = null
      const persisted = findProfile(
        client.getQueryData<LinkSnapshot>(linkedProfilesKey),
        personId
      )?.sharedNote
      pending = queued !== null && !sameNote(queued.note, persisted) ? queued : null
    }
  } finally {
    state.saving = false
    if (coordinator.saveStates.get(key) === state) {
      coordinator.saveStates.delete(key)
      coordinator.nextIntentVersion += 1
      notify()
    }
  }
}

/** Edits the installation-local note owned by a linked person. */
export function usePersonNote(personId: string | null): UseFriendNoteResult {
  const providedClient = useContext(QueryClientContext)
  const [fallbackClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  )
  const queryClient = providedClient ?? fallbackClient
  ensureCoordinator()
  const epoch = coordinator.epoch
  useSyncExternalStore(subscribe, snapshotVersion, () => 0)
  const key = personId === null ? `disabled:${epoch}` : `${personId}:${epoch}`
  const bridgeReadable =
    typeof window !== 'undefined' && typeof window.vrx?.getLinkedProfiles === 'function'
  const bridgeWritable =
    typeof window !== 'undefined' && typeof window.vrx?.changeLinkedProfile === 'function'
  const query = useQuery(
    {
      queryKey: linkedProfilesKey,
      queryFn: ({ signal }) => fetchLinkedProfiles(signal),
      staleTime: Infinity,
      retry: false,
      structuralSharing: retainNewestLinkSnapshot,
      enabled: personId !== null && bridgeReadable
    },
    queryClient
  )
  const profile = personId === null ? undefined : findProfile(query.data, personId)
  const draft = coordinator.drafts.get(key) ?? emptyDraft(key)

  useEffect(() => {
    if (personId === null || profile === undefined || coordinator.epoch !== epoch) return
    const current = coordinator.drafts.get(key)
    if (current === undefined) {
      setDraft(key, {
        ...emptyDraft(key),
        baseline: profile.sharedNote,
        value: profile.sharedNote
      })
      return
    }
    if (sameNote(current.baseline, profile.sharedNote)) return
    const dirty = current.hasLocalIntent && !sameNote(current.value, profile.sharedNote)
    setDraft(key, {
      ...current,
      baseline: profile.sharedNote,
      value: current.hasLocalIntent ? current.value : profile.sharedNote,
      dirty,
      hasLocalIntent: dirty
    })
    if (!dirty) deleteFailure(key)
  }, [epoch, key, personId, profile])

  const isWritable =
    personId !== null && bridgeReadable && bridgeWritable && !query.isError && profile !== undefined
  const loadFailed =
    personId !== null &&
    (!bridgeReadable ||
      !bridgeWritable ||
      query.isError ||
      (query.isSuccess && profile === undefined))

  const saveDraft = useCallback(
    (isRetry: boolean) => {
      if (personId === null || !isWritable || coordinator.epoch !== epoch) return
      const current = coordinator.drafts.get(key)
      if (current === undefined || !current.dirty) return
      const failed = coordinator.failedDrafts.has(key)
      if (failed && !isRetry) return
      const active = coordinator.saveStates.get(key)
      const queued = { note: current.value, intentVersion: current.intentVersion }
      if (active?.saving) {
        if (!failed || isRetry) active.queued = queued
        return
      }
      const state: SaveState = { saving: true, queued: null }
      coordinator.saveStates.set(key, state)
      void runWriter(queryClient, key, personId, epoch, queued)
    },
    [epoch, isWritable, key, personId, queryClient]
  )

  const setValue = useCallback(
    (value: string) => {
      if (!isWritable || personId === null || coordinator.epoch !== epoch) return
      const current = coordinator.drafts.get(key)
      if (current === undefined) return
      const nextValue = value.slice(0, MAX_NOTE_LENGTH)
      const next = {
        ...current,
        value: nextValue,
        dirty: !sameNote(nextValue, current.baseline),
        hasLocalIntent: !sameNote(nextValue, current.baseline),
        intentVersion: coordinator.nextIntentVersion + 1
      }
      setDraft(key, next)
      if (!next.dirty) deleteFailure(key)
      else if (coordinator.failedDrafts.has(key)) retainFailure(key, next)
    },
    [epoch, isWritable, key, personId]
  )

  const retryLoad = useCallback(() => {
    void query.refetch()
  }, [query])

  return {
    value: draft.value,
    isWritable,
    loadFailed,
    retryLoad,
    setValue,
    onBlur: useCallback(() => saveDraft(false), [saveDraft]),
    saveFailed: coordinator.failedDrafts.has(key),
    retry: useCallback(() => saveDraft(true), [saveDraft])
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: PersonNoteCoordinatorHmrData) => {
    data.personNoteCoordinator = coordinator
  })
}
