import { describe, expect, it, vi } from 'vitest'
import type { AvatarItem } from '@shared/avatarLibrary'
import { AVATAR_SWITCH_COOLDOWN_MS } from '@shared/avatarLibrary'
import type { Platform } from '@shared/types'
import type { AvatarLibraryAdapter } from './adapters/AvatarLibraryAdapter'
import { AuthError, NetworkError, RateLimitError } from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import { AvatarLibraryService } from './avatarLibraryService'

const VRC_A = 'avtr_5a3c1e2d-0000-4000-8000-000000000001'
const VRC_B = 'avtr_5a3c1e2d-0000-4000-8000-000000000002'
const VRC_PUBLIC = 'avtr_5a3c1e2d-0000-4000-8000-000000000009'
const CVR_A = 'b81d5892-5119-4f44-b473-7bf4ffda0458'

function item(platform: Platform, avatarId: string, extra: Partial<AvatarItem> = {}): AvatarItem {
  return {
    platform,
    avatarId,
    name: avatarId.slice(-4),
    description: null,
    imageUrl: null,
    authorName: null,
    visibility: null,
    createdAt: null,
    updatedAt: null,
    ...extra
  }
}

class FakeAdapter implements AvatarLibraryAdapter {
  generation = 1
  signedIn = true
  own: AvatarItem[] = []
  current: AvatarItem | null = null
  currentError: Error | null = null
  listError: Error | null = null
  details: AvatarItem | null = null
  switchError: Error | null = null
  readonly getOwnAvatars = vi.fn(async (lease: RequestLease) => {
    void lease
    await Promise.resolve()
    if (this.listError) throw this.listError
    return { avatars: this.own, complete: true }
  })
  readonly getCurrentAvatar = vi.fn(async () => {
    if (this.currentError) throw this.currentError
    return this.current
  })
  readonly getAvatarDetails = vi.fn(async () => this.details)
  readonly switchAvatar = vi.fn(async () => {
    if (this.switchError) throw this.switchError
  })

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
  cvr: FakeAdapter
  service: AvatarLibraryService
  now: { value: number }
} {
  const vrc = new FakeAdapter('vrchat')
  const cvr = new FakeAdapter('chilloutvr')
  const now = { value: 0 }
  const service = new AvatarLibraryService({
    adapters: new Map<Platform, AvatarLibraryAdapter>([
      ['vrchat', vrc],
      ['chilloutvr', cvr]
    ]),
    clock: () => now.value
  })
  return { vrc, cvr, service, now }
}

