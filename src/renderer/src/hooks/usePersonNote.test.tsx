// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkSnapshot } from '@shared/linkedProfiles'
import { linkedProfilesKey, subscribeLinkedProfiles } from '../queries/linkedProfiles'
import {
  personNoteCoordinatorCountsForTests,
  replacePersonNoteCoordinatorForHmrTests,
  resetPersonNoteCoordinatorForTests,
  retainPersonNoteCoordinatorForHmrTests,
  usePersonNote
} from './usePersonNote'

function snapshot(
  lease: string,
  personId: string,
  sharedNote: string,
  revision = 1,
  defaultName = 'Person'
): LinkSnapshot {
  return {
    lease,
    accountIds: {},
    storeRevision: revision,
    profiles: [
      {
        id: personId,
        members: [
          {
            platform: 'vrchat',
            platformAccountId: 'vrc-self',
            friendId: `vrc-${personId}`
          },
          {
            platform: 'chilloutvr',
            platformAccountId: 'cvr-self',
            friendId: `cvr-${personId}`
          }
        ],
        customName: null,
        defaultName,
        preferredPlatform: 'vrchat',
        pictureMode: 'preferred',
        sharedNote,
        revision
      }
    ]
  }
}

const subscriptions: Array<() => void> = []
function createClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  subscriptions.push(subscribeLinkedProfiles(client))
  return client
}

