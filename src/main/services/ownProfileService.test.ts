import { describe, expect, it, vi } from 'vitest'
import {
  OWN_PROFILE_REREAD_MS,
  OWN_PROFILE_SAVE_COOLDOWN_MS,
  type OwnProfile,
  type OwnProfileChanges
} from '@shared/ownProfile'
import type { Platform } from '@shared/types'
import type { OwnProfileAdapter } from './adapters/OwnProfileAdapter'
import { AuthError, NetworkError, RateLimitError } from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import { OwnProfileService } from './ownProfileService'

function profile(platform: Platform, extra: Partial<OwnProfile> = {}): OwnProfile {
  return platform === 'vrchat'
    ? {
        platform,
        bio: 'Old bio',
        pronouns: 'they/them',
        status: 'online',
        statusText: '',
        ...extra
      }
    : { platform, bio: 'Old bio', pronouns: '', status: null, statusText: null, ...extra }
}

class FakeAdapter implements OwnProfileAdapter {
  generation = 1
  signedIn = true
  current: OwnProfile
  readError: Error | null = null
  saveError: Error | null = null
  /** VRChat answers with the saved user; ChilloutVR answers with nothing. */
  answers = true
  readonly getOwnProfile = vi.fn(async (lease: RequestLease) => {
    void lease
    await Promise.resolve()
    if (this.readError) throw this.readError
    return { ...this.current }
  })
  readonly saveOwnProfile = vi.fn(async (changes: OwnProfileChanges, lease: RequestLease) => {
    void lease
    await Promise.resolve()
    if (this.saveError) throw this.saveError
    this.current = { ...this.current, ...changes }
    return this.answers ? { ...this.current } : null
  })

  constructor(readonly platform: Platform) {
    this.current = profile(platform)
    this.answers = platform === 'vrchat'
  }

