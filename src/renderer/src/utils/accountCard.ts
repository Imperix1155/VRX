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

export function accountLoginErrorKey(platform: Platform, code: string): string {
  if (code === 'invalid_credentials') return 'settings.accounts.error.invalidCredentials'
  if (code === 'invalid_2fa_code') return 'settings.accounts.error.invalid2faCode'
  if (code === 'network_error') {
    return platform === 'vrchat'
      ? 'settings.accounts.vrchat.error.networkError'
      : 'settings.accounts.chilloutvr.error.networkError'
  }
  return 'settings.accounts.error.unknown'
}
