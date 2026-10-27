import { describe, expect, it, vi } from 'vitest'
import type { AvatarItem } from '@shared/avatarLibrary'
import type { Platform } from '@shared/types'
import type { AvatarLibraryAdapter } from './adapters/AvatarLibraryAdapter'
import { AuthError, NetworkError, RateLimitError } from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import { CurrentAvatarService } from './currentAvatarService'

const VRC_A = 'avtr_5a3c1e2d-0000-4000-8000-000000000001'

function item(platform: Platform, avatarId: string): AvatarItem {
  return {
    platform,
    avatarId,
    name: 'Lumen Fox',
    description: null,
    imageUrl: null,
    authorName: null,
    visibility: null,
    createdAt: null,
    updatedAt: null
  }
}

class FakeAdapter implements AvatarLibraryAdapter {
  generation = 1
  signedIn = true
  current: AvatarItem | null = null
  error: Error | null = null
  release: (() => void) | null = null
  readonly getOwnAvatars = vi.fn(async () => ({ avatars: [], complete: true }))
  readonly getCurrentAvatar = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    if (this.error) throw this.error
    return this.current
  })
  readonly getAvatarDetails = vi.fn(async () => null)
  readonly switchAvatar = vi.fn(async () => undefined)

  constructor(readonly platform: Platform) {}

  captureAvatarLease(): RequestLease {
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
  service: CurrentAvatarService
  log: ReturnType<typeof vi.fn>
} {
  const vrc = new FakeAdapter('vrchat')
  const log = vi.fn()
  const service = new CurrentAvatarService({
    adapters: new Map<Platform, AvatarLibraryAdapter>([['vrchat', vrc]]),
    log
  })
  return { vrc, service, log }
}

async function settle(adapter: FakeAdapter): Promise<void> {
  await vi.waitFor(() => expect(adapter.release).not.toBeNull())
  adapter.release!()
  adapter.release = null
}

describe('CurrentAvatarService', () => {
  it('reads only the worn avatar, never the uploads list', async () => {
    const { vrc, service } = setup()
    vrc.current = item('vrchat', VRC_A)
    const pending = service.getCurrent('vrchat')
    await settle(vrc)
    await expect(pending).resolves.toEqual({ ok: true, platform: 'vrchat', current: vrc.current })
    expect(vrc.getCurrentAvatar).toHaveBeenCalledTimes(1)
    expect(vrc.getOwnAvatars).not.toHaveBeenCalled()
  })

  it('shares one in-flight read and reads again once it finished', async () => {
    const { vrc, service } = setup()
    const first = service.getCurrent('vrchat')
    const second = service.getCurrent('vrchat')
    expect(second).toBe(first)
    await settle(vrc)
    await first
    const third = service.getCurrent('vrchat')
    await settle(vrc)
    await third
    expect(vrc.getCurrentAvatar).toHaveBeenCalledTimes(2)
  })

  it('never hands an old session reply to a new account', async () => {
    const { vrc, service } = setup()
    vrc.current = item('vrchat', VRC_A)
    const old = service.getCurrent('vrchat')
    await vi.waitFor(() => expect(vrc.release).not.toBeNull())
    const oldRelease = vrc.release!
    vrc.release = null
    vrc.generation = 2
    const fresh = service.getCurrent('vrchat')
    expect(fresh).not.toBe(old)
    oldRelease()
    await expect(old).resolves.toEqual({ ok: false, reason: 'unavailable' })
    await settle(vrc)
    await expect(fresh).resolves.toMatchObject({ ok: true })
  })

  it('answers not-authenticated without a request when signed out or unknown', async () => {
    const { vrc, service } = setup()
    vrc.signedIn = false
    await expect(service.getCurrent('vrchat')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    await expect(service.getCurrent('chilloutvr')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(vrc.getCurrentAvatar).not.toHaveBeenCalled()
  })

  it.each([
    [new AuthError(), 'not-authenticated'],
    [new RateLimitError(60_000), 'rate-limited'],
    [new NetworkError('offline'), 'unavailable']
  ] as const)('types a failure as %s', async (error, reason) => {
    const { vrc, service, log } = setup()
    vrc.error = error
    const pending = service.getCurrent('vrchat')
    await settle(vrc)
    await expect(pending).resolves.toEqual({ ok: false, reason })
    expect(log).toHaveBeenCalledWith('current avatar request failed', {
      platform: 'vrchat',
      reason
    })
  })
})
