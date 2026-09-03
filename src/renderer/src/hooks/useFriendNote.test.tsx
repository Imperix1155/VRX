// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  disposeFriendNoteCoordinatorForHmrTests,
  friendNoteCoordinatorCountsForTests,
  resetFriendNoteFailureStoreForTests,
  useFriendNote
} from './useFriendNote'
import { useLiveFriendEvents } from './useLiveFriendEvents'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeRevision(
  platformAccountId: string,
  epoch: number
): {
  platformAccountId: string
  epoch: number
} {
  return { platformAccountId, epoch }
}

function createWrapper(
  strict = false,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
) {
  return function FriendNoteQueryWrapper({
    children
  }: {
    children: React.ReactNode
  }): React.JSX.Element {
    const provided = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    return strict ? <StrictMode>{provided}</StrictMode> : provided
  }
}

describe('useFriendNote', () => {
  let getFriendNote: ReturnType<typeof vi.fn>
  let setFriendNote: ReturnType<typeof vi.fn>
  let identityBoundaryCallbacks: Array<(event: { platform: 'vrchat' | 'chilloutvr' }) => void>

  beforeEach(() => {
    resetFriendNoteFailureStoreForTests()
    identityBoundaryCallbacks = []
    getFriendNote = vi.fn().mockResolvedValue({ note: null })
    setFriendNote = vi.fn().mockResolvedValue({ ok: true })
    window.vrx = {
      getFriendNote,
      setFriendNote,
      onFriendEvent: vi.fn(() => () => {}),
      onIdentityBoundary: vi.fn((cb) => {
        identityBoundaryCallbacks.push(cb)
        return () => {
          identityBoundaryCallbacks = identityBoundaryCallbacks.filter((c) => c !== cb)
        }
      })
    } as unknown as Window['vrx']
  })

  const fireIdentityBoundary = (platform: 'vrchat' | 'chilloutvr'): void => {
    identityBoundaryCallbacks.forEach((cb) => cb({ platform }))
  }

  it('loads the saved note when the friend changes', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

    await waitFor(() => expect(result.current.value).toBe('Saved note'))
    expect(getFriendNote).toHaveBeenCalledOnce()
    expect(getFriendNote).toHaveBeenCalledWith({ platform: 'vrchat', friendId: 'usr_a' })
  })

  it('blurs once when the note changed', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.setValue('Updated note'))
    act(() => result.current.onBlur())

    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    expect(setFriendNote).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_a',
      note: 'Updated note',
      revision: makeRevision('self', 1)
    })
  })

  it('keeps a newer local revert when an in-flight save succeeds', async () => {
    let resolveSave: (value: { ok: true }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('self', 1) })
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Original'))
    act(() => result.current.setValue('Saving value'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    act(() => result.current.setValue('Original'))

    await act(async () => {
      resolveSave({ ok: true })
      await Promise.resolve()
    })
    expect(result.current.value).toBe('Original')
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(setFriendNote).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'Original' }))
  })

  it('queues a blur back to the pre-save value while a save is pending', async () => {
    let resolveSave: (value: { ok: true }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('self', 1) })
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Original'))
    act(() => result.current.setValue('First'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    act(() => result.current.setValue('Original'))
    act(() => result.current.onBlur())

    act(() => resolveSave({ ok: true }))
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(setFriendNote).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'Original' }))
  })

  it('replaces an in-flight queued draft even when the last edit equals the old baseline', async () => {
    const resolves: Array<(value: { ok: true }) => void> = []
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('self', 1) })
    setFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolves.push(resolve)
        })
    )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Original'))
    act(() => result.current.setValue('First'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    act(() => result.current.setValue('Second'))
    act(() => result.current.onBlur())
    act(() => result.current.setValue('Original'))
    act(() => result.current.onBlur())

    act(() => resolves[0]?.({ ok: true }))
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(setFriendNote).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'Original' }))
  })

  it('sends exactly one save request under StrictMode', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(true)
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.setValue('Updated once'))
    act(() => result.current.onBlur())

    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // React double-invokes state updaters in StrictMode. A bridge call made
    // inside one would therefore issue duplicate IPC requests (VRX-213).
    expect(setFriendNote).toHaveBeenCalledTimes(1)
  })

  it('does not call setFriendNote on blur when the note is unchanged', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.onBlur())

    await waitFor(() => expect(setFriendNote).not.toHaveBeenCalled())
  })

  it('caps the draft at 500 characters', () => {
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    act(() => result.current.setValue('a'.repeat(501)))
    expect(result.current.value).toHaveLength(500)
  })

  it('renders empty and read-only when the preload bridge is absent', () => {
    Object.defineProperty(window, 'vrx', { configurable: true, value: undefined })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    expect(result.current.value).toBe('')
    act(() => result.current.setValue('Local only'))
    act(() => result.current.onBlur())
    expect(result.current.value).toBe('Local only')
    expect(getFriendNote).not.toHaveBeenCalled()
  })

  it('does not start a note query when the bridge exists without note methods', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    window.vrx = {
      onFriendEvent: vi.fn(() => () => {}),
      onIdentityBoundary: vi.fn(() => () => {})
    } as unknown as Window['vrx']

    renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(['friend-note', 'vrchat', 'usr_a', 0])).toMatchObject({
        fetchStatus: 'idle',
        error: null
      })
    })
  })

  it('does not read or cache a note while the drawer has no selected friend', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const emptyNoteKey = ['friend-note', 'vrchat', '', 0] as const

    renderHook(() => useFriendNote({ platform: 'vrchat', friendId: '' }), {
      wrapper: createWrapper(false, queryClient)
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getFriendNote).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(emptyNoteKey)).toBeUndefined()
    expect(
      queryClient.getQueryCache().find({ queryKey: emptyNoteKey, exact: true })
    ).toBeUndefined()
  })

  it('requires an explicit retry after a stale save refreshes its revision', async () => {
    let resolveSave: (value: { ok: boolean; reason?: string }) => void = () => {}
    getFriendNote
      .mockResolvedValueOnce({ note: 'Saved note', revision: makeRevision('self', 1) })
      .mockResolvedValueOnce({ note: 'Saved note', revision: makeRevision('self', 2) })
    setFriendNote
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.setValue('Try again'))
    act(() => result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveSave({ ok: false, reason: 'stale' })
      await Promise.resolve()
    })

    await waitFor(() => expect(getFriendNote).toHaveBeenCalledTimes(2))
    act(() => result.current.onBlur())
    expect(setFriendNote).toHaveBeenCalledTimes(1)
    act(() => result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(setFriendNote).toHaveBeenLastCalledWith({
      platform: 'vrchat',
      friendId: 'usr_a',
      note: 'Try again',
      revision: makeRevision('self', 2)
    })
  })

  it('keeps a rejected draft local and exposes an explicit retry', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockResolvedValueOnce({ ok: true })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.setValue('Newest local draft'))
    act(() => result.current.onBlur())

    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    expect(result.current.value).toBe('Newest local draft')

    act(() => result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.saveFailed).toBe(false))
    expect(setFriendNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ note: 'Newest local draft' })
    )
  })

  it('restores independent failed drafts for each friend and clears one after Retry succeeds', async () => {
    getFriendNote.mockImplementation(({ friendId }: { friendId: string }) =>
      Promise.resolve({
        note: friendId === 'usr_a' ? 'Saved A' : 'Saved B',
        revision: makeRevision('self', 1)
      })
    )
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_a' }, wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.value).toBe('Saved A'))
    act(() => result.current.setValue('Failed A'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    rerender({ friendId: 'usr_b' })
    await waitFor(() => expect(result.current.value).toBe('Saved B'))
    act(() => result.current.setValue('Failed B'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(result.current.saveFailed).toBe(true))

    rerender({ friendId: 'usr_a' })
    await waitFor(() => expect(result.current.value).toBe('Failed A'))
    expect(result.current.saveFailed).toBe(true)
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.saveFailed).toBe(false))
    rerender({ friendId: 'usr_b' })
    await waitFor(() => expect(result.current.value).toBe('Failed B'))
    expect(result.current.saveFailed).toBe(true)
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.saveFailed).toBe(false))
    expect(setFriendNote).toHaveBeenNthCalledWith(3, expect.objectContaining({ note: 'Failed A' }))
    expect(setFriendNote).toHaveBeenNthCalledWith(4, expect.objectContaining({ note: 'Failed B' }))
  })

  it('does not expose a failed draft to another account with the same friend id', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    getFriendNote.mockResolvedValue({
      note: 'Account A saved',
      revision: makeRevision('account-a', 1)
    })
    setFriendNote.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    const { result, rerender } = renderHook(
      () => useFriendNote({ platform: 'vrchat', friendId: 'usr_same' }),
      { wrapper: createWrapper(false, queryClient) }
    )
    await waitFor(() => expect(result.current.value).toBe('Account A saved'))
    act(() => result.current.setValue('Account A failed draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(result.current.saveFailed).toBe(true))

    act(() => {
      queryClient.setQueryData(['friend-note', 'vrchat', 'usr_same', 0], {
        note: 'Account B saved',
        revision: makeRevision('account-b', 1)
      })
      rerender()
    })
    await waitFor(() => expect(result.current.value).toBe('Account B saved'))
    expect(result.current.saveFailed).toBe(false)

    act(() => {
      queryClient.setQueryData(['friend-note', 'vrchat', 'usr_same', 0], {
        note: 'Account A saved',
        revision: makeRevision('account-a', 1)
      })
      rerender()
    })
    await waitFor(() => expect(result.current.value).toBe('Account A failed draft'))
    expect(result.current.saveFailed).toBe(true)
  })

  it('wipes retained failures at an identity boundary', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved', revision: makeRevision('self', 1) })
    setFriendNote.mockResolvedValue({ ok: false, reason: 'unavailable' })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })
    await waitFor(() => expect(result.current.value).toBe('Saved'))
    act(() => result.current.setValue('Failed'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    act(() => fireIdentityBoundary('vrchat'))
    await waitFor(() => expect(result.current.saveFailed).toBe(false))
  })

  it('retains the newest failed edit across an unmount and remount', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    getFriendNote.mockResolvedValue({ note: 'Saved', revision: makeRevision('self', 1) })
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockResolvedValueOnce({ ok: true })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Saved'))
    act(() => first.result.current.setValue('Failed A v1'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    act(() => first.result.current.setValue('Newest A v2'))
    first.unmount()

    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('Newest A v2'))
    expect(second.result.current.saveFailed).toBe(true)
    act(() => second.result.current.retry())
    await waitFor(() => expect(second.result.current.saveFailed).toBe(false))
    expect(setFriendNote).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'Newest A v2' }))
  })

  it('restores an off-screen rejected Retry as an actionable newest draft', async () => {
    let rejectRetry: (value: { ok: false; reason: string }) => void = () => {}
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    getFriendNote.mockResolvedValue({ note: 'Saved', revision: makeRevision('self', 1) })
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            rejectRetry = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Saved'))
    act(() => first.result.current.setValue('A v1'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    act(() => first.result.current.setValue('A v2'))
    act(() => first.result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    first.unmount()
    await act(async () => {
      rejectRetry({ ok: false, reason: 'unavailable' })
      await Promise.resolve()
    })

    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('A v2'))
    expect(second.result.current.saveFailed).toBe(true)
    act(() => second.result.current.retry())
    await waitFor(() => expect(second.result.current.saveFailed).toBe(false))
  })

  it.each([
    ['ordinary rejection', { ok: false, reason: 'unavailable' }],
    ['stale rejection', { ok: false, reason: 'stale' }]
  ] as const)('keeps an initial in-flight draft after remount and %s', async (_name, outcome) => {
    let settle: (value: typeof outcome) => void = () => {}
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    getFriendNote.mockResolvedValue({ note: 'Saved', revision: makeRevision('self', 1) })
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Saved'))
    act(() => first.result.current.setValue('Pending draft'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledOnce())
    first.unmount()
    await act(async () => {
      settle(outcome)
      await Promise.resolve()
    })
    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('Pending draft'))
    expect(second.result.current.saveFailed).toBe(true)
  })

  it('wipes a retained draft when its platform boundary fires while unmounted', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    getFriendNote.mockResolvedValue({ note: 'Saved', revision: makeRevision('same-account', 1) })
    setFriendNote.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Saved'))
    act(() => first.result.current.setValue('Retained'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    first.unmount()
    act(() => fireIdentityBoundary('vrchat'))
    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('Saved'))
    expect(second.result.current.saveFailed).toBe(false)
  })

  it('does not let a retry completion clear the failure for a newer draft', async () => {
    let resolveRetry: (value: { ok: true }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve
          })
      )
      .mockImplementationOnce(() => new Promise(() => {}))
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))
    act(() => result.current.setValue('Failed draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(result.current.saveFailed).toBe(true))

    act(() => result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    act(() => {
      result.current.setValue('Newest draft')
      resolveRetry({ ok: true })
    })
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(result.current.value).toBe('Newest draft')
    expect(result.current.saveFailed).toBe(true)
  })

  it('does not queue an ordinary blur while an explicit Retry is pending', async () => {
    let resolveRetry: (value: { ok: true }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve
          })
      )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))
    act(() => result.current.setValue('Failed draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(result.current.saveFailed).toBe(true))

    act(() => result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    act(() => result.current.setValue('Newer draft'))
    act(() => result.current.onBlur())
    expect(setFriendNote).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveRetry({ ok: true })
      await Promise.resolve()
    })
    expect(setFriendNote).toHaveBeenCalledTimes(2)
    expect(result.current.value).toBe('Newer draft')
    expect(result.current.saveFailed).toBe(true)
  })

  it('clears a failure when a pending Retry lands on the current same-value draft', async () => {
    let resolveRetry: (value: { ok: true }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('self', 1) })
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve
          })
      )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Original'))
    act(() => result.current.setValue('Draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    act(() => result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    act(() => {
      result.current.setValue('Draft plus')
      result.current.setValue('Draft')
      result.current.onBlur()
    })

    await act(async () => {
      resolveRetry({ ok: true })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.saveFailed).toBe(false))
    expect(result.current.value).toBe('Draft')
    expect(setFriendNote).toHaveBeenCalledTimes(2)
  })

  it('stops a queued save after failure until Retry saves the latest local draft', async () => {
    let resolveFirstSave: (value: { ok: false; reason: string }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    setFriendNote
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstSave = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))
    act(() => result.current.setValue('First draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    act(() => result.current.setValue('Newest local draft'))
    act(() => result.current.onBlur())

    act(() => resolveFirstSave({ ok: false, reason: 'unavailable' }))
    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    expect(result.current.value).toBe('Newest local draft')
    expect(setFriendNote).toHaveBeenCalledTimes(1)

    act(() => result.current.onBlur())
    expect(setFriendNote).toHaveBeenCalledTimes(1)

    act(() => result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(setFriendNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ note: 'Newest local draft' })
    )
  })

  it('does not resurrect a discarded friend failure after an A→B→A switch', async () => {
    let resolveASave: (value: { ok: false; reason: string }) => void = () => {}
    getFriendNote.mockImplementation((request: { friendId: string }) =>
      Promise.resolve({
        note: request.friendId === 'usr_a' ? 'A saved' : 'B saved',
        revision: makeRevision('self', 1)
      })
    )
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveASave = resolve
        })
    )
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_a' }, wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.value).toBe('A saved'))
    act(() => result.current.setValue('Discarded A draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    rerender({ friendId: 'usr_b' })
    await waitFor(() => expect(result.current.value).toBe('B saved'))
    rerender({ friendId: 'usr_a' })
    await waitFor(() => expect(result.current.value).toBe('A saved'))

    await act(async () => {
      resolveASave({ ok: false, reason: 'unavailable' })
      await Promise.resolve()
    })
    expect(result.current.saveFailed).toBe(false)
    act(() => result.current.retry())
    expect(setFriendNote).toHaveBeenCalledTimes(1)
  })

  it('does not let an old A save block feedback for a new A generation', async () => {
    let rejectOldA: (value: { ok: false; reason: string }) => void = () => {}
    getFriendNote.mockImplementation((request: { friendId: string }) =>
      Promise.resolve({
        note: request.friendId === 'usr_a' ? 'A saved' : 'B saved',
        revision: makeRevision('self', 1)
      })
    )
    setFriendNote
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            rejectOldA = resolve
          })
      )
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_a' }, wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.value).toBe('A saved'))
    act(() => result.current.setValue('Old A draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    rerender({ friendId: 'usr_b' })
    await waitFor(() => expect(result.current.value).toBe('B saved'))
    rerender({ friendId: 'usr_a' })
    await waitFor(() => expect(result.current.value).toBe('A saved'))
    act(() => result.current.setValue('New A draft'))
    act(() => result.current.onBlur())
    expect(setFriendNote).toHaveBeenCalledTimes(1)

    act(() => rejectOldA({ ok: false, reason: 'unavailable' }))
    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    expect(result.current.value).toBe('New A draft')
  })

  it('drains only the latest A intent after an A→B→A generation switch', async () => {
    const resolves: Array<(value: { ok: true }) => void> = []
    getFriendNote.mockImplementation((request: { friendId: string }) =>
      Promise.resolve({
        note: request.friendId === 'usr_a' ? 'A0' : 'B',
        revision: makeRevision('self', 1)
      })
    )
    setFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolves.push(resolve)
        })
    )
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_a' }, wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.value).toBe('A0'))
    act(() => result.current.setValue('A1'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    rerender({ friendId: 'usr_b' })
    await waitFor(() => expect(result.current.value).toBe('B'))
    rerender({ friendId: 'usr_a' })
    await waitFor(() => expect(result.current.value).toBe('A0'))
    act(() => result.current.setValue('A2'))
    act(() => result.current.onBlur())
    act(() => result.current.setValue('A0'))
    act(() => result.current.onBlur())

    act(() => resolves[0]?.({ ok: true }))
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(setFriendNote).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'A0' }))
    expect(result.current.value).toBe('A0')
  })

  it('clears a save failure when editing the draft back to its persisted value', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    setFriendNote.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))
    act(() => result.current.setValue('Failed draft'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(result.current.saveFailed).toBe(true))

    act(() => result.current.setValue('Saved note'))
    expect(result.current.saveFailed).toBe(false)
    act(() => result.current.retry())
    expect(setFriendNote).toHaveBeenCalledTimes(1)
  })

  it('clears a stale-save failure when its refetch finds the current draft persisted', async () => {
    let resolveSave: (value: { ok: false; reason: 'stale' }) => void = () => {}
    getFriendNote
      .mockResolvedValueOnce({ note: 'Saved note', revision: makeRevision('self', 1) })
      .mockResolvedValueOnce({ note: 'Draft already saved', revision: makeRevision('self', 2) })
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Saved note'))
    act(() => result.current.setValue('Draft already saved'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveSave({ ok: false, reason: 'stale' })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.value).toBe('Draft already saved'))
    expect(result.current.saveFailed).toBe(false)
  })

  it('keeps a newer edit local when a stale save refetches a different note', async () => {
    let resolveRefetch: (value: {
      note: string
      revision: ReturnType<typeof makeRevision>
    }) => void = () => {}
    let resolveSave: (value: { ok: false; reason: 'stale' }) => void = () => {}
    getFriendNote
      .mockResolvedValueOnce({ note: 'A', revision: makeRevision('self', 1) })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefetch = resolve
          })
      )
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('A'))
    act(() => result.current.setValue('D'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    act(() => resolveSave({ ok: false, reason: 'stale' }))
    await waitFor(() => expect(getFriendNote).toHaveBeenCalledTimes(2))
    act(() => {
      result.current.setValue('A')
      result.current.onBlur()
    })
    await act(async () => {
      resolveRefetch({ note: 'B', revision: makeRevision('self', 2) })
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.saveFailed).toBe(true))
    expect(result.current.value).toBe('A')
    expect(setFriendNote).toHaveBeenCalledTimes(1)
  })

  it('preserves input made after an identity boundary in the same React batch', async () => {
    getFriendNote
      .mockResolvedValueOnce({ note: 'Account A', revision: makeRevision('a', 1) })
      .mockResolvedValueOnce({ note: 'Account B', revision: makeRevision('b', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_x' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Account A'))
    expect(getFriendNote).toHaveBeenCalledTimes(1)

    act(() => {
      fireIdentityBoundary('vrchat')
      result.current.setValue('Post-boundary draft')
    })
    expect(result.current.value).toBe('Post-boundary draft')

    await waitFor(() => expect(getFriendNote).toHaveBeenCalledTimes(2))
    expect(result.current.value).toBe('Post-boundary draft')
  })

  it('skips save without a fresh revision after an identity-boundary', async () => {
    getFriendNote.mockResolvedValue({ note: 'Account A', revision: makeRevision('a', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_x' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Account A'))

    act(() => fireIdentityBoundary('vrchat'))
    act(() => result.current.setValue('Should not save'))
    act(() => result.current.onBlur())

    await waitFor(() => expect(setFriendNote).not.toHaveBeenCalled())
  })

  it('does not clobber a dirty draft with a late load', async () => {
    let resolveLoad: (value: { note: string | null; revision: unknown }) => void = () => {}
    getFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve
        })
    )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    // Initial load is still in flight.
    act(() => result.current.setValue('User draft'))
    resolveLoad({ note: 'Server note', revision: makeRevision('self', 1) })

    await waitFor(() => expect(result.current.value).toBe('User draft'))
    expect(setFriendNote).not.toHaveBeenCalled()
  })

  it('queues a blur during an in-flight save and sends both drafts in order', async () => {
    const saveResolvers: Array<(value: { ok: boolean }) => void> = []
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('self', 1) })
    setFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          saveResolvers.push(resolve)
        })
    )
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Original'))

    // Start saving "First".
    act(() => result.current.setValue('First'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    expect(setFriendNote).toHaveBeenNthCalledWith(1, {
      platform: 'vrchat',
      friendId: 'usr_a',
      note: 'First',
      revision: makeRevision('self', 1)
    })

    // While "First" is still in flight, type "Second" and blur again.
    act(() => result.current.setValue('Second'))
    act(() => result.current.onBlur())

    // "Second" is queued, not sent yet.
    expect(setFriendNote).toHaveBeenCalledTimes(1)
    expect(result.current.value).toBe('Second')

    // Resolve "First" → the queue drains and sends "Second".
    act(() => saveResolvers[0]?.({ ok: true }))
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(result.current.value).toBe('Second')
    expect(setFriendNote).toHaveBeenNthCalledWith(2, {
      platform: 'vrchat',
      friendId: 'usr_a',
      note: 'Second',
      revision: makeRevision('self', 1)
    })

    // Resolve "Second" → loaded settles on the final persisted value.
    act(() => saveResolvers[1]?.({ ok: true }))
    await waitFor(() => expect(result.current.value).toBe('Second'))

    // A no-op blur must not trigger a third save.
    act(() => result.current.onBlur())
    expect(setFriendNote).toHaveBeenCalledTimes(2)
  })

  it('drains a queued final draft for its own friend after the selection switches', async () => {
    const saveResolvers: Array<(value: { ok: true }) => void> = []
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const aNoteKey = ['friend-note', 'vrchat', 'usr_a', 0] as const
    const bNoteKey = ['friend-note', 'vrchat', 'usr_b', 0] as const
    const aRevision = makeRevision('self', 7)
    getFriendNote.mockImplementation((req: { platform: string; friendId: string }) => {
      return Promise.resolve(
        req.friendId === 'usr_a'
          ? { note: 'A-note', revision: aRevision }
          : { note: 'B-note', revision: makeRevision('self', 7) }
      )
    })
    setFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          saveResolvers.push(resolve)
        })
    )
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_a' }, wrapper: createWrapper(false, queryClient) }
    )

    await waitFor(() => expect(result.current.value).toBe('A-note'))

    act(() => result.current.setValue('First'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    // Clicking B blurs A before the selection commit, so A's final draft queues.
    act(() => result.current.setValue('Second'))
    act(() => result.current.onBlur())
    rerender({ friendId: 'usr_b' })
    await waitFor(() => expect(result.current.value).toBe('B-note'))

    act(() => saveResolvers[0]?.({ ok: true }))
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(setFriendNote).toHaveBeenNthCalledWith(2, {
      platform: 'vrchat',
      friendId: 'usr_a',
      note: 'Second',
      revision: aRevision
    })

    act(() => saveResolvers[1]?.({ ok: true }))
    await waitFor(() => {
      expect(queryClient.getQueryData(aNoteKey)).toEqual({ note: 'Second', revision: aRevision })
    })
    expect(queryClient.getQueryData(bNoteKey)).toEqual({
      note: 'B-note',
      revision: makeRevision('self', 7)
    })
    expect(result.current.value).toBe('B-note')
    expect(setFriendNote).not.toHaveBeenCalledWith(expect.objectContaining({ friendId: 'usr_b' }))
  })

  it('surfaces a landed save from its own cache after an A→B→A switch', async () => {
    let resolveSave: (value: { ok: true }) => void = () => {}
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    getFriendNote.mockImplementation((req: { platform: string; friendId: string }) => {
      const note = req.friendId === 'usr_a' ? 'A-note' : 'B-note'
      return Promise.resolve({ note, revision: makeRevision('self', 1) })
    })
    setFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      {
        initialProps: { friendId: 'usr_a' },
        wrapper: createWrapper(false, queryClient)
      }
    )

    await waitFor(() => expect(result.current.value).toBe('A-note'))
    act(() => result.current.setValue('A-first'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledOnce())

    rerender({ friendId: 'usr_b' })
    await waitFor(() => expect(result.current.value).toBe('B-note'))
    act(() => resolveSave({ ok: true }))
    await waitFor(() => {
      expect(queryClient.getQueryData(['friend-note', 'vrchat', 'usr_a', 0])).toEqual({
        note: 'A-first',
        revision: makeRevision('self', 1)
      })
    })

    rerender({ friendId: 'usr_a' })
    await waitFor(() => expect(result.current.value).toBe('A-first'))
  })

  it('does not drain a queued draft or resurrect an evicted note when a save resolves late', async () => {
    let resolveSave: (value: { ok: true }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Account A', revision: makeRevision('a', 1) })
    setFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const noteKey = ['friend-note', 'vrchat', 'usr_a', 0] as const
    renderHook(() => useLiveFriendEvents(), { wrapper: createWrapper(false, queryClient) })
    const { result, unmount } = renderHook(
      () => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }),
      { wrapper: createWrapper(false, queryClient) }
    )

    await waitFor(() => expect(result.current.value).toBe('Account A'))
    act(() => result.current.setValue('Late account A save'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledOnce())
    act(() => result.current.setValue('Queued account A save'))
    act(() => result.current.onBlur())
    expect(setFriendNote).toHaveBeenCalledOnce()

    unmount()
    act(() => fireIdentityBoundary('vrchat'))
    expect(queryClient.getQueryData(noteKey)).toBeUndefined()
    await act(async () => {
      resolveSave({ ok: true })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(queryClient.getQueryData(noteKey)).toBeUndefined()
    expect(setFriendNote).toHaveBeenCalledOnce()
  })

  it('ignores a completion for a previous friend after a fast switch', async () => {
    let resolveSave: (value: { ok: boolean }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Note', revision: makeRevision('self', 1) })
    setFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_a' }, wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.value).toBe('Note'))

    act(() => result.current.setValue('For A'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    // Switch to friend B before the save for A resolves.
    rerender({ friendId: 'usr_b' })

    // The late response for A must not touch B's state.
    act(() => resolveSave({ ok: true }))
    expect(result.current.value).toBe('')
  })

  it('serializes a retry across drawer remounts and fences the old completion', async () => {
    const resolves: Array<(value: { ok: true }) => void> = []
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('same-account', 1) })
    setFriendNote.mockResolvedValueOnce({ ok: false, reason: 'unavailable' }).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolves.push(resolve)
        })
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })

    await waitFor(() => expect(first.result.current.value).toBe('Original'))
    act(() => first.result.current.setValue('Failed draft'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    first.unmount()

    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('Failed draft'))
    act(() => second.result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    second.unmount()

    const third = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(third.result.current.value).toBe('Failed draft'))
    act(() => third.result.current.retry())
    // The remounted control joins the existing serialized writer; it cannot
    // issue a concurrent third IPC call.
    expect(setFriendNote).toHaveBeenCalledTimes(2)

    act(() => resolves[0]?.({ ok: true }))
    await waitFor(() => expect(third.result.current.saveFailed).toBe(false))
    expect(setFriendNote).toHaveBeenCalledTimes(2)
  })

  it('reconciles an initial save that succeeds after the drawer remounts', async () => {
    let resolveSave: (value: { ok: true }) => void = () => {}
    const revision = makeRevision('same-account', 1)
    getFriendNote.mockResolvedValue({ note: 'Original', revision })
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Original'))
    act(() => first.result.current.setValue('Saved after remount'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledOnce())
    first.unmount()

    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('Saved after remount'))
    expect(second.result.current.saveFailed).toBe(false)

    act(() => resolveSave({ ok: true }))
    await waitFor(() =>
      expect(queryClient.getQueryData(['friend-note', 'vrchat', 'usr_a', 0])).toEqual({
        note: 'Saved after remount',
        revision
      })
    )
    expect(second.result.current.value).toBe('Saved after remount')
    expect(second.result.current.saveFailed).toBe(false)
  })

  it('reinstalls one boundary listener after a hot-replacement handoff without splitting a writer', async () => {
    let resolveSave: (value: { ok: true }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('same-account', 1) })
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Original'))
    act(() => first.result.current.setValue('HMR save'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledOnce())
    expect(friendNoteCoordinatorCountsForTests().writers).toBe(1)
    expect(identityBoundaryCallbacks).toHaveLength(1)

    // This mirrors Vite dispose: state survives, but the old bridge callback
    // is removed before the replacement module installs its one callback.
    disposeFriendNoteCoordinatorForHmrTests()
    expect(identityBoundaryCallbacks).toHaveLength(0)
    first.unmount()
    const replacement = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(replacement.result.current.value).toBe('HMR save'))
    expect(identityBoundaryCallbacks).toHaveLength(1)
    act(() => replacement.result.current.onBlur())
    expect(setFriendNote).toHaveBeenCalledOnce()

    act(() => resolveSave({ ok: true }))
    await waitFor(() => expect(friendNoteCoordinatorCountsForTests().writers).toBe(0))
    expect(replacement.result.current.saveFailed).toBe(false)
  })

  it('retains every unsaved renderer-lifetime draft for the session', async () => {
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('same-account', 1) })
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_0' }, wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.current.value).toBe('Original'))
    for (let index = 0; index < 129; index += 1) {
      rerender({ friendId: `usr_${index}` })
      act(() => result.current.setValue(`draft ${index}`))
    }
    expect(friendNoteCoordinatorCountsForTests().drafts).toBe(129)
  })

  it('keeps the newer remounted draft when the old retry rejects first', async () => {
    let rejectOldRetry: (value: { ok: false; reason: 'unavailable' }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('same-account', 1) })
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            rejectOldRetry = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Original'))
    act(() => first.result.current.setValue('Old failed draft'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    act(() => first.result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    first.unmount()

    // The old retry now settles after the HMR disposer has detached its bridge
    // callback; the replacement must still see its retained failure state.
    disposeFriendNoteCoordinatorForHmrTests()

    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('Old failed draft'))
    act(() => second.result.current.setValue('Newer retained draft'))
    act(() => second.result.current.retry())
    expect(setFriendNote).toHaveBeenCalledTimes(2)

    await act(async () => {
      rejectOldRetry({ ok: false, reason: 'unavailable' })
      await Promise.resolve()
    })
    await waitFor(() => expect(second.result.current.value).toBe('Newer retained draft'))
    expect(second.result.current.saveFailed).toBe(true)
    act(() => second.result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(3))
    expect(setFriendNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ note: 'Newer retained draft' })
    )
  })

  it('queues a newer remounted Retry behind an old success without losing its intent', async () => {
    const resolves: Array<(value: { ok: true }) => void> = []
    const revision = makeRevision('same-account', 1)
    getFriendNote.mockResolvedValue({ note: 'Original', revision })
    setFriendNote.mockResolvedValueOnce({ ok: false, reason: 'unavailable' }).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolves.push(resolve)
        })
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const noteKey = ['friend-note', 'vrchat', 'usr_a', 0] as const
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Original'))
    act(() => first.result.current.setValue('Old retry value'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    act(() => first.result.current.retry())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    first.unmount()

    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('Old retry value'))
    act(() => second.result.current.setValue('Newer retry value'))
    act(() => second.result.current.retry())
    // New Retry joins the extant writer; it cannot race it over IPC.
    expect(setFriendNote).toHaveBeenCalledTimes(2)

    act(() => resolves[0]?.({ ok: true }))
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(3))
    expect(second.result.current.value).toBe('Newer retry value')
    expect(second.result.current.saveFailed).toBe(true)
    expect(queryClient.getQueryData(noteKey)).toEqual({ note: 'Old retry value', revision })
    expect(setFriendNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ note: 'Newer retry value' })
    )

    act(() => resolves[1]?.({ ok: true }))
    await waitFor(() => expect(second.result.current.saveFailed).toBe(false))
    expect(second.result.current.value).toBe('Newer retry value')
    expect(queryClient.getQueryData(noteKey)).toEqual({ note: 'Newer retry value', revision })
    await waitFor(() =>
      expect(friendNoteCoordinatorCountsForTests()).toEqual({ writers: 0, drafts: 1, failed: 0 })
    )
  })

  it('retains a post-boundary failure across remount even when the account id repeats', async () => {
    getFriendNote
      .mockResolvedValueOnce({ note: 'Account A', revision: makeRevision('reused-id', 1) })
      .mockResolvedValueOnce({ note: 'Account B', revision: makeRevision('reused-id', 1) })
      .mockResolvedValueOnce({ note: 'Account B', revision: makeRevision('reused-id', 1) })
    setFriendNote.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Account A'))
    act(() => fireIdentityBoundary('vrchat'))
    await waitFor(() => expect(first.result.current.value).toBe('Account B'))
    act(() => first.result.current.setValue('Account B failed draft'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true))
    first.unmount()

    const second = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(second.result.current.value).toBe('Account B failed draft'))
    expect(second.result.current.saveFailed).toBe(true)
  })

  it('keeps the oldest failed friend actionable after 129 other failed friends', async () => {
    let friendZeroAttempts = 0
    getFriendNote.mockResolvedValue({ note: 'Original', revision: makeRevision('same-account', 1) })
    setFriendNote.mockImplementation(({ friendId }: { friendId: string }) => {
      if (friendId === 'usr_0') {
        friendZeroAttempts += 1
        return Promise.resolve(
          friendZeroAttempts === 1 ? { ok: false, reason: 'unavailable' } : { ok: true }
        )
      }
      return Promise.resolve({ ok: false, reason: 'unavailable' })
    })
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_0' }, wrapper: createWrapper() }
    )

    for (let index = 0; index <= 129; index += 1) {
      if (index > 0) rerender({ friendId: `usr_${index}` })
      await waitFor(() => expect(result.current.value).toBe('Original'))
      act(() => result.current.setValue(`failed ${index}`))
      act(() => result.current.onBlur())
      await waitFor(() => expect(result.current.saveFailed).toBe(true))
    }

    rerender({ friendId: 'usr_0' })
    await waitFor(() => expect(result.current.value).toBe('failed 0'))
    expect(result.current.saveFailed).toBe(true)
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.saveFailed).toBe(false))
    expect(setFriendNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ friendId: 'usr_0', note: 'failed 0' })
    )
  }, 15_000)

  it('keeps a pending friend write across 129 other touched keys without duplicate blur saves', async () => {
    let resolveSave: (value: { ok: true }) => void = () => {}
    const revision = makeRevision('same-account', 1)
    getFriendNote.mockResolvedValue({ note: 'Original', revision })
    setFriendNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const first = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_0' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(first.result.current.value).toBe('Original'))
    act(() => first.result.current.setValue('pending zero'))
    act(() => first.result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledOnce())
    first.unmount()

    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_1' }, wrapper: createWrapper(false, queryClient) }
    )
    for (let index = 1; index <= 129; index += 1) {
      if (index > 1) rerender({ friendId: `usr_${index}` })
      act(() => result.current.setValue(`touched ${index}`))
    }
    const remount = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_0' }), {
      wrapper: createWrapper(false, queryClient)
    })
    await waitFor(() => expect(remount.result.current.value).toBe('pending zero'))
    act(() => remount.result.current.onBlur())
    expect(setFriendNote).toHaveBeenCalledOnce()

    act(() => resolveSave({ ok: true }))
    await waitFor(() =>
      expect(queryClient.getQueryData(['friend-note', 'vrchat', 'usr_0', 0])).toEqual({
        note: 'pending zero',
        revision
      })
    )
    expect(remount.result.current.saveFailed).toBe(false)
  })
})
