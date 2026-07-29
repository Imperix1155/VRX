// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFriendNote } from './useFriendNote'
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

  it('retries a failed save on the next blur', async () => {
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
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveSave({ ok: false, reason: 'stale' })
      await Promise.resolve()
    })

    await waitFor(() => expect(getFriendNote).toHaveBeenCalledTimes(2))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
    expect(setFriendNote).toHaveBeenLastCalledWith({
      platform: 'vrchat',
      friendId: 'usr_a',
      note: 'Try again',
      revision: makeRevision('self', 2)
    })
  })

  it('clears all note state on identity-boundary and refetches', async () => {
    getFriendNote
      .mockResolvedValueOnce({ note: 'Account A', revision: makeRevision('a', 1) })
      .mockResolvedValueOnce({ note: 'Account B', revision: makeRevision('b', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_x' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.value).toBe('Account A'))
    expect(getFriendNote).toHaveBeenCalledTimes(1)

    act(() => fireIdentityBoundary('vrchat'))
    expect(result.current.value).toBe('')

    await waitFor(() => expect(result.current.value).toBe('Account B'))
    expect(getFriendNote).toHaveBeenCalledTimes(2)
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
})
