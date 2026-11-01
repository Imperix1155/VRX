import { describe, expect, it, vi } from 'vitest'
import { RELATIONSHIP_CACHE_MS, SOCIAL_ACTION_COOLDOWN_MS } from '@shared/socialActions'
import type { Platform } from '@shared/types'
import { SocialNotSentError, type SocialActionAdapter } from './adapters/SocialActionAdapter'
import { AuthError, NetworkError, RateLimitError } from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import { SocialActionService } from './socialActionService'

const FRIEND = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const SEARCHED = 'usr_5a3c1e2d-0000-4000-8000-000000000002'
const STRANGER = 'usr_5a3c1e2d-0000-4000-8000-000000000003'
const CVR_FRIEND = 'B81D5892-5119-4F44-B473-7BF4FFDA0458'

class FakeAdapter implements SocialActionAdapter {
  generation = 1
  signedIn = true
  blocked: boolean | null = false
  error: Error | null = null
  readonly getBlocked = vi.fn((...args: [string, RequestLease]) => {
    void args
    return this.error ? Promise.reject(this.error) : Promise.resolve(this.blocked)
  })
  readonly unfriend = vi.fn((...args: [string, RequestLease]) => this.write(args))
  readonly block = vi.fn((...args: [string, RequestLease]) => this.write(args))
  readonly unblock = vi.fn((...args: [string, RequestLease]) => this.write(args))
  private gate: Promise<void> | null = null
  private release: (() => void) | null = null

  constructor(readonly platform: Platform) {}

  captureSocialLease(): RequestLease {
    if (!this.signedIn) throw new AuthError()
    const generation = this.generation
    return {
      generation,
      signal: new AbortController().signal,
      isCurrent: () => this.generation === generation && this.signedIn
    }
  }

  hold(): void {
    this.gate = new Promise((resolve) => (this.release = resolve))
  }

  finish(): void {
    this.release?.()
    this.gate = null
  }

  private async write(args: [string, RequestLease]): Promise<void> {
    void args
    if (this.gate) await this.gate
    if (this.error) throw this.error
  }
}

function setup(): {
  service: SocialActionService
  vrc: FakeAdapter
  cvr: FakeAdapter
  friends: Set<string>
  advance: (ms: number) => void
  log: ReturnType<typeof vi.fn>
} {
  let now = 1_000
  const vrc = new FakeAdapter('vrchat')
  const cvr = new FakeAdapter('chilloutvr')
  const friends = new Set([FRIEND, CVR_FRIEND.toLowerCase()])
  const log = vi.fn()
  const service = new SocialActionService({
    adapters: new Map<Platform, SocialActionAdapter>([
      ['vrchat', vrc],
      ['chilloutvr', cvr]
    ]),
    isFriend: (_platform, userId) => friends.has(userId),
    isKnownPerson: (_platform, userId) => userId === SEARCHED,
    clock: () => now,
    log
  })
  return { service, vrc, cvr, friends, advance: (ms) => (now += ms), log }
}

