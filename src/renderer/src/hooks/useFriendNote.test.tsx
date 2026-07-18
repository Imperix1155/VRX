// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFriendNote } from './useFriendNote'

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
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

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

  it('does not call setFriendNote on blur when the note is unchanged', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.onBlur())

    await waitFor(() => expect(setFriendNote).not.toHaveBeenCalled())
  })

  it('caps the draft at 500 characters', () => {
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

    act(() => result.current.setValue('a'.repeat(501)))
    expect(result.current.value).toHaveLength(500)
  })

  it('renders empty and read-only when the preload bridge is absent', () => {
    Object.defineProperty(window, 'vrx', { configurable: true, value: undefined })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

    expect(result.current.value).toBe('')
    act(() => result.current.setValue('Local only'))
    act(() => result.current.onBlur())
    expect(result.current.value).toBe('Local only')
    expect(getFriendNote).not.toHaveBeenCalled()
  })

  it('retries a failed save on the next blur', async () => {
    let resolveSave: (value: { ok: boolean; reason?: string }) => void = () => {}
    getFriendNote.mockResolvedValue({ note: 'Saved note', revision: makeRevision('self', 1) })
    setFriendNote
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve
          })
      )
      .mockResolvedValueOnce({ ok: true })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.setValue('Try again'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveSave({ ok: false, reason: 'stale' })
      await Promise.resolve()
    })

    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
  })

  it('clears all note state on identity-boundary and refetches', async () => {
    getFriendNote
      .mockResolvedValueOnce({ note: 'Account A', revision: makeRevision('a', 1) })
      .mockResolvedValueOnce({ note: 'Account B', revision: makeRevision('b', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_x' }))

    await waitFor(() => expect(result.current.value).toBe('Account A'))
    expect(getFriendNote).toHaveBeenCalledTimes(1)

    act(() => fireIdentityBoundary('vrchat'))
    expect(result.current.value).toBe('')

    await waitFor(() => expect(result.current.value).toBe('Account B'))
    expect(getFriendNote).toHaveBeenCalledTimes(2)
  })

  it('skips save without a fresh revision after an identity-boundary', async () => {
    getFriendNote.mockResolvedValue({ note: 'Account A', revision: makeRevision('a', 1) })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_x' }))

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
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

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
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

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

    // Resolve "First" → the queue drains and sends "Second".
    act(() => saveResolvers[0]?.({ ok: true }))
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
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

  it('carries the sequence counter across friend switches so stale completions never match', async () => {
    const saveResolvers: Array<(value: { ok: boolean }) => void> = []
    getFriendNote.mockImplementation((req: { platform: string; friendId: string }) => {
      const note = req.friendId === 'usr_a' ? 'A-note' : 'B-note'
      return Promise.resolve({ note, revision: makeRevision('self', 1) })
    })
    setFriendNote.mockImplementation(
      () =>
        new Promise((resolve) => {
          saveResolvers.push(resolve)
        })
    )
    const { result, rerender } = renderHook(
      ({ friendId }: { friendId: string }) => useFriendNote({ platform: 'vrchat', friendId }),
      { initialProps: { friendId: 'usr_a' } }
    )

    await waitFor(() => expect(result.current.value).toBe('A-note'))

    // Start a save for friend A (seq 1).
    act(() => result.current.setValue('A-first'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    // Switch to friend B; the counter carries forward (nextSeq becomes 2).
    rerender({ friendId: 'usr_b' })
    await waitFor(() => expect(result.current.value).toBe('B-note'))

    act(() => result.current.setValue('B-save'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))

    // Switch back to friend A; the counter still carries forward (nextSeq becomes 3).
    rerender({ friendId: 'usr_a' })
    await waitFor(() => expect(result.current.value).toBe('A-note'))

    act(() => result.current.setValue('A-third'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(3))

    // The stale completion for the first A save (seq 1) must not affect the
    // current A save (seq 3).
    act(() => saveResolvers[0]?.({ ok: true }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.value).toBe('A-third')
    expect(setFriendNote).toHaveBeenCalledTimes(3)

    // Resolve the current A save normally.
    act(() => saveResolvers[2]?.({ ok: true }))
    await waitFor(() => expect(result.current.value).toBe('A-third'))
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
      { initialProps: { friendId: 'usr_a' } }
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
