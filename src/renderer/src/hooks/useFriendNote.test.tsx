// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFriendNote } from './useFriendNote'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useFriendNote', () => {
  let getFriendNote: ReturnType<typeof vi.fn>
  let setFriendNote: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getFriendNote = vi.fn().mockResolvedValue({ note: null })
    setFriendNote = vi.fn().mockResolvedValue({ ok: true })
    window.vrx = { getFriendNote, setFriendNote } as unknown as Window['vrx']
  })

  it('loads the saved note when the friend changes', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note' })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

    await waitFor(() => expect(result.current.value).toBe('Saved note'))
    expect(getFriendNote).toHaveBeenCalledOnce()
    expect(getFriendNote).toHaveBeenCalledWith({ platform: 'vrchat', friendId: 'usr_a' })
  })

  it('blurs once when the note changed', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note' })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.setValue('Updated note'))
    act(() => result.current.onBlur())

    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))
    expect(setFriendNote).toHaveBeenCalledWith({
      platform: 'vrchat',
      friendId: 'usr_a',
      note: 'Updated note'
    })
  })

  it('does not call setFriendNote on blur when the note is unchanged', async () => {
    getFriendNote.mockResolvedValue({ note: 'Saved note' })
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
    getFriendNote.mockResolvedValue({ note: 'Saved note' })
    setFriendNote
      .mockResolvedValueOnce({ ok: false, reason: 'stale' })
      .mockResolvedValueOnce({ ok: true })
    const { result } = renderHook(() => useFriendNote({ platform: 'vrchat', friendId: 'usr_a' }))

    await waitFor(() => expect(result.current.value).toBe('Saved note'))

    act(() => result.current.setValue('Try again'))
    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(1))

    act(() => result.current.onBlur())
    await waitFor(() => expect(setFriendNote).toHaveBeenCalledTimes(2))
  })
})
