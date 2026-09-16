import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type {
  ExploreImageResult,
  ExplorePlatformSnapshot,
  ExploreRefreshReason
} from '@shared/explore'
import type { Platform } from '@shared/types'
import { queryClient } from './queryClient'

const FRESH_FOR_MS = 60_000
const MAX_IMAGES_PER_PLATFORM = 12
const MAX_IMAGE_RECOVERY_ATTEMPTS = 2
const IMAGE_RETRY_MIN_MS = 250
const IMAGE_RETRY_MAX_MS = 60_000

export function exploreQueryKey(platform: Platform): readonly ['explore', Platform] {
  return ['explore', platform] as const
}

interface Flight {
  generation: number
  reason: ExploreRefreshReason
  needsSnapshot: boolean
  promise: Promise<ExplorePlatformSnapshot>
}

const generations: Record<Platform, number> = { vrchat: 0, chilloutvr: 0 }
const flights = new Map<Platform, Flight>()
const freshnessTimers = new Map<Platform, ReturnType<typeof setTimeout>>()
// A null value remembers a main denial without retaining any image data. It is
// bounded and reset with the platform just like successful image entries.
const images = new Map<string, string | null>()
const imageFlights = new Map<string, Promise<ExploreImageResult>>()
interface ImageObserverEntry {
  generation: number
  listeners: Set<(image: string | undefined) => void>
  recoveryAttempts: number
  deferredRetryAfterMs: number | null
  exhausted: boolean
  pending: Promise<ExploreImageResult> | null
  timer: ReturnType<typeof setTimeout> | null
}
const imageObservers = new Map<string, ImageObserverEntry>()
const resetGenerations: Record<Platform, number> = { vrchat: 0, chilloutvr: 0 }
const resetListeners: Record<Platform, Set<() => void>> = {
  vrchat: new Set(),
  chilloutvr: new Set()
}

function imageKey(platform: Platform, worldRef: string): string {
  return `${platform}:${worldRef}`
}

function cacheImage(platform: Platform, worldRef: string, dataUrl: string | null): void {
  const key = imageKey(platform, worldRef)
  images.set(key, dataUrl)
  let retained = 0
  for (const candidate of images.keys()) {
    if (candidate.startsWith(`${platform}:`)) retained += 1
  }
  while (retained > MAX_IMAGES_PER_PLATFORM) {
    for (const candidate of images.keys()) {
      if (!candidate.startsWith(`${platform}:`)) continue
      images.delete(candidate)
      retained -= 1
      break
    }
  }
  trimImageObservers(platform)
}

function trimImageObservers(platform: Platform): void {
  let retained = 0
  for (const key of imageObservers.keys()) if (key.startsWith(`${platform}:`)) retained += 1
  while (retained > MAX_IMAGES_PER_PLATFORM) {
    let removed = false
    for (const [key, observer] of imageObservers) {
      if (
        !key.startsWith(`${platform}:`) ||
        observer.listeners.size !== 0 ||
        observer.pending !== null ||
        observer.timer !== null
      )
        continue
      imageObservers.delete(key)
      retained -= 1
      removed = true
      break
    }
    if (!removed) return
  }
}

function cachedImage(platform: Platform, worldRef: string): ExploreImageResult | undefined {
  const key = imageKey(platform, worldRef)
  if (!images.has(key)) return undefined
  const dataUrl = images.get(key)
  return dataUrl === null || dataUrl === undefined ? null : { ok: true, dataUrl }
}

function scheduleFreshness(
  platform: Platform,
  generation: number,
  snapshot: ExplorePlatformSnapshot
): void {
  const previous = freshnessTimers.get(platform)
  if (previous !== undefined) clearTimeout(previous)
  if (snapshot.updatedAt === null || snapshot.isStale) return
  const delay = Math.max(0, snapshot.updatedAt + FRESH_FOR_MS - Date.now())
  const timer = setTimeout(() => {
    freshnessTimers.delete(platform)
    if (generations[platform] !== generation) return
    const current = queryClient.getQueryData<ExplorePlatformSnapshot>(exploreQueryKey(platform))
    if (current?.updatedAt !== snapshot.updatedAt || current.isStale) return
    // Local one-shot expiry changes presentation only; it never starts API work.
    queryClient.setQueryData(exploreQueryKey(platform), { ...current, isStale: true })
  }, delay)
  freshnessTimers.set(platform, timer)
}

function publish(
  platform: Platform,
  generation: number,
  snapshot: ExplorePlatformSnapshot
): boolean {
  if (generations[platform] !== generation) return false
  queryClient.setQueryData(exploreQueryKey(platform), snapshot)
  scheduleFreshness(platform, generation, snapshot)
  return true
}

async function invoke(
  platform: Platform,
  reason: ExploreRefreshReason
): Promise<ExplorePlatformSnapshot> {
  if (typeof window === 'undefined' || !window.vrx?.getExplore)
    throw new Error('bridge_unavailable')
  return window.vrx.getExplore({ platform, reason })
}

