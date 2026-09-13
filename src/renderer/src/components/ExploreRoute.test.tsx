// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplorePlatformSnapshot, ExploreWorld, ExploreWorldSnapshot } from '@shared/explore'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import ExploreRoute, { ExploreDashboardPreviewRoute } from './ExploreRoute'

const query = vi.hoisted(() => ({
  vrc: undefined as ExplorePlatformSnapshot | undefined,
  cvr: undefined as ExplorePlatformSnapshot | undefined,
  requestExplore: vi.fn(),
  requestExploreImage: vi.fn()
}))

vi.mock('../queries/explore', () => ({
  useExploreSnapshot: (platform: 'vrchat' | 'chilloutvr') => ({
    data: platform === 'vrchat' ? query.vrc : query.cvr
  }),
  useExploreCachedSnapshot: (platform: 'vrchat' | 'chilloutvr') =>
    platform === 'vrchat' ? query.vrc : query.cvr,
  requestExplore: query.requestExplore,
  requestExploreImage: query.requestExploreImage
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
  query.vrc = source
  query.cvr = undefined
  query.requestExplore.mockReset()
  query.requestExploreImage.mockResolvedValue(undefined)
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
