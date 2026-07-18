// @vitest-environment jsdom
/**
 * useSettingsPersistence tests (VRX-184, VRX-212).
 *
 * jsdom renders client-side, so the REAL zustand store applies (the SSR
 * store-snapshot trap only bites renderToStaticMarkup tests). window.vrx is
 * stubbed per test; the store is reset after each.
 *
 * The two race regressions (Codex [high], PR #116) are pinned with manually
 * controlled promises: saves must be GATED until the boot load lands (an
 * early save would patch defaults over the on-disk file), and a stale save
 * resolving late must never mark newer unsaved settings clean.
 *
 * VRX-212 adds the hydration gate: the store flips `hydrated` true once the
 * initial load resolves (success or failure), or immediately when the bridge
 * is absent.
 */
import { act, render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { useSettingsPersistence } from './useSettingsPersistence'

function Probe(): React.JSX.Element {
  useSettingsPersistence()
  return <></>
}

const PERSISTED: Settings = { ...DEFAULT_SETTINGS, theme: 'dark', labelScheme: 'chilloutvr' }

type Bridge = {
  getSettings: ReturnType<typeof vi.fn>
  saveSettings: ReturnType<typeof vi.fn>
}

function stubBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge: Bridge = {
    getSettings: vi.fn().mockResolvedValue({ ...PERSISTED }),
    saveSettings: vi
      .fn()
      .mockImplementation((req: { patch: Settings }) => Promise.resolve(req.patch)),
    ...overrides
  }
  Object.assign(window, { vrx: bridge })
  return bridge
}

/** A promise with its resolver exposed, for hand-driven async ordering. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const storeState = (): { settings: Settings; dirty: boolean; hydrated: boolean } => {
  const { settings, dirty, hydrated } = useSettingsStore.getState()
  return { settings, dirty, hydrated }
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false, hydrated: false })
  Reflect.deleteProperty(window, 'vrx')
})

describe('useSettingsPersistence', () => {
  it('loads persisted settings into the store on mount (dirty stays false)', async () => {
    stubBridge()
    render(<Probe />)
    await waitFor(() => expect(storeState().settings.theme).toBe('dark'))
    expect(storeState().dirty).toBe(false)
    expect(storeState().hydrated).toBe(true)
  })

  it('saves on a dirty change (after the load settles) and marks the store clean', async () => {
    const bridge = stubBridge()
    render(<Probe />)
    await waitFor(() => expect(storeState().settings.theme).toBe('dark'))
    act(() => useSettingsStore.getState().updateSettings({ labelScheme: 'platform-native' }))
    await waitFor(() => expect(storeState().dirty).toBe(false))
    // The patch carries the persisted baseline + the edit — never bare defaults.
    expect(bridge.saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ labelScheme: 'platform-native', theme: 'dark' })
    })
  })

  it('GATES saves until the boot load lands, then merges boot-window edits over persisted values', async () => {
    const load = deferred<Settings>()
    const bridge = stubBridge({ getSettings: vi.fn().mockReturnValue(load.promise) })
    render(<Probe />)

    // Edit while the load is still in flight — must NOT trigger a save (a
    // default-seeded patch would wipe unrelated persisted fields on disk).
    act(() => useSettingsStore.getState().updateSettings({ density: 'compact' }))
    await act(() => Promise.resolve())
    expect(bridge.saveSettings).not.toHaveBeenCalled()
    expect(storeState().hydrated).toBe(false)

    act(() => load.resolve({ ...PERSISTED }))
    // The edit survives ON TOP of the persisted values...
    await waitFor(() => expect(storeState().settings.density).toBe('compact'))
    expect(storeState().settings.theme).toBe('dark')
    expect(storeState().settings.labelScheme).toBe('chilloutvr')
    expect(storeState().hydrated).toBe(true)
    // ...and the now-ungated save persists the MERGE, not defaults.
    await waitFor(() => expect(storeState().dirty).toBe(false))
    expect(bridge.saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({
        density: 'compact',
        theme: 'dark',
        labelScheme: 'chilloutvr'
      })
    })
  })

  it('a stale save resolving late never marks newer unsaved settings clean', async () => {
    const first = deferred<Settings>()
    const second = deferred<Settings>()
    const bridge = stubBridge({
      saveSettings: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    })
    render(<Probe />)
    await waitFor(() => expect(storeState().settings.theme).toBe('dark'))

    act(() => useSettingsStore.getState().updateSettings({ theme: 'light' }))
    await waitFor(() => expect(bridge.saveSettings).toHaveBeenCalledTimes(1))
    // A NEWER change lands while the first save is still in flight.
    act(() => useSettingsStore.getState().updateSettings({ density: 'compact' }))
    await waitFor(() => expect(bridge.saveSettings).toHaveBeenCalledTimes(2))

    // The stale save resolves — the store must STAY dirty (snapshot mismatch).
    await act(async () => {
      first.resolve({ ...PERSISTED, theme: 'light' })
      await Promise.resolve()
    })
    expect(storeState().dirty).toBe(true)

    // The latest save resolves — NOW it is clean.
    await act(async () => {
      second.resolve({ ...PERSISTED, theme: 'light', density: 'compact' })
      await Promise.resolve()
    })
    await waitFor(() => expect(storeState().dirty).toBe(false))
  })

  it('leaves the store dirty when the save is refused', async () => {
    const bridge = stubBridge({
      saveSettings: vi.fn().mockRejectedValue(new Error('newer version'))
    })
    render(<Probe />)
    await waitFor(() => expect(storeState().settings.theme).toBe('dark'))
    act(() => useSettingsStore.getState().updateSettings({ theme: 'light' }))
    await waitFor(() => expect(bridge.saveSettings).toHaveBeenCalled())
    await act(() => Promise.resolve())
    expect(storeState().dirty).toBe(true)
    expect(storeState().settings.theme).toBe('light')
  })

  it('keeps saves disabled for the whole session when the load fails (no baseline to patch over)', async () => {
    const bridge = stubBridge({
      getSettings: vi.fn().mockRejectedValue(new Error('bridge broke'))
    })
    render(<Probe />)
    await waitFor(() => expect(bridge.getSettings).toHaveBeenCalled())
    await act(() => Promise.resolve())
    expect(storeState().hydrated).toBe(true)
    act(() => useSettingsStore.getState().updateSettings({ theme: 'light' }))
    await act(() => Promise.resolve())
    expect(bridge.saveSettings).not.toHaveBeenCalled()
    expect(storeState().settings.theme).toBe('light')
  })

  it('hydrates immediately when the load fails so the UI is not trapped', async () => {
    const bridge = stubBridge({
      getSettings: vi.fn().mockRejectedValue(new Error('bridge broke'))
    })
    render(<Probe />)
    await waitFor(() => expect(bridge.getSettings).toHaveBeenCalled())
    await waitFor(() => expect(storeState().hydrated).toBe(true))
  })

  it('no-ops without the bridge (Preview/tests) — stays in-memory, never throws, and hydrates immediately', () => {
    render(<Probe />)
    act(() => useSettingsStore.getState().updateSettings({ theme: 'light' }))
    expect(storeState().settings.theme).toBe('light')
    expect(storeState().dirty).toBe(true)
    expect(storeState().hydrated).toBe(true)
  })
})