describe('AvatarLibraryService', () => {
  it('lists own avatars newest change first with the worn avatar, and coalesces reads', async () => {
    const { vrc, service } = setup()
    vrc.own = [
      item('vrchat', VRC_A, { updatedAt: '2026-01-01T00:00:00.000Z' }),
      item('vrchat', VRC_B, { updatedAt: '2026-05-01T00:00:00.000Z' })
    ]
    vrc.current = item('vrchat', VRC_A)
    const [first, second] = await Promise.all([
      service.getLibrary('vrchat'),
      service.getLibrary('vrchat')
    ])
    expect(first).toBe(second)
    expect(vrc.getOwnAvatars).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject({
      ok: true,
      complete: true,
      avatars: [{ avatarId: VRC_B }, { avatarId: VRC_A }],
      // The owned record wins over the thinner current-avatar reply.
      current: { avatarId: VRC_A, updatedAt: '2026-01-01T00:00:00.000Z' }
    })
  })

  it('switches only to an avatar it listed for the current session', async () => {
    const { vrc, service } = setup()
    vrc.own = [item('vrchat', VRC_A)]
    vrc.current = item('vrchat', VRC_PUBLIC)
    await service.getLibrary('vrchat')
    expect(await service.switchAvatar('vrchat', VRC_B)).toEqual({
      ok: false,
      reason: 'unknown-avatar'
    })
    expect(await service.switchAvatar('vrchat', 'not-an-id')).toEqual({
      ok: false,
      reason: 'unknown-avatar'
    })
    expect(vrc.switchAvatar).not.toHaveBeenCalled()
    // A listed session refuses unknown IDs without reading the list again.
    expect(vrc.getOwnAvatars).toHaveBeenCalledTimes(1)
    expect(await service.switchAvatar('vrchat', VRC_A)).toEqual({ ok: true })
    expect(vrc.switchAvatar).toHaveBeenCalledWith(VRC_A, expect.anything())
  })

  it('reads the list once before a switch the session has not listed yet', async () => {
    const { vrc, service } = setup()
    vrc.own = [item('vrchat', VRC_A)]
    // The renderer may still show a library loaded earlier in the session.
    expect(await service.switchAvatar('vrchat', VRC_A)).toEqual({ ok: true })
    expect(vrc.getOwnAvatars).toHaveBeenCalledTimes(1)
    expect(vrc.switchAvatar).toHaveBeenCalledWith(VRC_A, expect.anything())
  })

  it('makes at most one implicit read per session, whatever its outcome', async () => {
    const { vrc, service } = setup()
    vrc.listError = new NetworkError('offline')
    expect(await service.switchAvatar('vrchat', VRC_A)).toEqual({
      ok: false,
      reason: 'unknown-avatar'
    })
    expect(await service.getDetails('vrchat', VRC_A)).toEqual({
      ok: false,
      reason: 'unknown-avatar'
    })
    expect(await service.switchAvatar('vrchat', VRC_B)).toEqual({
      ok: false,
      reason: 'unknown-avatar'
    })
    expect(vrc.getOwnAvatars).toHaveBeenCalledTimes(1)
    expect(vrc.switchAvatar).not.toHaveBeenCalled()
  })

  it('waits for an in-flight list instead of refusing a switch', async () => {
    const { vrc, service } = setup()
    vrc.own = [item('vrchat', VRC_A)]
    const listing = service.getLibrary('vrchat')
    const switching = service.switchAvatar('vrchat', VRC_A)
    expect(await switching).toEqual({ ok: true })
    await listing
    expect(vrc.getOwnAvatars).toHaveBeenCalledTimes(1)
  })

  it('reads the worn avatar alongside the list, not after it', async () => {
    const { vrc, service } = setup()
    vrc.own = [item('vrchat', VRC_A)]
    vrc.current = item('vrchat', VRC_A)
    const order: string[] = []
    vrc.getOwnAvatars.mockImplementationOnce(async () => {
      order.push('list-start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('list-end')
      return { avatars: vrc.own, complete: true }
    })
    vrc.getCurrentAvatar.mockImplementationOnce(async () => {
      order.push('current-start')
      return vrc.current
    })
    expect(await service.getLibrary('vrchat')).toMatchObject({
      ok: true,
      current: { avatarId: VRC_A }
    })
    expect(order.indexOf('current-start')).toBeLessThan(order.indexOf('list-end'))
  })

  it('a sign-in failure on the worn-avatar read still fails the whole read', async () => {
    const { vrc, service } = setup()
    vrc.own = [item('vrchat', VRC_A)]
    vrc.currentError = new AuthError()
    expect(await service.getLibrary('vrchat')).toEqual({ ok: false, reason: 'not-authenticated' })
  })

  it('forgets listed avatars when the session changes', async () => {
    const { vrc, service } = setup()
    vrc.own = [item('vrchat', VRC_A)]
    await service.getLibrary('vrchat')
    vrc.generation = 2
    // The new session's own list decides: an avatar no longer listed is refused.
    vrc.own = [item('vrchat', VRC_B)]
    expect(await service.switchAvatar('vrchat', VRC_A)).toEqual({
      ok: false,
      reason: 'unknown-avatar'
    })
    expect(vrc.getOwnAvatars).toHaveBeenCalledTimes(2)
    expect(vrc.switchAvatar).not.toHaveBeenCalled()
    vrc.signedIn = false
    expect(await service.getLibrary('vrchat')).toEqual({ ok: false, reason: 'not-authenticated' })
    expect(await service.switchAvatar('vrchat', VRC_A)).toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
  })

  it('clearPlatform drops one platform only', async () => {
    const { vrc, cvr, service } = setup()
    vrc.own = [item('vrchat', VRC_A)]
    cvr.own = [item('chilloutvr', CVR_A)]
    await service.getLibrary('vrchat')
    await service.getLibrary('chilloutvr')
    service.clearPlatform('vrchat')
    expect(await service.switchAvatar('vrchat', VRC_A)).toEqual({ ok: true })
    // VRChat read its list again for the fresh state; ChilloutVR kept its own.
    expect(vrc.getOwnAvatars).toHaveBeenCalledTimes(2)
    expect(await service.switchAvatar('chilloutvr', CVR_A.toUpperCase())).toEqual({ ok: true })
    expect(cvr.getOwnAvatars).toHaveBeenCalledTimes(1)
  })

  it('spaces switches by the cooldown and allows one at a time', async () => {
    const { vrc, service, now } = setup()
    vrc.own = [item('vrchat', VRC_A), item('vrchat', VRC_B)]
    await service.getLibrary('vrchat')
    const first = service.switchAvatar('vrchat', VRC_A)
    expect(await service.switchAvatar('vrchat', VRC_B)).toEqual({ ok: false, reason: 'cooldown' })
    expect(await first).toEqual({ ok: true })
    now.value = AVATAR_SWITCH_COOLDOWN_MS - 1
    expect(await service.switchAvatar('vrchat', VRC_B)).toEqual({ ok: false, reason: 'cooldown' })
    now.value = AVATAR_SWITCH_COOLDOWN_MS
    expect(await service.switchAvatar('vrchat', VRC_B)).toEqual({ ok: true })
    expect(vrc.switchAvatar).toHaveBeenCalledTimes(2)
  })

  it('maps failures to typed reasons without detail', async () => {
    const { vrc, service } = setup()
    vrc.listError = new RateLimitError(1_000)
    expect(await service.getLibrary('vrchat')).toEqual({ ok: false, reason: 'rate-limited' })
    vrc.listError = new AuthError(undefined, 401)
    expect(await service.getLibrary('vrchat')).toEqual({ ok: false, reason: 'not-authenticated' })
    vrc.listError = new NetworkError('HTTP 500')
    expect(await service.getLibrary('vrchat')).toEqual({ ok: false, reason: 'unavailable' })

    vrc.listError = null
    vrc.own = [item('vrchat', VRC_A)]
    await service.getLibrary('vrchat')
    vrc.switchError = new NetworkError('HTTP 500')
    expect(await service.switchAvatar('vrchat', VRC_A)).toEqual({
      ok: false,
      reason: 'switch-failed'
    })
    // A failed attempt still starts the cooldown, so a retry is not sooner.
    vrc.switchError = null
    expect(await service.switchAvatar('vrchat', VRC_A)).toEqual({ ok: false, reason: 'cooldown' })
    expect(vrc.switchAvatar).toHaveBeenCalledTimes(1)
  })

  it('keeps the list when only the worn-avatar read fails, but not on sign-in failures', async () => {
    const { vrc, service } = setup()
    vrc.own = [item('vrchat', VRC_A)]
    vrc.currentError = new NetworkError('HTTP 500')
    expect(await service.getLibrary('vrchat')).toMatchObject({ ok: true, current: null })
    vrc.currentError = new AuthError(undefined, 401)
    expect(await service.getLibrary('vrchat')).toEqual({ ok: false, reason: 'not-authenticated' })
  })

  it('reads details only when the list lacked them, and caches them', async () => {
    const { vrc, cvr, service } = setup()
    vrc.own = [item('vrchat', VRC_A, { visibility: 'private' })]
    await service.getLibrary('vrchat')
    expect(await service.getDetails('vrchat', VRC_A)).toMatchObject({ ok: true })
    expect(vrc.getAvatarDetails).not.toHaveBeenCalled()

    cvr.own = [item('chilloutvr', CVR_A, { imageUrl: 'https://files.abidata.io/a.png' })]
    cvr.details = item('chilloutvr', CVR_A, {
      visibility: 'public',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    await service.getLibrary('chilloutvr')
    const first = await service.getDetails('chilloutvr', CVR_A)
    expect(first).toEqual({
      ok: true,
      avatar: expect.objectContaining({
        visibility: 'public',
        imageUrl: 'https://files.abidata.io/a.png'
      })
    })
    await service.getDetails('chilloutvr', CVR_A)
    expect(cvr.getAvatarDetails).toHaveBeenCalledTimes(1)
    expect(await service.getDetails('chilloutvr', 'c81d5892-5119-4f44-b473-7bf4ffda0458')).toEqual({
      ok: false,
      reason: 'unknown-avatar'
    })
  })
})