  captureOwnProfileLease(): RequestLease {
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
  service: OwnProfileService
  vrc: FakeAdapter
  cvr: FakeAdapter
  tick: (ms: number) => void
  log: ReturnType<typeof vi.fn>
} {
  const vrc = new FakeAdapter('vrchat')
  const cvr = new FakeAdapter('chilloutvr')
  let now = 1_000
  const log = vi.fn()
  const service = new OwnProfileService({
    adapters: new Map<Platform, OwnProfileAdapter>([
      ['vrchat', vrc],
      ['chilloutvr', cvr]
    ]),
    clock: () => now,
    log
  })
  return { service, vrc, cvr, log, tick: (ms) => (now += ms) }
}

describe('OwnProfileService reads', () => {
  it('shares one read and reuses the answer for 30 s', async () => {
    const { service, vrc, tick } = setup()
    const [a, b] = await Promise.all([
      service.getOwnProfile('vrchat'),
      service.getOwnProfile('vrchat')
    ])
    expect(a).toEqual({ ok: true, profile: profile('vrchat') })
    expect(b).toEqual(a)
    await service.getOwnProfile('vrchat')
    expect(vrc.getOwnProfile).toHaveBeenCalledTimes(1)
    tick(OWN_PROFILE_REREAD_MS)
    await service.getOwnProfile('vrchat')
    expect(vrc.getOwnProfile).toHaveBeenCalledTimes(2)
  })

  it('answers signed out without a request, and maps failures', async () => {
    const { service, vrc, cvr } = setup()
    vrc.signedIn = false
    await expect(service.getOwnProfile('vrchat')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(vrc.getOwnProfile).not.toHaveBeenCalled()
    cvr.readError = new RateLimitError(1_000)
    await expect(service.getOwnProfile('chilloutvr')).resolves.toEqual({
      ok: false,
      reason: 'rate-limited'
    })
    cvr.readError = new NetworkError('down')
    await expect(service.getOwnProfile('chilloutvr')).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('never reuses an answer across a session boundary', async () => {
    const { service, vrc } = setup()
    await service.getOwnProfile('vrchat')
    vrc.generation++
    vrc.current = profile('vrchat', { bio: 'Someone else' })
    await expect(service.getOwnProfile('vrchat')).resolves.toMatchObject({
      ok: true,
      profile: { bio: 'Someone else' }
    })
    expect(vrc.getOwnProfile).toHaveBeenCalledTimes(2)
  })
})

describe('OwnProfileService saves', () => {
  it('sends only the fields that differ from the last read', async () => {
    const { service, vrc } = setup()
    await service.getOwnProfile('vrchat')
    const result = await service.saveOwnProfile('vrchat', {
      bio: 'New bio',
      pronouns: 'they/them',
      status: 'dnd',
      statusText: ''
    })
    expect(vrc.saveOwnProfile).toHaveBeenCalledWith(
      { bio: 'New bio', status: 'dnd' },
      expect.anything()
    )
    expect(result).toEqual({
      ok: true,
      profile: profile('vrchat', { bio: 'New bio', status: 'dnd' })
    })
    // The next open reuses the saved answer instead of reading again.
    await service.getOwnProfile('vrchat')
    expect(vrc.getOwnProfile).toHaveBeenCalledTimes(1)
  })

  it('normalizes text before comparing, so trailing spaces send nothing', async () => {
    const { service, cvr } = setup()
    await service.getOwnProfile('chilloutvr')
    await expect(service.saveOwnProfile('chilloutvr', { bio: '  Old bio \r\n' })).resolves.toEqual({
      ok: true,
      profile: profile('chilloutvr')
    })
    expect(cvr.saveOwnProfile).not.toHaveBeenCalled()
  })

  it('keeps the last read plus what was sent when the reply carries no profile', async () => {
    const { service, cvr } = setup()
    expect(cvr.answers).toBe(false)
    await service.getOwnProfile('chilloutvr')
    await expect(service.saveOwnProfile('chilloutvr', { pronouns: 'she/her' })).resolves.toEqual({
      ok: true,
      profile: profile('chilloutvr', { pronouns: 'she/her' })
    })
  })

  it('refuses status on ChilloutVR, unknown fields and over-long text', async () => {
    const { service, cvr, vrc } = setup()
    for (const [platform, changes] of [
      ['chilloutvr', { status: 'dnd' }],
      ['chilloutvr', { statusText: 'x' }],
      ['vrchat', { displayName: 'x' }],
      ['vrchat', { status: 'offline' }],
      ['vrchat', { bio: 'x'.repeat(513) }],
      ['vrchat', { pronouns: 'x'.repeat(33) }],
      ['vrchat', { statusText: 'x'.repeat(33) }],
      ['vrchat', null]
    ] as const) {
      await expect(service.saveOwnProfile(platform, changes)).resolves.toEqual({
        ok: false,
        reason: 'invalid'
      })
    }
    expect(cvr.saveOwnProfile).not.toHaveBeenCalled()
    expect(vrc.saveOwnProfile).not.toHaveBeenCalled()
  })

  it('allows one Save at a time and 5 s between attempts, failed or not', async () => {
    const { service, vrc, tick } = setup()
    await service.getOwnProfile('vrchat')
    const first = service.saveOwnProfile('vrchat', { bio: 'One' })
    await expect(service.saveOwnProfile('vrchat', { bio: 'Two' })).resolves.toEqual({
      ok: false,
      reason: 'cooldown'
    })
    await first
    await expect(service.saveOwnProfile('vrchat', { bio: 'Two' })).resolves.toMatchObject({
      reason: 'cooldown'
    })
    tick(OWN_PROFILE_SAVE_COOLDOWN_MS)
    vrc.saveError = new NetworkError('down')
    await expect(service.saveOwnProfile('vrchat', { bio: 'Two' })).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    await expect(service.saveOwnProfile('vrchat', { bio: 'Two' })).resolves.toMatchObject({
      reason: 'cooldown'
    })
    expect(vrc.saveOwnProfile).toHaveBeenCalledTimes(2)
  })

  it('reads again after a failed Save, since part of it may have gone through', async () => {
    const { service, cvr } = setup()
    await service.getOwnProfile('chilloutvr')
    cvr.saveError = new NetworkError('down')
    await service.saveOwnProfile('chilloutvr', { bio: 'New', pronouns: 'x' })
    await service.getOwnProfile('chilloutvr')
    expect(cvr.getOwnProfile).toHaveBeenCalledTimes(2)
  })

  it('reads first when the session renewed after the editor opened', async () => {
    const { service, vrc } = setup()
    await service.getOwnProfile('vrchat')
    vrc.generation++
    await service.saveOwnProfile('vrchat', { bio: 'Old bio', pronouns: 'he/him' })
    expect(vrc.getOwnProfile).toHaveBeenCalledTimes(2)
    expect(vrc.saveOwnProfile).toHaveBeenCalledWith({ pronouns: 'he/him' }, expect.anything())
  })

  it('maps a sign-in failure and logs no profile text', async () => {
    const { service, vrc, log } = setup()
    await service.getOwnProfile('vrchat')
    vrc.saveError = new AuthError(undefined, 401)
    await expect(service.saveOwnProfile('vrchat', { bio: 'Secret words' })).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('Secret')
  })

  it('drops an answer that arrives after the session ended', async () => {
    const { service, vrc } = setup()
    await service.getOwnProfile('vrchat')
    vrc.saveOwnProfile.mockImplementationOnce(async () => {
      vrc.generation++
      return profile('vrchat', { bio: 'Late' })
    })
    await expect(service.saveOwnProfile('vrchat', { bio: 'Late' })).resolves.toMatchObject({
      ok: false
    })
  })

  it('forgets a platform at a boundary', async () => {
    const { service, vrc } = setup()
    await service.getOwnProfile('vrchat')
    service.clearPlatform('vrchat')
    await service.getOwnProfile('vrchat')
    expect(vrc.getOwnProfile).toHaveBeenCalledTimes(2)
  })
})
