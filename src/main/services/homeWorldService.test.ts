import { describe, expect, it, vi } from 'vitest'
import { HOME_WORLD_COOLDOWN_MS } from '@shared/homeWorld'
import type { Platform } from '@shared/types'
import type { HomeWorldAdapter } from './adapters/HomeWorldAdapter'
import { AuthError, NetworkError, RateLimitError, RequestQueueFullError } from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import { HomeWorldService } from './homeWorldService'

const VRC_WORLD = 'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b'
const CVR_WORLD = 'c4a1d0f2-6b8e-4c1d-9a7e-2f3b4c5d6e7f'

class FakeAdapter implements HomeWorldAdapter {
  generation = 1
  signedIn = true
  error: Error | null = null
  hold: Promise<void> | null = null
  readonly setHomeWorld = vi.fn(async (worldId: string, lease: RequestLease) => {
    void worldId
    void lease
    if (this.hold) await this.hold
    if (this.error) throw this.error
  })

  constructor(readonly platform: Platform) {}

  captureHomeWorldLease(): RequestLease {
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
  vrc: FakeAdapter
  cvr: FakeAdapter
  refs: Map<string, string>
  service: HomeWorldService
  now: { value: number }
  log: ReturnType<typeof vi.fn>
} {
  const vrc = new FakeAdapter('vrchat')
  const cvr = new FakeAdapter('chilloutvr')
  const now = { value: 0 }
  const refs = new Map([
    ['vrchat:ref-a', VRC_WORLD],
    ['chilloutvr:ref-b', CVR_WORLD],
    ['vrchat:ref-bad', 'wrld_x/../../auth']
  ])
  const log = vi.fn()
  const service = new HomeWorldService({
    adapters: new Map<Platform, HomeWorldAdapter>([
      ['vrchat', vrc],
      ['chilloutvr', cvr]
    ]),
    resolveWorld: (platform, worldRef) => refs.get(`${platform}:${worldRef}`) ?? null,
    clock: () => now.value,
    log
  })
  return { vrc, cvr, refs, service, now, log }
}

describe('HomeWorldService', () => {
  it('resolves the reference in main and sends one write for that world', async () => {
    const { vrc, cvr, service } = setup()
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toEqual({
      ok: true,
      platform: 'vrchat',
      worldId: VRC_WORLD
    })
    expect(vrc.setHomeWorld).toHaveBeenCalledTimes(1)
    expect(vrc.setHomeWorld.mock.calls[0]![0]).toBe(VRC_WORLD)
    await expect(service.setHomeWorld('chilloutvr', 'ref-b')).resolves.toMatchObject({
      ok: true,
      worldId: CVR_WORLD
    })
    expect(cvr.setHomeWorld).toHaveBeenCalledTimes(1)
  })

  it('refuses a reference main did not issue, or one for another platform, without a request', async () => {
    const { vrc, cvr, service } = setup()
    await expect(service.setHomeWorld('vrchat', 'ref-b')).resolves.toEqual({
      ok: false,
      reason: 'unknown-world'
    })
    await expect(service.setHomeWorld('chilloutvr', 'ref-a')).resolves.toEqual({
      ok: false,
      reason: 'unknown-world'
    })
    // A resolved ID that fails the shape check never reaches the adapter.
    await expect(service.setHomeWorld('vrchat', 'ref-bad')).resolves.toEqual({
      ok: false,
      reason: 'unknown-world'
    })
    expect(vrc.setHomeWorld).not.toHaveBeenCalled()
    expect(cvr.setHomeWorld).not.toHaveBeenCalled()
  })

  it('refuses when signed out', async () => {
    const { vrc, service } = setup()
    vrc.signedIn = false
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(vrc.setHomeWorld).not.toHaveBeenCalled()
  })

  it('runs one change at a time and waits out the cooldown after every attempt', async () => {
    const { vrc, cvr, service, now } = setup()
    let release!: () => void
    vrc.hold = new Promise((resolve) => (release = resolve))
    const first = service.setHomeWorld('vrchat', 'ref-a')
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })
    // The other platform has its own line.
    await expect(service.setHomeWorld('chilloutvr', 'ref-b')).resolves.toMatchObject({ ok: true })
    release()
    await expect(first).resolves.toMatchObject({ ok: true })
    vrc.hold = null

    now.value += HOME_WORLD_COOLDOWN_MS - 1
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toMatchObject({
      reason: 'cooldown'
    })
    now.value += 1
    vrc.error = new NetworkError('offline')
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
    // A failed attempt starts the cooldown too.
    vrc.error = null
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toMatchObject({
      reason: 'cooldown'
    })
    expect(vrc.setHomeWorld).toHaveBeenCalledTimes(2)
    expect(cvr.setHomeWorld).toHaveBeenCalledTimes(1)
  })

  it('maps sign-in and rate-limit failures', async () => {
    const { vrc, service, now } = setup()
    vrc.error = new AuthError()
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toMatchObject({
      reason: 'not-authenticated'
    })
    now.value += HOME_WORLD_COOLDOWN_MS
    // A 403 refuses this change; the session itself is still good.
    vrc.error = new AuthError('Forbidden', 403)
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toMatchObject({
      reason: 'failed'
    })
    now.value += HOME_WORLD_COOLDOWN_MS
    vrc.error = new RateLimitError(1_000)
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toMatchObject({
      reason: 'rate-limited'
    })
    now.value += HOME_WORLD_COOLDOWN_MS
    vrc.error = new RequestQueueFullError()
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toMatchObject({
      reason: 'rate-limited'
    })
  })

  it('reports a failure when the account changed while the write was out', async () => {
    const { vrc, service } = setup()
    vrc.setHomeWorld.mockImplementationOnce(async () => {
      vrc.generation += 1
    })
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
  })

  it('starts fresh for a new session, so an old cooldown never blocks a new account', async () => {
    const { vrc, service } = setup()
    await service.setHomeWorld('vrchat', 'ref-a')
    vrc.generation += 1
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toMatchObject({ ok: true })
    service.clearPlatform('vrchat')
    await expect(service.setHomeWorld('vrchat', 'ref-a')).resolves.toMatchObject({ ok: true })
  })

  it('logs only the platform and the reason', async () => {
    const { service, log } = setup()
    await service.setHomeWorld('vrchat', 'ref-b')
    expect(log).toHaveBeenCalledWith('home world change denied', {
      platform: 'vrchat',
      reason: 'unknown-world'
    })
  })
})
