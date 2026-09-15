// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplorePlatformSnapshot, ExploreWorld, ExploreWorldSnapshot } from '@shared/explore'
import { QueryClientProvider } from '@tanstack/react-query'
import type { AuthStatus } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import { queryClient } from '../queries/queryClient'
import ExploreRoute, { ExploreDashboardPreviewRoute } from './ExploreRoute'

const query = vi.hoisted(() => ({
  vrc: undefined as ExplorePlatformSnapshot | undefined,
  cvr: undefined as ExplorePlatformSnapshot | undefined,
  requestExplore: vi.fn(),
  readExploreSnapshot: vi.fn(),
  requestExploreImage: vi.fn()
}))

vi.mock('../queries/explore', () => ({
  useExploreSnapshot: (platform: 'vrchat' | 'chilloutvr') => ({
    data: platform === 'vrchat' ? query.vrc : query.cvr
  }),
  useExploreCachedSnapshot: (platform: 'vrchat' | 'chilloutvr') =>
    platform === 'vrchat' ? query.vrc : query.cvr,
  requestExplore: query.requestExplore,
  readExploreSnapshot: query.readExploreSnapshot,
  requestExploreImage: query.requestExploreImage
}))

const auth = vi.hoisted(() => ({
  vrc: {} as AuthStatus,
  cvr: {} as AuthStatus
}))

vi.mock('../hooks/useExploreImage', () => ({
  useExploreImage: () => ({ ref: () => undefined, image: undefined })
}))

vi.mock('../hooks/useJoinInstance', () => ({
  useJoinInstance: () => ({
    isJoining: false,
    joinExplore: vi.fn(),
    joinExploreFailureFor: () => null,
    pendingConfirm: null
  })
}))

const world: ExploreWorld = {
  platform: 'vrchat',
  worldId: 'world',
  worldRef: 'world-ref',
  name: 'A world',
  thumbnailUrl: null,
  activity: { state: 'complete', value: 5, source: 'vrc-world-occupants' },
  visibleRoomCount: { state: 'complete', value: 1, source: 'visible-rooms' },
  popularity: null,
  sourceOrder: 0
}

const source: ExplorePlatformSnapshot = {
  platform: 'vrchat',
  worlds: [world],
  status: 'ready',
  problem: null,
  isStale: false,
  updatedAt: 1
}

const loading: ExploreWorldSnapshot = {
  ...source,
  world,
  rooms: [],
  roomsComplete: false,
  status: 'loading'
}

const ready: ExploreWorldSnapshot = {
  ...source,
  world,
  rooms: [
    {
      platform: 'vrchat',
      worldId: 'world',
      roomId: 'room',
      access: 'public',
      region: null,
      groupName: null,
      occupancy: { state: 'complete', value: 5, source: 'vrc-room-n-users' },
      capacity: 20,
      full: false,
      action: { state: 'available', selectionRef: 'selection' }
    }
  ],
  roomsComplete: true,
  status: 'ready'
}

let changed: ((event: { platform: 'vrchat' | 'chilloutvr' }) => void) | undefined
let boundary: ((event: { platform: 'vrchat' | 'chilloutvr' }) => void) | undefined
let worldReads: ReturnType<typeof vi.fn>

