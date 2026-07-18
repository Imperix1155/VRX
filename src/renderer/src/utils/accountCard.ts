import type { Platform } from '@shared/types'

export interface AccountCardConfig {
  platform: Platform
  labelKey: string
  tintClass: string
  focusClass: string
  actionClass: string
}

export const ACCOUNT_CARD_CONFIG: Record<Platform, AccountCardConfig> = {
  vrchat: {
    platform: 'vrchat',
    labelKey: 'settings.accounts.vrchat.label',
    tintClass: 'tint-vrc',
    focusClass: 'focus:ring-[var(--vrc)]',
    actionClass:
      'border-[var(--vrc)] bg-[color-mix(in_srgb,var(--vrc)_16%,transparent)] text-[var(--vrc)]'
  },
  chilloutvr: {
    platform: 'chilloutvr',
    labelKey: 'settings.accounts.chilloutvr.label',
    tintClass: 'tint-cvr',
    focusClass: 'focus:ring-[var(--cvr)]',
    actionClass:
      'border-[var(--cvr)] bg-[color-mix(in_srgb,var(--cvr)_16%,transparent)] text-[var(--cvr)]'
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function accountLoginErrorKey(platform: Platform, code: string): string {
  // VRX-36: account connect failures share the same uniform generic message.
  return 'settings.accounts.error.unknown'
}
