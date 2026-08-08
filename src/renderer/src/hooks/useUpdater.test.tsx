// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUpdater } from './useUpdater'
import type { UpdaterSnapshot } from '@shared/ipc'

const DEFAULT_SNAPSHOT: UpdaterSnapshot = {
  state: 'idle',
  currentVersion: '0.14.0',
  availableVersion: null,
  progressPercent: 0,
  errorMessage: null
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function createBridge(): {
  getUpdaterState: ReturnType<typeof vi.fn>
  onUpdaterStateChanged: ReturnType<typeof vi.fn>
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  installUpdate: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
  firePush: (snapshot: UpdaterSnapshot) => void
  resolveFetch: (snapshot: UpdaterSnapshot) => void
} {
  let fetchResolver: ((snapshot: UpdaterSnapshot) => void) | null = null
  const callbacks: Array<(snapshot: UpdaterSnapshot) => void> = []
  const unsubscribe = vi.fn()

  const getUpdaterState = vi.fn(
    () =>
      new Promise<UpdaterSnapshot>((resolve) => {
        fetchResolver = resolve
      })
  )

  const onUpdaterStateChanged = vi.fn((cb: (snapshot: UpdaterSnapshot) => void) => {
    callbacks.push(cb)
    return unsubscribe
  })

  const firePush = (snapshot: UpdaterSnapshot): void => {
    callbacks.forEach((cb) => cb(snapshot))
  }

  const resolveFetch = (snapshot: UpdaterSnapshot): void => {
    fetchResolver?.(snapshot)
  }

  return {
    getUpdaterState,
    onUpdaterStateChanged,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    unsubscribe,
    firePush,
    resolveFetch
  }
}

describe('useUpdater', () => {
  let bridge: ReturnType<typeof createBridge>

  beforeEach(() => {
    bridge = createBridge()
    window.vrx = {
      getUpdaterState: bridge.getUpdaterState,
      onUpdaterStateChanged: bridge.onUpdaterStateChanged,
      checkForUpdates: bridge.checkForUpdates,
      downloadUpdate: bridge.downloadUpdate,
      installUpdate: bridge.installUpdate
    } as unknown as Window['vrx']
  })

  it('hydrates from getUpdaterState', async () => {
    const available: UpdaterSnapshot = {
      ...DEFAULT_SNAPSHOT,
      state: 'update-available',
      availableVersion: '0.15.0'
    }

    const { result } = renderHook(() => useUpdater())
    act(() => {
      bridge.resolveFetch(available)
    })
    await waitFor(() => expect(result.current.state.state).toBe('update-available'))
    expect(result.current.state.availableVersion).toBe('0.15.0')
  })

  it('updates from updater:state-changed pushes', async () => {
    const { result } = renderHook(() => useUpdater())
    act(() => {
      bridge.resolveFetch(DEFAULT_SNAPSHOT)
    })
    await waitFor(() => expect(result.current.state.state).toBe('idle'))

    act(() => {
      bridge.firePush({ ...DEFAULT_SNAPSHOT, state: 'checking' })
    })
    expect(result.current.state.state).toBe('checking')
  })

  it('keeps the push if it arrives before getUpdaterState resolves', async () => {
    const { result } = renderHook(() => useUpdater())

    act(() => {
      bridge.firePush({ ...DEFAULT_SNAPSHOT, state: 'downloaded' })
    })
    expect(result.current.state.state).toBe('downloaded')

    act(() => {
      bridge.resolveFetch({ ...DEFAULT_SNAPSHOT, state: 'update-available' })
    })
    await waitFor(() => expect(result.current.state.state).toBe('downloaded'))
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useUpdater())
    expect(bridge.onUpdaterStateChanged).toHaveBeenCalledOnce()
    unmount()
    expect(bridge.unsubscribe).toHaveBeenCalledOnce()
  })

  it('actions swallow bridge rejections', async () => {
    bridge.checkForUpdates.mockRejectedValue(new Error('rate_limited'))
    bridge.downloadUpdate.mockRejectedValue(new Error('rate_limited'))
    bridge.installUpdate.mockRejectedValue(new Error('rate_limited'))

    const { result } = renderHook(() => useUpdater())
    act(() => {
      bridge.resolveFetch(DEFAULT_SNAPSHOT)
    })
    await waitFor(() => expect(result.current.state.state).toBe('idle'))

    await expect(result.current.check()).resolves.toBeUndefined()
    await expect(result.current.download()).resolves.toBeUndefined()
    await expect(result.current.install()).resolves.toBeUndefined()
  })
})
