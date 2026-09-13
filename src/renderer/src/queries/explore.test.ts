// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplorePlatformSnapshot } from '@shared/explore'
import { QueryObserver } from '@tanstack/react-query'
import { queryClient } from './queryClient'
import {
  clearExplorePlatform,
  exploreQueryKey,
  requestExplore,
  requestExploreImage
} from './explore'

const snapshot: ExplorePlatformSnapshot = {
  platform: 'vrchat',
  worlds: [],
  status: 'ready',
  problem: null,
  isStale: false,
  updatedAt: 1
}

describe('Explore renderer requests', () => {
  beforeEach(() => {
    queryClient.clear()
    clearExplorePlatform('vrchat')
    clearExplorePlatform('chilloutvr')
    window.vrx = { getExplore: vi.fn().mockResolvedValue(snapshot) } as unknown as Window['vrx']
  })
  afterEach(() => {
    vi.useRealTimers()
    queryClient.clear()
  })

  it('coalesces same-platform requests and writes only the renderer-safe snapshot cache', async () => {
    const [first, second] = await Promise.all([
      requestExplore('vrchat', 'automatic'),
      requestExplore('vrchat', 'automatic')
    ])
    expect(first).toEqual(snapshot)
    expect(second).toEqual(snapshot)
    expect(window.vrx!.getExplore).toHaveBeenCalledTimes(1)
    expect(window.vrx!.getExplore).toHaveBeenCalledWith({ platform: 'vrchat', reason: 'automatic' })
    expect(queryClient.getQueryData(exploreQueryKey('vrchat'))).toEqual(snapshot)
  })

  it('clears an already mounted snapshot observer at an account boundary', () => {
    queryClient.setQueryData(exploreQueryKey('vrchat'), snapshot)
    const observer = new QueryObserver<ExplorePlatformSnapshot>(queryClient, {
      queryKey: exploreQueryKey('vrchat'),
      enabled: false
    })
    const unsubscribe = observer.subscribe(() => undefined)
    expect(observer.getCurrentResult().data).toEqual(snapshot)
    clearExplorePlatform('vrchat')
    expect(observer.getCurrentResult().data?.worlds ?? []).toEqual([])
    expect(observer.getCurrentResult().data?.updatedAt ?? null).toBeNull()
    unsubscribe()
  })

  it('fences an old-account reply after a boundary clear', async () => {
    let resolve!: (value: ExplorePlatformSnapshot) => void
    window.vrx = {
      getExplore: vi.fn(
        () =>
          new Promise<ExplorePlatformSnapshot>((finish) => {
            resolve = finish
          })
      )
    } as unknown as Window['vrx']
    const pending = requestExplore('vrchat', 'automatic')
    clearExplorePlatform('vrchat')
    resolve(snapshot)
    await expect(pending).resolves.toEqual(snapshot)
    expect(queryClient.getQueryData(exploreQueryKey('vrchat'))).toBeUndefined()
  })

  it('does not make a newly authenticated account wait on the old flight', async () => {
    let resolveOld!: (value: ExplorePlatformSnapshot) => void
    const fresh = { ...snapshot, updatedAt: 77 }
    window.vrx = {
      getExplore: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<ExplorePlatformSnapshot>((finish) => {
              resolveOld = finish
            })
        )
        .mockResolvedValueOnce(fresh)
    } as unknown as Window['vrx']
    const old = requestExplore('vrchat', 'automatic')
    clearExplorePlatform('vrchat')
    await expect(requestExplore('vrchat', 'automatic')).resolves.toEqual(fresh)
    resolveOld(snapshot)
    await expect(old).resolves.toEqual(snapshot)
    expect(queryClient.getQueryData(exploreQueryKey('vrchat'))).toEqual(fresh)
  })

  it('drops an automatic or manual intent queued behind an old account snapshot read', async () => {
    let resolveSnapshot!: (value: ExplorePlatformSnapshot) => void
    window.vrx = {
      getExplore: vi.fn(
        () =>
          new Promise<ExplorePlatformSnapshot>((resolve) => {
            resolveSnapshot = resolve
          })
      )
    } as unknown as Window['vrx']
    const staleSnapshotRead = requestExplore('vrchat', 'snapshot')
    const queuedManual = requestExplore('vrchat', 'manual')
    clearExplorePlatform('vrchat')
    resolveSnapshot(snapshot)

    await expect(staleSnapshotRead).resolves.toEqual(snapshot)
    await expect(queuedManual).rejects.toThrow('explore_generation_changed')
    expect(window.vrx!.getExplore).toHaveBeenCalledOnce()
  })

  it('finishes an invalidated discovery request with one cache-only snapshot read', async () => {
    const finalSnapshot = { ...snapshot, updatedAt: 2 }
    window.vrx = {
      getExplore: vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(finalSnapshot)
    } as unknown as Window['vrx']
    const automatic = requestExplore('vrchat', 'automatic')
    const invalidation = requestExplore('vrchat', 'snapshot')
    await expect(automatic).resolves.toEqual(finalSnapshot)
    await expect(invalidation).resolves.toEqual(finalSnapshot)
    expect(window.vrx!.getExplore).toHaveBeenNthCalledWith(1, {
      platform: 'vrchat',
      reason: 'automatic'
    })
    expect(window.vrx!.getExplore).toHaveBeenNthCalledWith(2, {
      platform: 'vrchat',
      reason: 'snapshot'
    })
  })

  it('does not drop a change that arrives during an in-flight cache-only snapshot read', async () => {
    let resolveFirst!: (value: ExplorePlatformSnapshot) => void
    let resolveSecond!: (value: ExplorePlatformSnapshot) => void
    const final = { ...snapshot, updatedAt: 3 }
    window.vrx = {
      getExplore: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<ExplorePlatformSnapshot>((resolve) => {
              resolveFirst = resolve
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise<ExplorePlatformSnapshot>((resolve) => {
              resolveSecond = resolve
            })
        )
        .mockResolvedValueOnce(final)
    } as unknown as Window['vrx']
    const initial = requestExplore('vrchat', 'snapshot')
    const changedDuringInitial = requestExplore('vrchat', 'snapshot')
    resolveFirst(snapshot)
    await vi.waitFor(() => expect(window.vrx!.getExplore).toHaveBeenCalledTimes(2))
    const changedDuringCacheRead = requestExplore('vrchat', 'snapshot')
    resolveSecond({ ...snapshot, updatedAt: 2 })

    await expect(initial).resolves.toEqual(final)
    await expect(changedDuringInitial).resolves.toEqual(final)
    await expect(changedDuringCacheRead).resolves.toEqual(final)
    expect(window.vrx!.getExplore).toHaveBeenNthCalledWith(3, {
      platform: 'vrchat',
      reason: 'snapshot'
    })
    expect(queryClient.getQueryData(exploreQueryKey('vrchat'))).toEqual(final)
  })

  it('marks freshness stale with a one-shot local cache update and no API request', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const fresh = { ...snapshot, updatedAt: 1_000 }
    window.vrx = { getExplore: vi.fn().mockResolvedValue(fresh) } as unknown as Window['vrx']
    await requestExplore('vrchat', 'automatic')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(
      queryClient.getQueryData<ExplorePlatformSnapshot>(exploreQueryKey('vrchat'))?.isStale
    ).toBe(true)
    expect(window.vrx!.getExplore).toHaveBeenCalledOnce()
  })

  it('bounds renderer image data by platform without retrying denied refs', async () => {
    const getExploreImage = vi.fn(({ worldRef }: { worldRef: string }) =>
      Promise.resolve({ ok: true as const, dataUrl: `data:image/png;base64,${worldRef}` })
    )
    window.vrx = { getExploreImage } as unknown as Window['vrx']
    for (let index = 0; index < 13; index += 1) {
      await requestExploreImage('vrchat', `world-${index}`)
    }
    await Promise.resolve()
    await requestExploreImage('vrchat', 'world-0')
    expect(getExploreImage).toHaveBeenCalledTimes(14)
    await requestExploreImage('vrchat', 'world-12')
    expect(getExploreImage).toHaveBeenCalledTimes(14)
  })
})
