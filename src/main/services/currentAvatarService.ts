import type { AvatarLibraryFailure, CurrentAvatarResult } from '@shared/avatarLibrary'
import type { Platform } from '@shared/types'
import type { AvatarLibraryAdapter } from './adapters/AvatarLibraryAdapter'
import { AuthError, RateLimitError, RequestQueueFullError } from './adapters/errors'
import { assertRequestLease, type RequestLease } from './adapters/RequestLease'

type CurrentAvatarLog = (
  message: 'current avatar request failed',
  meta: { platform: Platform; reason: AvatarLibraryFailure }
) => void

export interface CurrentAvatarServiceOptions {
  adapters: ReadonlyMap<Platform, AvatarLibraryAdapter>
  log?: CurrentAvatarLog
}

interface Reading {
  lease: RequestLease
  promise: Promise<CurrentAvatarResult>
}

/**
 * The Dashboard's "Wearing now": only the avatar the user wears, one platform
 * request per read (the Avatars page reads the whole library instead). Reads
 * run only when the renderer asks, never on a timer; repeats while one is in
 * flight for the same session share it. Nothing is kept between reads, and a
 * result never adds a switch target to `AvatarLibraryService`.
 */
export class CurrentAvatarService {
  private readonly reading = new Map<Platform, Reading>()
  private readonly log: CurrentAvatarLog

  constructor(private readonly options: CurrentAvatarServiceOptions) {
    this.log = options.log ?? (() => undefined)
  }

  getCurrent(platform: Platform): Promise<CurrentAvatarResult> {
    const adapter = this.options.adapters.get(platform)
    if (!adapter) return Promise.resolve({ ok: false, reason: 'not-authenticated' })
    let lease: RequestLease
    try {
      lease = adapter.captureAvatarLease()
    } catch {
      return Promise.resolve({ ok: false, reason: 'not-authenticated' })
    }
    const existing = this.reading.get(platform)
    if (existing && existing.lease.generation === lease.generation && isLive(existing.lease)) {
      return existing.promise
    }
    const promise = this.read(adapter, lease).finally(() => {
      if (this.reading.get(platform)?.promise === promise) this.reading.delete(platform)
    })
    this.reading.set(platform, { lease, promise })
    return promise
  }

  private async read(
    adapter: AvatarLibraryAdapter,
    lease: RequestLease
  ): Promise<CurrentAvatarResult> {
    const platform = adapter.platform
    try {
      const current = await adapter.getCurrentAvatar(lease)
      assertRequestLease(lease)
      return { ok: true, platform, current }
    } catch (error) {
      const reason: AvatarLibraryFailure =
        error instanceof AuthError
          ? 'not-authenticated'
          : error instanceof RateLimitError || error instanceof RequestQueueFullError
            ? 'rate-limited'
            : 'unavailable'
      this.log('current avatar request failed', { platform, reason })
      return { ok: false, reason }
    }
  }
}

function isLive(lease: RequestLease): boolean {
  return lease.isCurrent() && !lease.signal.aborted
}
