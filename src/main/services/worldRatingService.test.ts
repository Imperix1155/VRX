import { describe, expect, it, vi } from 'vitest'
import {
  WORLD_RATING_CACHE_MS,
  WORLD_RATING_WRITE_SPACING_MS,
  type WorldRating
} from '@shared/worldRating'
import type { Platform } from '@shared/types'
import type { WorldRatingAdapter } from './adapters/WorldRatingAdapter'
import {
  AuthError,
  NetworkError,
  RateLimitError,
  RequestCancelledError,
  RequestQueueFullError
} from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import { WorldRatingService } from './worldRatingService'

const WORLD = 'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b'

class FakeAdapter implements WorldRatingAdapter {
  generation = 1
  signedIn = true
  getError: Error | null = null
  writeError: Error | null = null
  hold: Promise<void> | null = null
  readonly platform = 'vrchat' as const
  readonly getWorldRating = vi.fn(async (): Promise<WorldRating> => {
    if (this.hold) await this.hold
    if (this.getError) throw this.getError
    return null
  })
  readonly setWorldRating = vi.fn(async (_worldId: string, value: 'like' | 'dislike') => {
    if (this.writeError) throw this.writeError
    return value
  })
  readonly deleteWorldRating = vi.fn(async () => {
    if (this.writeError) throw this.writeError
    return null
  })

  captureWorldRatingLease(): RequestLease {
    if (!this.signedIn) throw new AuthError()
    const generation = this.generation
    return {
      generation,
      signal: new AbortController().signal,
      isCurrent: () => this.signedIn && generation === this.generation
    }
  }
}

function setup(): {
  adapter: FakeAdapter
  refs: Map<string, string>
  service: WorldRatingService
  now: { value: number }
  log: ReturnType<typeof vi.fn>
} {
  const adapter = new FakeAdapter()
  const now = { value: 0 }
  const refs = new Map<string, string>([
    ['vrchat:ref-a', WORLD],
    ['vrchat:ref-bad', 'wrld_x/../../auth']
  ])
  const log = vi.fn()
  const service = new WorldRatingService({
    adapters: new Map<Platform, WorldRatingAdapter>([['vrchat', adapter]]),
    resolveWorld: (platform, worldRef) => refs.get(`${platform}:${worldRef}`) ?? null,
    clock: () => now.value,
    log
  })
  return { adapter, refs, service, now, log }
}

