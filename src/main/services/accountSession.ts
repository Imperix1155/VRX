import type { Platform } from '@shared/types'

/** Main-process registry of the identity currently authenticated per platform. */
export class AccountSession {
  private readonly identities: Record<Platform, string | null> = {
    vrchat: null,
    chilloutvr: null
  }

  getAccountId(platform: Platform): string | null {
    return this.identities[platform]
  }

  setIdentity(platform: Platform, accountId: string | null): void {
    this.identities[platform] = accountId
  }
}

/** Stable namespace for account-scoped data; the account id is identity, not a credential key. */
export function accountKey(platform: Platform, accountId: string): string {
  if (accountId.trim() === '') throw new Error('accountId must not be empty')
  return `${platform}:${accountId}`
}