function start(platform: Platform, reason: ExploreRefreshReason): Promise<ExplorePlatformSnapshot> {
  const flight: Flight = {
    generation: generations[platform],
    reason,
    needsSnapshot: false,
    promise: Promise.resolve(undefined as never)
  }
  flight.promise = (async () => {
    let final = await invoke(platform, reason)
    // A change may land while either the original work or a cache-only read is
    // in flight. Consume those change marks serially until the latest read was
    // quiet, so a loading snapshot cannot outlive a racing changed event.
    while (flight.needsSnapshot && generations[platform] === flight.generation) {
      flight.needsSnapshot = false
      final = await invoke(platform, 'snapshot')
    }
    publish(platform, flight.generation, final)
    return final
  })()
  flights.set(platform, flight)
  const cleanup = (): void => {
    if (flights.get(platform) === flight) flights.delete(platform)
  }
  // `finally()` creates a second rejected promise; both handlers preserve the
  // caller's rejection while cleaning only this exact flight.
  void flight.promise.then(cleanup, cleanup)
  return flight.promise
}

/** One renderer request per platform with cache-only invalidation follow-up. */
export function requestExplore(
  platform: Platform,
  reason: ExploreRefreshReason
): Promise<ExplorePlatformSnapshot> {
  const pending = flights.get(platform)
  if (pending === undefined) return start(platform, reason)
  if (reason === 'snapshot') {
    // Snapshot callers are the renderer's main-change invalidation path. Mark
    // even a pending cache read dirty; another cache-only read will follow it.
    pending.needsSnapshot = true
    return pending.promise
  }
  // A user/focus refresh may never be swallowed behind a snapshot read.
  if (pending.reason === 'snapshot') {
    const generation = pending.generation
    return pending.promise.then(() => {
      if (generations[platform] !== generation) throw new Error('explore_generation_changed')
      return requestExplore(platform, reason)
    })
  }
  return pending.promise
}

export function readExploreSnapshot(platform: Platform): Promise<ExplorePlatformSnapshot> {
  return requestExplore(platform, 'snapshot')
}

/** Fence old-account replies, clear all mounted snapshots, and drop image references. */
export function clearExplorePlatform(platform: Platform): void {
  generations[platform] += 1
  // The old main request may still settle, but its generation can no longer
  // publish. Remove its local coalescing slot so a newly authenticated account
  // is not forced to inherit an obsolete promise.
  flights.delete(platform)
  const timer = freshnessTimers.get(platform)
  if (timer !== undefined) clearTimeout(timer)
  freshnessTimers.delete(platform)
  void queryClient.cancelQueries({ queryKey: exploreQueryKey(platform) })
  // Reset notifies mounted disabled observers; removal alone leaves their old
  // account snapshot visible. Disabled Explore queries never refetch on reset.
  void queryClient.resetQueries({ queryKey: exploreQueryKey(platform), exact: true })
  for (const key of images.keys()) if (key.startsWith(`${platform}:`)) images.delete(key)
  for (const key of imageFlights.keys())
    if (key.startsWith(`${platform}:`)) imageFlights.delete(key)
  for (const [key, observer] of imageObservers) {
    if (!key.startsWith(`${platform}:`)) continue
    if (observer.timer !== null) clearTimeout(observer.timer)
    imageObservers.delete(key)
  }
  resetGenerations[platform] += 1
  for (const listener of resetListeners[platform]) listener()
}

export function useExploreResetGeneration(platform: Platform): number {
  return useSyncExternalStore(
    (listener) => {
      resetListeners[platform].add(listener)
      return () => resetListeners[platform].delete(listener)
    },
    () => resetGenerations[platform],
    () => 0
  )
}

/** Main-issued image references only; one-off callers never retry automatically. */
function requestExploreImageResult(
  platform: Platform,
  worldRef: string
): Promise<ExploreImageResult> {
  const key = imageKey(platform, worldRef)
  const cached = cachedImage(platform, worldRef)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = imageFlights.get(key)
  if (pending !== undefined) return pending
  const generation = generations[platform]
  const request = (async () => {
    if (typeof window === 'undefined' || !window.vrx?.getExploreImage) return null
    const response = await window.vrx.getExploreImage({ platform, worldRef })
    if (generations[platform] === generation) {
      if (response === null) cacheImage(platform, worldRef, null)
      else if (response.ok) cacheImage(platform, worldRef, response.dataUrl)
    }
    return response
  })()
  imageFlights.set(key, request)
  const cleanup = (): void => {
    if (imageFlights.get(key) === request) imageFlights.delete(key)
  }
  void request.then(cleanup, cleanup)
  return request
}

/** Main-issued image references only; one-off callers never retry automatically. */
export function requestExploreImage(
  platform: Platform,
  worldRef: string
): Promise<string | undefined> {
  return requestExploreImageResult(platform, worldRef).then((result) =>
    result?.ok ? result.dataUrl : undefined
  )
}

function notifyImage(observer: ImageObserverEntry, image: string | undefined): void {
  for (const listener of observer.listeners) listener(image)
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function clampImageRetryAfterMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(IMAGE_RETRY_MIN_MS, Math.min(IMAGE_RETRY_MAX_MS, Math.floor(value)))
}

