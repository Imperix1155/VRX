import {
  CREDENTIAL_PERSISTENCE_FAILED,
  SESSION_IMPORT_NOT_FOUND,
  SESSION_IMPORT_REJECTED,
  type Platform
} from '@shared/types'

export interface AccountCardConfig {
  platform: Platform
  labelKey: string
  tintClass: string
  focusClass: string
  actionClass: string
  /** "Use my sign-in from this PC": same place and weight on both platforms. */
  importLabelKey: string
  importHintKey: string
  importNotFoundKey: string
  importRejectedKey: string
}

export const ACCOUNT_CARD_CONFIG: Record<Platform, AccountCardConfig> = {
  vrchat: {
    platform: 'vrchat',
    labelKey: 'settings.accounts.vrchat.label',
    tintClass: 'tint-vrc',
    focusClass: 'focus:ring-[var(--vrc)]',
    actionClass:
      'border-[var(--vrc)] bg-[color-mix(in_srgb,var(--vrc)_16%,transparent)] text-[var(--plat-vrc-word)]',
    importLabelKey: 'settings.accounts.import.vrchat',
    importHintKey: 'settings.accounts.import.vrchatHint',
    importNotFoundKey: 'settings.accounts.error.importNotFoundVrchat',
    importRejectedKey: 'settings.accounts.error.importRejectedVrchat'
  },
  chilloutvr: {
    platform: 'chilloutvr',
    labelKey: 'settings.accounts.chilloutvr.label',
    tintClass: 'tint-cvr',
    focusClass: 'focus:ring-[var(--cvr)]',
    actionClass:
      'border-[var(--cvr)] bg-[color-mix(in_srgb,var(--cvr)_16%,transparent)] text-[var(--plat-cvr-word)]',
    importLabelKey: 'settings.accounts.import.chilloutvr',
    importHintKey: 'settings.accounts.import.chilloutvrHint',
    importNotFoundKey: 'settings.accounts.error.importNotFoundChilloutvr',
    importRejectedKey: 'settings.accounts.error.importRejectedChilloutvr'
  }
}

/** "Use my sign-in from this PC" results name the app VRX looked in, so they
 *  are per platform. Null for every other code. */
export function importErrorKey(platform: Platform, code?: string): string | null {
  if (code === SESSION_IMPORT_NOT_FOUND) return ACCOUNT_CARD_CONFIG[platform].importNotFoundKey
  if (code === SESSION_IMPORT_REJECTED) return ACCOUNT_CARD_CONFIG[platform].importRejectedKey
  return null
}

export function accountLoginErrorKey(platform?: Platform, code?: string): string {
  // The account card keeps its own locale namespace, even though both platforms
  // share this persistence-failure explanation.
  const importKey = platform ? importErrorKey(platform, code) : null
  if (importKey) return importKey
  if (code === CREDENTIAL_PERSISTENCE_FAILED) {
    return 'settings.accounts.error.credentialPersistence'
  }

  return 'settings.accounts.error.unknown'
}