function wrapper(client: QueryClient) {
  return function PersonNoteWrapper({
    children
  }: {
    children: React.ReactNode
  }): React.JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('usePersonNote', () => {
  let getLinkedProfiles: ReturnType<typeof vi.fn>
  let changeLinkedProfile: ReturnType<typeof vi.fn>
  let boundaries: Array<() => void>

  beforeEach(() => {
    resetPersonNoteCoordinatorForTests()
    boundaries = []
    getLinkedProfiles = vi
      .fn()
      .mockResolvedValue({ ok: true, value: snapshot('lease-1', 'p1', 'Saved') })
    changeLinkedProfile = vi.fn().mockImplementation(({ change }) =>
      Promise.resolve({
        ok: true,
        value: snapshot(
          'lease-2',
          change.personId,
          change.patch.sharedNote,
          change.expectedRevision + 1
        )
      })
    )
    window.vrx = {
      getLinkedProfiles,
      changeLinkedProfile,
      onIdentityBoundary: vi.fn((callback) => {
        boundaries.push(callback as () => void)
        return () => {
          boundaries = boundaries.filter((candidate) => candidate !== callback)
        }
      })
    } as unknown as Window['vrx']
  })

  afterEach(() => {
    cleanup()
    subscriptions.splice(0).forEach((dispose) => dispose())
    vi.restoreAllMocks()
  })

  const fireBoundary = (): void => boundaries.forEach((callback) => callback())

  it('loads the shared note without touching either account-note bridge', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.value).toBe('Saved'))
    expect(result.current.isWritable).toBe(true)
    expect(getLinkedProfiles).toHaveBeenCalledOnce()
    expect((window.vrx as unknown as Record<string, unknown>).getFriendNote).toBeUndefined()
    expect((window.vrx as unknown as Record<string, unknown>).setFriendNote).toBeUndefined()
  })

  it('keeps a local draft when a live profile revision and name change', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.value).toBe('Saved'))

    act(() => result.current.setValue('Local draft'))
    act(() => {
      client.setQueryData(linkedProfilesKey, snapshot('lease-2', 'p1', 'Saved', 2, 'Renamed'))
    })

    expect(result.current.value).toBe('Local draft')
  })

  it('caps drafts at 500 characters and ignores trailing-space-only changes', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.value).toBe('Saved'))

    act(() => result.current.setValue('x'.repeat(501)))
    expect(result.current.value).toHaveLength(500)
    act(() => result.current.setValue('Saved   '))
    act(() => result.current.onBlur())
    expect(changeLinkedProfile).not.toHaveBeenCalled()
  })

  it('serializes saves and sends only the newest queued draft', async () => {
    const replies: Array<(result: ReturnType<typeof success>) => void> = []
    const success = (
      note: string,
      revision: number,
      lease: string
    ): { ok: true; value: LinkSnapshot } => ({
      ok: true as const,
      value: snapshot(lease, 'p1', note, revision)
    })
    changeLinkedProfile.mockImplementation(
      ({ change }) =>
        new Promise((resolve) => {
          replies.push((result) => resolve(result))
          expect(change.kind).toBe('update')
        })
    )
    const client = createClient()
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.value).toBe('Saved'))

    act(() => result.current.setValue('One'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(changeLinkedProfile).toHaveBeenCalledTimes(1))
    act(() => result.current.setValue('Two'))
    act(() => result.current.onBlur())
    act(() => result.current.setValue('Three'))
    act(() => result.current.onBlur())

    act(() => replies[0]?.(success('One', 2, 'lease-2')))
    await waitFor(() => expect(changeLinkedProfile).toHaveBeenCalledTimes(2))
    expect(changeLinkedProfile).toHaveBeenLastCalledWith({
      lease: 'lease-2',
      change: {
        kind: 'update',
        personId: 'p1',
        expectedRevision: 2,
        patch: { sharedNote: 'Three' }
      }
    })
    act(() => replies[1]?.(success('Three', 3, 'lease-3')))
  })

  it('stops queued auto-saves after failure and retries the newest draft explicitly', async () => {
    let failFirst: (value: { ok: false; reason: 'storage' }) => void = () => {}
    changeLinkedProfile
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            failFirst = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true, value: snapshot('lease-2', 'p1', 'Newest', 2) })
    const client = createClient()
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.value).toBe('Saved'))

    act(() => result.current.setValue('First'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(changeLinkedProfile).toHaveBeenCalledOnce())
    act(() => result.current.setValue('Newest'))
    act(() => result.current.onBlur())
    act(() => failFirst({ ok: false, reason: 'storage' }))

    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    expect(changeLinkedProfile).toHaveBeenCalledOnce()
    act(() => result.current.onBlur())
    expect(changeLinkedProfile).toHaveBeenCalledOnce()
    act(() => result.current.retry())
    await waitFor(() => expect(changeLinkedProfile).toHaveBeenCalledTimes(2))
    expect(changeLinkedProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        change: expect.objectContaining({ patch: { sharedNote: 'Newest' } })
      })
    )
  })

  it('keeps an old-person completion from targeting the newly selected person', async () => {
    let finishP1: (value: { ok: true; value: LinkSnapshot }) => void = () => {}
    getLinkedProfiles.mockResolvedValue({
      ok: true,
      value: {
        lease: 'lease-1',
        profiles: [
          ...snapshot('lease-1', 'p1', 'P1').profiles,
          ...snapshot('lease-1', 'p2', 'P2').profiles
        ]
      }
    })
    changeLinkedProfile
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishP1 = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true, value: snapshot('lease-3', 'p2', 'P2 edit', 2) })
    const client = createClient()
    const { result, rerender } = renderHook(({ id }: { id: string }) => usePersonNote(id), {
      initialProps: { id: 'p1' },
      wrapper: wrapper(client)
    })
    await waitFor(() => expect(result.current.value).toBe('P1'))
    act(() => result.current.setValue('P1 edit'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(changeLinkedProfile).toHaveBeenCalledOnce())

    rerender({ id: 'p2' })
    await waitFor(() => expect(result.current.value).toBe('P2'))
    act(() => finishP1({ ok: true, value: snapshot('lease-2', 'p1', 'P1 edit', 2) }))
    expect(result.current.value).toBe('P2')
    expect(changeLinkedProfile).toHaveBeenCalledTimes(1)
  })

  it('restores a failed draft after remount and retries it', async () => {
    changeLinkedProfile
      .mockResolvedValueOnce({ ok: false, reason: 'storage' })
      .mockResolvedValueOnce({ ok: true, value: snapshot('lease-2', 'p1', 'Retained', 2) })
    const client = createClient()
    const first = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.value).toBe('Saved'))
    act(() => first.result.current.setValue('Retained'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    first.unmount()

    const second = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(second.result.current.value).toBe('Retained'))
    expect(second.result.current.saveFailed).toBe(true)
    act(() => second.result.current.retry())
    await waitFor(() => expect(second.result.current.saveFailed).toBe(false))
  })

  it('refreshes a stale shared CAS but waits for explicit Retry before overwriting an external edit', async () => {
    getLinkedProfiles
      .mockResolvedValueOnce({ ok: true, value: snapshot('lease-1', 'p1', 'Saved', 1) })
      .mockResolvedValueOnce({ ok: true, value: snapshot('lease-2', 'p1', 'External edit', 2) })
    changeLinkedProfile
      .mockResolvedValueOnce({ ok: false, reason: 'stale' })
      .mockResolvedValueOnce({ ok: true, value: snapshot('lease-3', 'p1', 'Local edit', 3) })
    const client = createClient()
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.value).toBe('Saved'))
    act(() => result.current.setValue('Local edit'))
    act(() => result.current.onBlur())

    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    expect(result.current.value).toBe('Local edit')
    expect(getLinkedProfiles).toHaveBeenCalledTimes(2)
    expect(changeLinkedProfile).toHaveBeenCalledOnce()
    act(() => result.current.onBlur())
    expect(changeLinkedProfile).toHaveBeenCalledOnce()
    act(() => result.current.retry())
    await waitFor(() => expect(changeLinkedProfile).toHaveBeenCalledTimes(2))
    expect(changeLinkedProfile).toHaveBeenLastCalledWith({
      lease: 'lease-2',
      change: {
        kind: 'update',
        personId: 'p1',
        expectedRevision: 2,
        patch: { sharedNote: 'Local edit' }
      }
    })
  })

  it('clears every retained draft on an identity boundary while unmounted', async () => {
    changeLinkedProfile.mockResolvedValueOnce({ ok: false, reason: 'storage' })
    const client = createClient()
    const first = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.value).toBe('Saved'))
    act(() => first.result.current.setValue('Private draft'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    first.unmount()
    expect(personNoteCoordinatorCountsForTests().failed).toBe(1)

    act(() => fireBoundary())
    expect(personNoteCoordinatorCountsForTests()).toEqual({ writers: 0, drafts: 0, failed: 0 })
    expect(client.getQueryData(linkedProfilesKey)).toEqual({
      profiles: [],
      lease: '',
      storeRevision: 0,
      accountIds: {}
    })
  })

  it('retains the privacy listener through HMR handoff and swaps without a gap', () => {
    resetPersonNoteCoordinatorForTests()
    const calls: string[] = []
    window.vrx = {
      onIdentityBoundary: vi.fn(() => {
        calls.push('subscribe')
        return () => calls.push('unsubscribe')
      })
    } as unknown as Window['vrx']

    retainPersonNoteCoordinatorForHmrTests()
    retainPersonNoteCoordinatorForHmrTests()
    expect(calls).toEqual(['subscribe'])

    replacePersonNoteCoordinatorForHmrTests()
    expect(calls).toEqual(['subscribe', 'subscribe', 'unsubscribe'])
  })

  it('fences a completion from before the identity boundary', async () => {
    let settle: (value: { ok: true; value: LinkSnapshot }) => void = () => {}
    changeLinkedProfile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    const client = createClient()
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.value).toBe('Saved'))
    act(() => result.current.setValue('Old account draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(changeLinkedProfile).toHaveBeenCalledOnce())

    const nextAccount = { profiles: [], lease: 'new-account', storeRevision: 2 }
    getLinkedProfiles.mockResolvedValue({ ok: true, value: nextAccount })
    act(() => fireBoundary())
    act(() => settle({ ok: true, value: snapshot('old-new-lease', 'p1', 'Old account draft', 2) }))
    await act(async () => Promise.resolve())

    expect(client.getQueryData(linkedProfilesKey)).toEqual(nextAccount)
    expect(result.current.value).toBe('')
  })

  it('does not cancel the app boundary reload when HMR moves the note listener after it', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.value).toBe('Saved'))
    replacePersonNoteCoordinatorForHmrTests()
    getLinkedProfiles.mockResolvedValue({
      ok: true,
      value: snapshot('new-account', 'p1', 'New account note', 2)
    })
    act(() => fireBoundary())
    await waitFor(() => expect(result.current.value).toBe('New account note'))
    expect(client.getQueryData<LinkSnapshot>(linkedProfilesKey)?.lease).toBe('new-account')
  })

  it('does not read linked profiles for a null person', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePersonNote(null), { wrapper: wrapper(client) })
    await act(async () => Promise.resolve())

    expect(getLinkedProfiles).not.toHaveBeenCalled()
    expect(client.getQueryCache().find({ queryKey: linkedProfilesKey, exact: true })).toBeDefined()
    expect(result.current).toMatchObject({ value: '', isWritable: false, loadFailed: false })
  })

  it('keeps bridge and read failures read-only until an explicit load retry succeeds', async () => {
    const client = createClient()
    Object.defineProperty(window, 'vrx', { configurable: true, value: undefined })
    const absent = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    expect(absent.result.current).toMatchObject({ value: '', isWritable: false, loadFailed: true })
    absent.unmount()

    getLinkedProfiles.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce({
      ok: true,
      value: snapshot('lease-1', 'p1', 'Recovered')
    })
    window.vrx = {
      getLinkedProfiles,
      changeLinkedProfile,
      onIdentityBoundary: vi.fn(() => () => {})
    } as unknown as Window['vrx']
    const failed = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(createClient()) })
    await waitFor(() => expect(failed.result.current.loadFailed).toBe(true))
    expect(failed.result.current.isWritable).toBe(false)
    act(() => failed.result.current.retryLoad())
    await waitFor(() => expect(failed.result.current.value).toBe('Recovered'))
    expect(failed.result.current.isWritable).toBe(true)
  })

  it('makes a cached note read-only when a live profile refresh fails', async () => {
    const client = createClient()
    getLinkedProfiles
      .mockResolvedValueOnce({ ok: true, value: snapshot('lease-1', 'p1', 'Cached') })
      .mockRejectedValueOnce(new Error('refresh failed'))
    const { result } = renderHook(() => usePersonNote('p1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.value).toBe('Cached'))
    expect(result.current.isWritable).toBe(true)

    await act(async () => {
      await client.invalidateQueries({ queryKey: linkedProfilesKey })
    })

    await waitFor(() => expect(result.current.loadFailed).toBe(true))
    expect(result.current.isWritable).toBe(false)
    act(() => result.current.setValue('Must not edit stale data'))
    expect(result.current.value).toBe('Cached')
  })
})