function scheduleObservedImageRecovery(
  platform: Platform,
  worldRef: string,
  observer: ImageObserverEntry
): void {
  if (
    observer.timer !== null ||
    observer.listeners.size === 0 ||
    observer.deferredRetryAfterMs === null ||
    !isDocumentVisible()
  )
    return
  observer.timer = setTimeout(() => {
    observer.timer = null
    observer.deferredRetryAfterMs = null
    runObservedImageRequest(platform, worldRef, observer)
  }, observer.deferredRetryAfterMs)
}

function runObservedImageRequest(
  platform: Platform,
  worldRef: string,
  observer: ImageObserverEntry
): void {
  const key = imageKey(platform, worldRef)
  if (
    imageObservers.get(key) !== observer ||
    generations[platform] !== observer.generation ||
    observer.pending !== null ||
    observer.timer !== null ||
    observer.listeners.size === 0 ||
    !isDocumentVisible()
  )
    return
  const cached = cachedImage(platform, worldRef)
  if (cached !== undefined) {
    notifyImage(observer, cached?.ok ? cached.dataUrl : undefined)
    return
  }
  if (observer.exhausted) {
    notifyImage(observer, undefined)
    return
  }
  if (observer.deferredRetryAfterMs !== null) {
    scheduleObservedImageRecovery(platform, worldRef, observer)
    return
  }
  const request = requestExploreImageResult(platform, worldRef)
  observer.pending = request
  void request.then(
    (result) => {
      if (imageObservers.get(key) !== observer || generations[platform] !== observer.generation)
        return
      observer.pending = null
      const mayNotify = observer.listeners.size !== 0 && isDocumentVisible()
      if (result?.ok) {
        if (mayNotify) notifyImage(observer, result.dataUrl)
        return
      }
      if (result === null) {
        if (mayNotify) notifyImage(observer, undefined)
        return
      }
      if (observer.recoveryAttempts >= MAX_IMAGE_RECOVERY_ATTEMPTS) {
        observer.exhausted = true
        cacheImage(platform, worldRef, null)
        if (mayNotify) notifyImage(observer, undefined)
        return
      }
      const retryAfterMs = clampImageRetryAfterMs(result.retryAfterMs)
      if (retryAfterMs === null) {
        cacheImage(platform, worldRef, null)
        if (mayNotify) notifyImage(observer, undefined)
        return
      }
      observer.recoveryAttempts += 1
      observer.deferredRetryAfterMs = retryAfterMs
      scheduleObservedImageRecovery(platform, worldRef, observer)
    },
    () => {
      if (imageObservers.get(key) !== observer || generations[platform] !== observer.generation)
        return
      observer.pending = null
      // Unknown bridge failures are terminal for this visible lifetime; no retry is scheduled.
      cacheImage(platform, worldRef, null)
      notifyImage(observer, undefined)
    }
  )
}

/**
 * Shares one visible lifecycle between a card and its sheet. A typed main
 * admission deferral may schedule at most two later attempts; removing the
 * last visible subscriber cancels pending work without resetting that budget.
 */
export function observeExploreImage(
  platform: Platform,
  worldRef: string,
  listener: (image: string | undefined) => void
): () => void {
  const key = imageKey(platform, worldRef)
  let observer = imageObservers.get(key)
  if (observer === undefined || observer.generation !== generations[platform]) {
    observer = {
      generation: generations[platform],
      listeners: new Set(),
      recoveryAttempts: 0,
      deferredRetryAfterMs: null,
      exhausted: false,
      pending: null,
      timer: null
    }
    imageObservers.set(key, observer)
  }
  observer.listeners.add(listener)
  trimImageObservers(platform)
  runObservedImageRequest(platform, worldRef, observer)
  return () => {
    const current = imageObservers.get(key)
    if (current !== observer) return
    current.listeners.delete(listener)
    if (current.listeners.size === 0 && current.timer !== null) {
      clearTimeout(current.timer)
      current.timer = null
    }
    trimImageObservers(platform)
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!isDocumentVisible()) {
      for (const observer of imageObservers.values()) {
        if (observer.timer !== null) {
          clearTimeout(observer.timer)
          observer.timer = null
        }
      }
      return
    }
    for (const [key, observer] of imageObservers) {
      const separator = key.indexOf(':')
      const platform = key.slice(0, separator) as Platform
      const worldRef = key.slice(separator + 1)
      runObservedImageRequest(platform, worldRef, observer)
    }
  })
}

export function useExploreSnapshot(
  platform: Platform
): UseQueryResult<ExplorePlatformSnapshot, Error> {
  return useQuery({
    queryKey: exploreQueryKey(platform),
    queryFn: () => readExploreSnapshot(platform),
    enabled: false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity
  })
}

export function useExploreCachedSnapshot(platform: Platform): ExplorePlatformSnapshot | undefined {
  return useSyncExternalStore(
    (listener) => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryData<ExplorePlatformSnapshot>(exploreQueryKey(platform)),
    () => undefined
  )
}