beforeEach(() => {
  const updatedAt = Date.now()
  source.updatedAt = updatedAt
  loading.updatedAt = updatedAt
  ready.updatedAt = updatedAt
  query.vrc = source
  query.cvr = undefined
  query.requestExplore.mockReset()
  query.readExploreSnapshot.mockReset()
  query.requestExploreImage.mockResolvedValue(undefined)
  auth.vrc = { platform: 'vrchat', state: 'authenticated', accountId: 'vrc', displayName: 'VRC' }
  auth.cvr = {
    platform: 'chilloutvr',
    state: 'authenticated',
    accountId: 'cvr',
    displayName: 'CVR'
  }
  queryClient.setQueryData(['auth-status', 'vrchat'], auth.vrc)
  queryClient.setQueryData(['auth-status', 'chilloutvr'], auth.cvr)
  changed = undefined
  boundary = undefined
  worldReads = vi.fn().mockResolvedValue(loading)
  window.vrx = {
    getExploreWorld: worldReads,
    cancelExploreWorld: vi.fn().mockResolvedValue(undefined),
    onIdentityBoundary: (listener: typeof boundary) => {
      boundary = listener
      return () => {
        boundary = undefined
      }
    },
    onExploreChanged: (listener: (event: { platform: 'vrchat' | 'chilloutvr' }) => void) => {
      changed = listener
      return () => {
        if (changed === listener) changed = undefined
      }
    }
  } as unknown as Window['vrx']
  useFriendsStore.setState({ platformFilter: 'all' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  queryClient.removeQueries({ queryKey: ['auth-status'] })
})

describe('ExploreRoute world sheet', () => {
  it('keeps the sheet open when open starts loading, then uses only a cache snapshot on Explore change', async () => {
    render(<ExploreRoute />)
    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))

    expect(
      await screen.findByRole('dialog', { name: 'Visible public rooms for A world on VRChat' })
    ).toBeTruthy()
    expect(screen.getByText('Loading visible public rooms…')).toBeTruthy()
    expect(worldReads).toHaveBeenCalledWith({
      platform: 'vrchat',
      worldRef: 'world-ref',
      reason: 'open'
    })

    worldReads.mockResolvedValueOnce(ready)
    await act(async () => {
      changed?.({ platform: 'vrchat' })
      await Promise.resolve()
    })
    expect(worldReads).toHaveBeenLastCalledWith({
      platform: 'vrchat',
      worldRef: 'world-ref',
      reason: 'snapshot'
    })
    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy()
  })

  it('uses the explicit sheet refresh instead of a hidden retry', async () => {
    worldReads.mockResolvedValue({ ...ready, isStale: true })
    render(<ExploreRoute />)
    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
    expect(await screen.findByText('Showing saved results while refreshing.')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[1]!)
    await waitFor(() =>
      expect(worldReads).toHaveBeenLastCalledWith({
        platform: 'vrchat',
        worldRef: 'world-ref',
        reason: 'manual'
      })
    )
  })

  it('recovers an expired opaque reference from the cache before opening the sheet', async () => {
    const renewedWorld = { ...world, worldRef: 'renewed-ref', name: 'Renamed world' }
    query.readExploreSnapshot.mockResolvedValue({ ...source, worlds: [renewedWorld] })
    query.requestExploreImage.mockResolvedValue('data:image/png;base64,renewed')
    worldReads.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...ready, world: renewedWorld })
    render(<ExploreRoute />)

    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))

    expect(
      await screen.findByRole('dialog', {
        name: 'Visible public rooms for Renamed world on VRChat'
      })
    ).toBeTruthy()
    expect(query.readExploreSnapshot).toHaveBeenCalledWith('vrchat')
    expect(worldReads).toHaveBeenLastCalledWith({
      platform: 'vrchat',
      worldRef: 'renewed-ref',
      reason: 'open'
    })
    expect(query.requestExploreImage).toHaveBeenCalledWith('vrchat', 'renewed-ref')
  })

  it('closes the sheet if the renewed-ref open rejects', async () => {
    query.readExploreSnapshot.mockResolvedValue({
      ...source,
      worlds: [{ ...world, worldRef: 'renewed-ref' }]
    })
    worldReads.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('bridge closed'))
    render(<ExploreRoute />)

    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
    await waitFor(() =>
      expect(window.vrx!.cancelExploreWorld).toHaveBeenCalledWith({
        platform: 'vrchat',
        worldRef: 'renewed-ref'
      })
    )
    expect(screen.queryByRole('dialog', { name: /Visible public rooms/ })).toBeNull()
  })

  it('advances a recovered loading sheet from its renewed ref after an Explore change', async () => {
    const renewedWorld = { ...world, worldRef: 'renewed-ref' }
    let resolveImage!: (value: string) => void
    query.requestExploreImage.mockImplementation((_platform: string, ref: string) =>
      ref === 'renewed-ref'
        ? new Promise<string>((resolve) => {
            resolveImage = resolve
          })
        : Promise.resolve(undefined)
    )
    query.readExploreSnapshot.mockResolvedValue({ ...source, worlds: [renewedWorld] })
    worldReads
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...loading, world: renewedWorld })
      .mockResolvedValueOnce({ ...ready, world: renewedWorld })
    render(<ExploreRoute />)

    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
    expect(await screen.findByText('Loading visible public rooms…')).toBeTruthy()

    await act(async () => {
      changed?.({ platform: 'vrchat' })
      await Promise.resolve()
    })
    expect(worldReads).toHaveBeenLastCalledWith({
      platform: 'vrchat',
      worldRef: 'renewed-ref',
      reason: 'snapshot'
    })
    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy()
    await act(async () => {
      resolveImage('data:image/png;base64,after-ready')
    })
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,after-ready'
    )
  })

  it('does not let an old-ref image replace recovered sheet art', async () => {
    const renewedWorld = { ...world, worldRef: 'renewed-ref' }
    let resolveOldImage!: (value: string | undefined) => void
    query.readExploreSnapshot.mockResolvedValue({ ...source, worlds: [renewedWorld] })
    query.requestExploreImage.mockImplementation((_platform: string, worldRef: string) =>
      worldRef === 'world-ref'
        ? new Promise<string | undefined>((resolve) => {
            resolveOldImage = resolve
          })
        : Promise.resolve('data:image/png;base64,renewed')
    )
    worldReads.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...ready, world: renewedWorld })
    render(<ExploreRoute />)

    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Visible public rooms for A world on VRChat'
    })
    await waitFor(() =>
      expect(dialog.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,renewed')
    )
    await act(async () => {
      resolveOldImage('data:image/png;base64,old')
    })
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,renewed')
  })

  it('queues invalidations during expired-ref recovery and reads the renewed ref afterward', async () => {
    const renewedWorld = { ...world, worldRef: 'renewed-ref' }
    let finishRecovery!: (value: ExplorePlatformSnapshot) => void
    query.readExploreSnapshot.mockImplementation(
      () =>
        new Promise<ExplorePlatformSnapshot>((resolve) => {
          finishRecovery = resolve
        })
    )
    worldReads.mockImplementation(({ worldRef, reason }) =>
      Promise.resolve(
        worldRef === 'world-ref'
          ? null
          : { ...(reason === 'open' ? loading : ready), world: renewedWorld }
      )
    )
    render(<ExploreRoute />)
    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
    await waitFor(() => expect(query.readExploreSnapshot).toHaveBeenCalledOnce())
    await act(async () => {
      changed?.({ platform: 'vrchat' })
      changed?.({ platform: 'vrchat' })
      await Promise.resolve()
    })
    expect(worldReads).toHaveBeenCalledOnce()
    await act(async () => {
      finishRecovery({ ...source, worlds: [renewedWorld] })
    })
    expect(await screen.findByRole('button', { name: 'Join' })).toBeTruthy()
    expect(worldReads.mock.calls.map(([request]) => request)).toEqual([
      { platform: 'vrchat', worldRef: 'world-ref', reason: 'open' },
      { platform: 'vrchat', worldRef: 'renewed-ref', reason: 'open' },
      { platform: 'vrchat', worldRef: 'renewed-ref', reason: 'snapshot' }
    ])
  })

  it('does not reopen with a recovered reference after an account boundary', async () => {
    let resolveSnapshot!: (value: ExplorePlatformSnapshot) => void
    query.readExploreSnapshot.mockImplementation(
      () =>
        new Promise<ExplorePlatformSnapshot>((resolve) => {
          resolveSnapshot = resolve
        })
    )
    worldReads.mockResolvedValue(null)
    render(<ExploreRoute />)

    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
    await waitFor(() => expect(query.readExploreSnapshot).toHaveBeenCalledWith('vrchat'))
    await act(async () => {
      changed?.({ platform: 'vrchat' })
      await Promise.resolve()
    })
    act(() => boundary?.({ platform: 'vrchat' }))
    await act(async () => {
      resolveSnapshot({ ...source, worlds: [{ ...world, worldRef: 'renewed-ref' }] })
    })

    expect(worldReads).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: /Visible public rooms/ })).toBeNull()
  })

  it('does not publish an old world response after the selected platform is filtered out', async () => {
    let resolve!: (value: ExploreWorldSnapshot) => void
    worldReads.mockImplementation(
      () =>
        new Promise<ExploreWorldSnapshot>((finish) => {
          resolve = finish
        })
    )
    render(<ExploreRoute />)
    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
    await waitFor(() => expect(worldReads).toHaveBeenCalledOnce())
    act(() => useFriendsStore.setState({ platformFilter: 'chilloutvr' }))
    await act(async () => {
      resolve(ready)
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog', { name: /Visible public rooms/ })).toBeNull()
  })

  it('shows the existing unavailable source state for a selected disconnected platform', () => {
    auth.cvr = {
      platform: 'chilloutvr',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    }
    queryClient.setQueryData(['auth-status', 'chilloutvr'], auth.cvr)
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    render(<ExploreRoute />)

    expect(screen.getByText('ChilloutVR discovery is unavailable.')).toBeTruthy()
    expect(query.requestExplore).not.toHaveBeenCalled()
  })

  it('reads stale auth on mount and remount without an authentication request', async () => {
    auth.cvr = {
      platform: 'chilloutvr',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    }
    queryClient.setQueryData(['auth-status', 'chilloutvr'], auth.cvr, {
      updatedAt: Date.now() - 31_000
    })
    const getAuthStatus = vi.fn(async () => auth.cvr)
    window.vrx = { ...(window.vrx ?? {}), getAuthStatus } as unknown as Window['vrx']
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    const route = (
      <QueryClientProvider client={queryClient}>
        <ExploreRoute />
      </QueryClientProvider>
    )
    const first = render(route)
    expect(screen.getByText('ChilloutVR discovery is unavailable.')).toBeTruthy()
    await act(async () => {
      await Promise.resolve()
    })
    first.unmount()
    render(route)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('ChilloutVR discovery is unavailable.')).toBeTruthy()
    expect(getAuthStatus).not.toHaveBeenCalled()
  })

  it('keeps the healthy platform cards while naming the disconnected source', () => {
    queryClient.setQueryData(['auth-status', 'chilloutvr'], {
      platform: 'chilloutvr',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
    render(<ExploreRoute />)
    expect(screen.getByRole('button', { name: /open visible rooms for a world/i })).toBeTruthy()
    expect(screen.getByText('ChilloutVR discovery is unavailable.')).toBeTruthy()
    expect(query.requestExplore).not.toHaveBeenCalled()
  })

  it.each(['Close', 'Escape'] as const)(
    'restores focus on %s after an empty preview unmounts the outgoing handoff sheet',
    async (dismiss) => {
      const view = (dismissSignal: number): React.JSX.Element => (
        <>
          <button>Sibling sheet</button>
          <ExploreDashboardPreviewRoute dismissSignal={dismissSignal} />
        </>
      )
      const { rerender } = render(view(0))
      fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
      await screen.findByRole('dialog', { name: /Visible public rooms/ })

      query.vrc = { ...source, worlds: [] }
      rerender(view(0))
      expect(screen.queryByRole('dialog', { name: /Visible public rooms/ })).toBeNull()
      const sibling = screen.getByRole('button', { name: 'Sibling sheet' })
      sibling.focus()
      rerender(view(1))
      expect(document.activeElement).toBe(sibling)

      query.vrc = source
      rerender(view(1))
      const opener = screen.getByRole('button', { name: /open visible rooms for a world/i })
      opener.focus()
      fireEvent.click(opener)
      await screen.findByRole('dialog', { name: /Visible public rooms/ })
      if (dismiss === 'Close') fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      else fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('dialog', { name: /Visible public rooms/ })).toBeNull()
      expect(document.activeElement).toBe(opener)
      expect(query.requestExplore).not.toHaveBeenCalled()
    }
  )

  it('gives the Dashboard preview the same changed-snapshot and explicit refresh behavior', async () => {
    worldReads.mockResolvedValue({ ...ready, isStale: true })
    render(<ExploreDashboardPreviewRoute />)
    fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
    expect(await screen.findByText('Showing saved results while refreshing.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(worldReads).toHaveBeenLastCalledWith({
        platform: 'vrchat',
        worldRef: 'world-ref',
        reason: 'manual'
      })
    )
  })
})