describe('WorldRatingService', () => {
  it('reads through the shared line once and reuses the answer, including “not rated”', async () => {
    const { adapter, service, now } = setup()
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      value: null
    })
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      value: null
    })
    expect(adapter.getWorldRating).toHaveBeenCalledTimes(1)
    now.value = WORLD_RATING_CACHE_MS
    adapter.getWorldRating.mockResolvedValueOnce('like')
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      value: 'like'
    })
    expect(adapter.getWorldRating).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failed read: the next read asks the platform again', async () => {
    const { adapter, service } = setup()
    adapter.getError = new NetworkError('down')
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
    // The world sheet's "Try again" depends on this.
    adapter.getError = null
    adapter.getWorldRating.mockResolvedValueOnce('like')
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      value: 'like'
    })
    expect(adapter.getWorldRating).toHaveBeenCalledTimes(2)
  })

  it('shares one read while the first is still out', async () => {
    const { adapter, service } = setup()
    let release: () => void = () => undefined
    adapter.hold = new Promise((resolve) => {
      release = resolve
    })
    const first = service.getWorldRating('vrchat', 'ref-a')
    const second = service.getWorldRating('vrchat', 'ref-a')
    release()
    await expect(first).resolves.toEqual({ ok: true, value: null })
    await expect(second).resolves.toEqual({ ok: true, value: null })
    expect(adapter.getWorldRating).toHaveBeenCalledTimes(1)
  })

  it('sets and clears by reference, then serves the new rating without another read', async () => {
    const { adapter, service } = setup()
    await expect(service.setWorldRating('vrchat', 'ref-a', 'like')).resolves.toEqual({
      ok: true,
      value: 'like'
    })
    expect(adapter.setWorldRating).toHaveBeenCalledTimes(1)
    expect(adapter.setWorldRating.mock.calls[0]![0]).toBe(WORLD)
    expect(adapter.setWorldRating.mock.calls[0]![1]).toBe('like')
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      value: 'like'
    })
    expect(adapter.getWorldRating).not.toHaveBeenCalled()
  })

  it('does not let a late read overwrite a press that finished first', async () => {
    const { adapter, service } = setup()
    let release: () => void = () => undefined
    adapter.hold = new Promise((resolve) => {
      release = resolve
    })
    adapter.getWorldRating.mockImplementation(async () => {
      if (adapter.hold) await adapter.hold
      return 'like'
    })
    const reading = service.getWorldRating('vrchat', 'ref-a')
    await expect(service.setWorldRating('vrchat', 'ref-a', 'dislike')).resolves.toEqual({
      ok: true,
      value: 'dislike'
    })
    release()
    await expect(reading).resolves.toEqual({ ok: true, value: 'dislike' })
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      value: 'dislike'
    })
    expect(adapter.getWorldRating).toHaveBeenCalledTimes(1)
  })

  it('refuses ChilloutVR and a reference main did not issue without a request', async () => {
    const { adapter, service, log } = setup()
    await expect(service.getWorldRating('chilloutvr', 'ref-a')).resolves.toEqual({
      ok: false,
      reason: 'not-vrchat'
    })
    await expect(service.setWorldRating('chilloutvr', 'ref-a', 'like')).resolves.toEqual({
      ok: false,
      reason: 'not-vrchat'
    })
    await expect(service.getWorldRating('vrchat', 'missing')).resolves.toEqual({
      ok: false,
      reason: 'unknown-world'
    })
    await expect(service.setWorldRating('vrchat', 'ref-bad', 'dislike')).resolves.toEqual({
      ok: false,
      reason: 'unknown-world'
    })
    expect(adapter.getWorldRating).not.toHaveBeenCalled()
    expect(adapter.setWorldRating).not.toHaveBeenCalled()
    expect(adapter.deleteWorldRating).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('world rating denied', {
      platform: 'vrchat',
      reason: 'unknown-world'
    })
  })

  it('clears the active rating with DELETE and spaces the next press', async () => {
    const { adapter, service, now } = setup()
    await service.setWorldRating('vrchat', 'ref-a', 'like')
    now.value = WORLD_RATING_WRITE_SPACING_MS
    await expect(service.setWorldRating('vrchat', 'ref-a', null)).resolves.toEqual({
      ok: true,
      value: null
    })
    expect(adapter.deleteWorldRating).toHaveBeenCalledTimes(1)
    await expect(service.setWorldRating('vrchat', 'ref-a', 'like')).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })
    expect(adapter.setWorldRating).toHaveBeenCalledTimes(1)
    now.value += WORLD_RATING_WRITE_SPACING_MS
    await expect(service.setWorldRating('vrchat', 'ref-a', 'like')).resolves.toEqual({
      ok: true,
      value: 'like'
    })
  })

  it('maps a slow-down and a dropped session, and keeps the last good rating after a failed press', async () => {
    const { adapter, service, now } = setup()
    await service.setWorldRating('vrchat', 'ref-a', 'like')
    now.value = WORLD_RATING_WRITE_SPACING_MS
    adapter.writeError = new RateLimitError(1_000)
    await expect(service.setWorldRating('vrchat', 'ref-a', 'dislike')).resolves.toEqual({
      ok: false,
      reason: 'rate-limited'
    })
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      value: 'like'
    })
    expect(adapter.getWorldRating).not.toHaveBeenCalled()

    now.value += WORLD_RATING_WRITE_SPACING_MS
    adapter.writeError = new RequestQueueFullError()
    await expect(service.setWorldRating('vrchat', 'ref-a', 'dislike')).resolves.toEqual({
      ok: false,
      reason: 'rate-limited'
    })

    now.value += WORLD_RATING_WRITE_SPACING_MS
    adapter.writeError = new RequestCancelledError()
    await expect(service.setWorldRating('vrchat', 'ref-a', 'dislike')).resolves.toEqual({
      ok: false,
      reason: 'stale'
    })

    now.value += WORLD_RATING_WRITE_SPACING_MS
    adapter.writeError = new AuthError(undefined, 401)
    await expect(service.setWorldRating('vrchat', 'ref-a', 'dislike')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })

    now.value += WORLD_RATING_WRITE_SPACING_MS
    adapter.writeError = new NetworkError('down')
    await expect(service.setWorldRating('vrchat', 'ref-a', 'dislike')).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(adapter.deleteWorldRating).not.toHaveBeenCalled()
  })

  it('sends nothing when signed out, and forgets the rating when the session ends', async () => {
    const { adapter, service } = setup()
    await service.getWorldRating('vrchat', 'ref-a')
    adapter.signedIn = false
    adapter.generation += 1
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    await expect(service.setWorldRating('vrchat', 'ref-a', 'like')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(adapter.setWorldRating).not.toHaveBeenCalled()

    adapter.signedIn = true
    service.clearPlatform('vrchat')
    adapter.getWorldRating.mockClear()
    await expect(service.getWorldRating('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      value: null
    })
    expect(adapter.getWorldRating).toHaveBeenCalledTimes(1)
  })
})