describe('SocialActionService', () => {
  it('reads block state once and reuses it for 5 minutes', async () => {
    const { service, vrc, advance } = setup()
    vrc.blocked = true

    await expect(service.getRelationship('vrchat', FRIEND)).resolves.toEqual({
      ok: true,
      relationship: { platform: 'vrchat', userId: FRIEND, isFriend: true, blocked: true }
    })
    await service.getRelationship('vrchat', FRIEND)
    expect(vrc.getBlocked).toHaveBeenCalledTimes(1)

    advance(RELATIONSHIP_CACHE_MS)
    await service.getRelationship('vrchat', FRIEND)
    expect(vrc.getBlocked).toHaveBeenCalledTimes(2)
  })

  it('shares one read between two asks at once', async () => {
    const { service, vrc } = setup()
    await Promise.all([
      service.getRelationship('vrchat', FRIEND),
      service.getRelationship('vrchat', FRIEND)
    ])
    expect(vrc.getBlocked).toHaveBeenCalledTimes(1)
  })

  it('acts only on a friend or someone a search listed, never a stranger', async () => {
    const { service, vrc } = setup()
    await expect(service.getRelationship('vrchat', STRANGER)).resolves.toEqual({
      ok: false,
      reason: 'unknown-person'
    })
    await expect(service.act('vrchat', STRANGER, 'block')).resolves.toEqual({
      ok: false,
      reason: 'unknown-person'
    })
    await expect(service.act('vrchat', 'not an id', 'block')).resolves.toEqual({
      ok: false,
      reason: 'unknown-person'
    })
    expect(vrc.getBlocked).not.toHaveBeenCalled()
    expect(vrc.block).not.toHaveBeenCalled()

    await expect(service.act('vrchat', SEARCHED, 'block')).resolves.toMatchObject({ ok: true })
    expect(vrc.block).toHaveBeenCalledWith(SEARCHED, expect.anything())
  })

  it('refuses to unfriend someone who is not a friend, without a request', async () => {
    const { service, vrc } = setup()
    await expect(service.act('vrchat', SEARCHED, 'unfriend')).resolves.toEqual({
      ok: false,
      reason: 'not-friend'
    })
    expect(vrc.unfriend).not.toHaveBeenCalled()
  })

  it('reports the new state after each action', async () => {
    const { service, vrc, advance } = setup()
    vrc.blocked = false
    await service.getRelationship('vrchat', FRIEND)

    await expect(service.act('vrchat', FRIEND, 'block')).resolves.toEqual({
      ok: true,
      relationship: { platform: 'vrchat', userId: FRIEND, isFriend: true, blocked: true }
    })
    advance(SOCIAL_ACTION_COOLDOWN_MS)
    await expect(service.act('vrchat', FRIEND, 'unfriend')).resolves.toEqual({
      ok: true,
      relationship: { platform: 'vrchat', userId: FRIEND, isFriend: false, blocked: true }
    })
    advance(SOCIAL_ACTION_COOLDOWN_MS)
    // The roster has not caught up yet; the unfriend still counts.
    await expect(service.getRelationship('vrchat', FRIEND)).resolves.toMatchObject({
      relationship: { isFriend: false, blocked: true }
    })
    await expect(service.act('vrchat', FRIEND, 'unfriend')).resolves.toEqual({
      ok: false,
      reason: 'not-friend'
    })
    // Someone just unfriended can still be unblocked from the same profile.
    await expect(service.act('vrchat', FRIEND, 'unblock')).resolves.toMatchObject({
      ok: true,
      relationship: { isFriend: false, blocked: false }
    })
    expect(vrc.getBlocked).toHaveBeenCalledTimes(1)
  })

  it('allows one action per platform at a time, then pauses', async () => {
    const { service, vrc, cvr, advance } = setup()
    vrc.hold()
    const first = service.act('vrchat', FRIEND, 'block')
    await expect(service.act('vrchat', SEARCHED, 'block')).resolves.toEqual({
      ok: false,
      reason: 'busy'
    })
    // The other platform has its own line.
    await expect(service.act('chilloutvr', CVR_FRIEND, 'block')).resolves.toMatchObject({
      ok: true
    })
    vrc.finish()
    await expect(first).resolves.toMatchObject({ ok: true })

    await expect(service.act('vrchat', SEARCHED, 'block')).resolves.toEqual({
      ok: false,
      reason: 'busy'
    })
    advance(SOCIAL_ACTION_COOLDOWN_MS - 1)
    await expect(service.act('vrchat', SEARCHED, 'block')).resolves.toEqual({
      ok: false,
      reason: 'busy'
    })
    advance(1)
    await expect(service.act('vrchat', SEARCHED, 'block')).resolves.toMatchObject({ ok: true })
    expect(vrc.block).toHaveBeenCalledTimes(2)
    expect(cvr.block).toHaveBeenCalledTimes(1)
  })

  it('pauses after a failed action too, and never retries it', async () => {
    const { service, vrc, advance } = setup()
    vrc.error = new NetworkError('down')
    await expect(service.act('vrchat', FRIEND, 'block')).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    expect(vrc.block).toHaveBeenCalledTimes(1)
    vrc.error = null
    await expect(service.act('vrchat', FRIEND, 'block')).resolves.toEqual({
      ok: false,
      reason: 'busy'
    })
    advance(SOCIAL_ACTION_COOLDOWN_MS)
    await expect(service.act('vrchat', FRIEND, 'block')).resolves.toMatchObject({ ok: true })
  })

  it('maps failures to typed reasons and logs no person', async () => {
    const { service, vrc, cvr, advance, log } = setup()
    vrc.error = new RateLimitError(0)
    await expect(service.getRelationship('vrchat', FRIEND)).resolves.toEqual({
      ok: false,
      reason: 'rate-limited'
    })
    vrc.error = new AuthError('Session expired', 401)
    await expect(service.act('vrchat', FRIEND, 'unfriend')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    advance(SOCIAL_ACTION_COOLDOWN_MS)
    cvr.error = new SocialNotSentError()
    await expect(service.act('chilloutvr', CVR_FRIEND, 'unfriend')).resolves.toEqual({
      ok: false,
      reason: 'not-connected'
    })
    for (const [, meta] of log.mock.calls) {
      expect(JSON.stringify(meta)).not.toMatch(/usr_|b81d5892/i)
    }
  })

  it('compares ChilloutVR IDs without case and sends them lower case', async () => {
    const { service, cvr } = setup()
    await expect(service.act('chilloutvr', CVR_FRIEND, 'unfriend')).resolves.toMatchObject({
      ok: true,
      relationship: { userId: CVR_FRIEND.toLowerCase(), isFriend: false }
    })
    expect(cvr.unfriend).toHaveBeenCalledWith(CVR_FRIEND.toLowerCase(), expect.anything())
  })

  it('forgets everything at an account boundary', async () => {
    const { service, vrc } = setup()
    await service.act('vrchat', FRIEND, 'unfriend')
    vrc.generation += 1
    await expect(service.getRelationship('vrchat', FRIEND)).resolves.toMatchObject({
      relationship: { isFriend: true }
    })
    expect(vrc.getBlocked).toHaveBeenCalledTimes(1)

    vrc.signedIn = false
    await expect(service.act('vrchat', FRIEND, 'block')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(vrc.block).not.toHaveBeenCalled()
  })

  it('does not report a write for an account that changed while it was sent', async () => {
    const { service, vrc } = setup()
    vrc.hold()
    const pending = service.act('vrchat', FRIEND, 'block')
    vrc.generation += 1
    vrc.finish()
    await expect(pending).resolves.toEqual({ ok: false, reason: 'not-authenticated' })
  })
})
