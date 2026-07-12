import type { Platform } from '@shared/types'

export interface ResolvedAccountSession {
  readonly accountKey: string
  readonly epoch: number
  readonly ready: true
}

export type AccountSessionResolution =
  ResolvedAccountSession | Readonly<{ status: 'no-active' | 'resolving' }>

interface PlatformSession {
  identity: string | null
  epoch: number
  ready: boolean
  hasResolvedIdentity: boolean
}

const PLATFORM_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const PLATFORM_ACCOUNT_ID_MAX_LENGTH = 128

/**
 * Main-process registry of the identity currently authenticated per platform.
 * During `onSessionBoundary`, AccountSession never answers the outgoing account.
 */
export class AccountSession {
  private readonly sessions: Record<Platform, PlatformSession> = {
    vrchat: { identity: null, epoch: 0, ready: false, hasResolvedIdentity: false },
    chilloutvr: { identity: null, epoch: 0, ready: false, hasResolvedIdentity: false }
  }

  getAccountId(platform: Platform): string | null {
    return this.sessions[platform].identity
  }

  setIdentity(platform: Platform, platformAccountId: string | null): void {
    if (platformAccountId !== null) accountKey(platform, platformAccountId)
    const session = this.sessions[platform]
    if (session.identity === platformAccountId) return

    session.identity = platformAccountId
    session.epoch += 1
    session.ready = platformAccountId !== null
    if (platformAccountId !== null) session.hasResolvedIdentity = true
  }

  resolve(platform: Platform): AccountSessionResolution {
    const session = this.sessions[platform]
    if (!session.ready || session.identity === null) {
      return Object.freeze({
        status: session.hasResolvedIdentity ? ('resolving' as const) : ('no-active' as const)
      })
    }

    return Object.freeze({
      accountKey: accountKey(platform, session.identity),
      epoch: session.epoch,
      ready: true as const
    })
  }
}

/** Stable namespace for account-scoped data; the account id is identity, not a credential key. */
export function accountKey(platform: Platform, platformAccountId: string): string {
  if (!isPlatformAccountId(platformAccountId)) throw new Error('invalid platformAccountId')
  return `${platform}:${platformAccountId}`
}

export function isPlatformAccountId(platformAccountId: string): boolean {
  return (
    platformAccountId.length <= PLATFORM_ACCOUNT_ID_MAX_LENGTH &&
    PLATFORM_ACCOUNT_ID_PATTERN.test(platformAccountId)
  )
}