for (const [label, Route] of [
  ['Explore', ExploreRoute],
  ['Dashboard', ExploreDashboardPreviewRoute]
] as const) {
  describe(`${label} selected-world lifetime`, () => {
    it('recovers each explicit stale-sheet refresh with the latest opaque reference', async () => {
      const renewedOnce = { ...world, worldRef: 'renewed-once' }
      const renewedTwice = { ...world, worldRef: 'renewed-twice' }
      query.readExploreSnapshot
        .mockResolvedValueOnce({ ...source, worlds: [renewedOnce] })
        .mockResolvedValueOnce({ ...source, worlds: [renewedTwice] })
      worldReads
        .mockResolvedValueOnce({ ...ready, isStale: true })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...ready, world: renewedOnce, isStale: true })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...ready, world: renewedTwice, isStale: true })
      render(<Route />)
      fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
      await screen.findByText('Showing saved results while refreshing.')

      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!)
      await waitFor(() => expect(worldReads).toHaveBeenCalledTimes(3))
      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!)
      await waitFor(() => expect(worldReads).toHaveBeenCalledTimes(5))

      expect(worldReads.mock.calls.map(([request]) => request)).toEqual([
        { platform: 'vrchat', worldRef: 'world-ref', reason: 'open' },
        { platform: 'vrchat', worldRef: 'world-ref', reason: 'manual' },
        { platform: 'vrchat', worldRef: 'renewed-once', reason: 'manual' },
        { platform: 'vrchat', worldRef: 'renewed-once', reason: 'manual' },
        { platform: 'vrchat', worldRef: 'renewed-twice', reason: 'manual' }
      ])
    })

    it('coalesces duplicate manual recovery and queues its renewed-ref invalidation', async () => {
      const renewedWorld = { ...world, worldRef: 'renewed-ref' }
      let finishRecovery!: (value: ExplorePlatformSnapshot) => void
      query.readExploreSnapshot.mockImplementation(
        () =>
          new Promise<ExplorePlatformSnapshot>((resolve) => {
            finishRecovery = resolve
          })
      )
      worldReads
        .mockResolvedValueOnce({ ...ready, isStale: true })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...loading, world: renewedWorld })
        .mockResolvedValueOnce({ ...ready, world: renewedWorld })
      render(<Route />)
      fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
      await screen.findByText('Showing saved results while refreshing.')

      const refresh = screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!
      fireEvent.click(refresh)
      fireEvent.click(refresh)
      await waitFor(() => expect(query.readExploreSnapshot).toHaveBeenCalledOnce())
      expect(worldReads).toHaveBeenCalledTimes(2)
      await act(async () => {
        changed?.({ platform: 'vrchat' })
        changed?.({ platform: 'vrchat' })
        await Promise.resolve()
      })

      await act(async () => {
        finishRecovery({ ...source, worlds: [renewedWorld] })
      })
      await waitFor(() => expect(worldReads).toHaveBeenCalledTimes(4))
      expect(worldReads.mock.calls.map(([request]) => request)).toEqual([
        { platform: 'vrchat', worldRef: 'world-ref', reason: 'open' },
        { platform: 'vrchat', worldRef: 'world-ref', reason: 'manual' },
        { platform: 'vrchat', worldRef: 'renewed-ref', reason: 'manual' },
        { platform: 'vrchat', worldRef: 'renewed-ref', reason: 'snapshot' }
      ])
    })

    it('defers an invalidation that arrives before the manual expiry result', async () => {
      const renewedWorld = { ...world, worldRef: 'renewed-ref' }
      let finishManual!: (value: null) => void
      query.readExploreSnapshot.mockResolvedValue({ ...source, worlds: [renewedWorld] })
      worldReads
        .mockResolvedValueOnce({ ...ready, isStale: true })
        .mockImplementationOnce(
          () =>
            new Promise<null>((resolve) => {
              finishManual = resolve
            })
        )
        .mockResolvedValueOnce({ ...loading, world: renewedWorld })
        .mockResolvedValueOnce({ ...ready, world: renewedWorld })
      render(<Route />)
      fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
      await screen.findByText('Showing saved results while refreshing.')
      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!)
      await waitFor(() => expect(worldReads).toHaveBeenCalledTimes(2))

      await act(async () => {
        changed?.({ platform: 'vrchat' })
        changed?.({ platform: 'vrchat' })
        await Promise.resolve()
      })
      expect(worldReads).toHaveBeenCalledTimes(2)
      expect(query.readExploreSnapshot).not.toHaveBeenCalled()

      await act(async () => {
        finishManual(null)
      })
      await waitFor(() => expect(worldReads).toHaveBeenCalledTimes(4))
      expect(worldReads.mock.calls.map(([request]) => request)).toEqual([
        { platform: 'vrchat', worldRef: 'world-ref', reason: 'open' },
        { platform: 'vrchat', worldRef: 'world-ref', reason: 'manual' },
        { platform: 'vrchat', worldRef: 'renewed-ref', reason: 'manual' },
        { platform: 'vrchat', worldRef: 'renewed-ref', reason: 'snapshot' }
      ])
    })

    it('closes instead of publishing a manual expired-ref recovery after a boundary', async () => {
      const renewedWorld = { ...world, worldRef: 'renewed-ref' }
      let finishRecovery!: (value: ExplorePlatformSnapshot) => void
      query.readExploreSnapshot.mockImplementation(
        () =>
          new Promise<ExplorePlatformSnapshot>((resolve) => {
            finishRecovery = resolve
          })
      )
      worldReads.mockResolvedValueOnce({ ...ready, isStale: true }).mockResolvedValueOnce(null)
      render(<Route />)
      fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
      await screen.findByText('Showing saved results while refreshing.')
      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!)
      await waitFor(() => expect(query.readExploreSnapshot).toHaveBeenCalledOnce())

      act(() => boundary?.({ platform: 'vrchat' }))
      await act(async () => {
        finishRecovery({ ...source, worlds: [renewedWorld] })
      })
      expect(worldReads).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('dialog', { name: /Visible public rooms/ })).toBeNull()
    })

    it('keeps the final changed snapshot when an older open reply arrives last', async () => {
      let finishOpen!: (value: ExploreWorldSnapshot) => void
      worldReads.mockImplementationOnce(
        () =>
          new Promise<ExploreWorldSnapshot>((resolve) => {
            finishOpen = resolve
          })
      )
      render(<Route />)
      fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
      worldReads.mockResolvedValueOnce({ ...ready, updatedAt: Date.now() })
      await act(async () => {
        changed?.({ platform: 'vrchat' })
      })
      expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
      await act(async () => {
        finishOpen(loading)
      })
      expect(screen.queryByText('Loading visible public rooms…')).toBeNull()
      expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
    })

    for (const reason of ['manual', 'snapshot'] as const) {
      for (const end of ['close', 'boundary', 'filter'] as const) {
        it(`discards a delayed ${reason} response after ${end}`, async () => {
          worldReads.mockResolvedValueOnce({ ...ready, isStale: true })
          render(<Route />)
          fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
          await screen.findByRole('dialog', { name: /Visible public rooms/ })
          let finish!: (value: ExploreWorldSnapshot) => void
          worldReads.mockImplementationOnce(
            () =>
              new Promise<ExploreWorldSnapshot>((resolve) => {
                finish = resolve
              })
          )
          if (reason === 'manual') {
            fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!)
          } else {
            act(() => changed?.({ platform: 'vrchat' }))
          }
          if (end === 'close') fireEvent.click(screen.getByRole('button', { name: 'Close' }))
          else if (end === 'boundary') act(() => boundary?.({ platform: 'vrchat' }))
          else act(() => useFriendsStore.setState({ platformFilter: 'chilloutvr' }))
          await act(async () => {
            finish(ready)
          })
          expect(screen.queryByRole('dialog', { name: /Visible public rooms/ })).toBeNull()
          expect(window.vrx!.cancelExploreWorld).toHaveBeenCalledWith({
            platform: 'vrchat',
            worldRef: 'world-ref'
          })
        })
      }
    }

    it('marks a held sheet stale locally without another bridge read', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(1_000_000)
      worldReads.mockResolvedValue({ ...ready, updatedAt: Date.now() })
      render(<Route />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /open visible rooms for a world/i }))
      })
      const joinButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Join' })
      expect(joinButton.disabled).toBe(false)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(joinButton.disabled).toBe(true)
      expect(worldReads).toHaveBeenCalledOnce()
    })
  })
}
