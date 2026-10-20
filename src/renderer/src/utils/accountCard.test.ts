import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_PERSISTENCE_FAILED,
  SESSION_IMPORT_NOT_FOUND,
  SESSION_IMPORT_REJECTED
} from '@shared/types'
import { accountLoginErrorKey, importErrorKey } from './accountCard'

describe('accountLoginErrorKey', () => {
  it('maps a rejected credential-store write to the dedicated account error', () => {
    expect(accountLoginErrorKey('vrchat', CREDENTIAL_PERSISTENCE_FAILED)).toBe(
      'settings.accounts.error.credentialPersistence'
    )
  })

  it('uses the generic key for every other account connection failure', () => {
    expect([
      accountLoginErrorKey('vrchat'),
      accountLoginErrorKey('chilloutvr', 'invalid_credentials'),
      accountLoginErrorKey('vrchat', 'SOMETHING_NEW_FROM_API')
    ]).toEqual([
      'settings.accounts.error.unknown',
      'settings.accounts.error.unknown',
      'settings.accounts.error.unknown'
    ])
  })

  it('names where VRX looked for each platform when a PC sign-in import fails', () => {
    expect([
      accountLoginErrorKey('vrchat', SESSION_IMPORT_NOT_FOUND),
      accountLoginErrorKey('chilloutvr', SESSION_IMPORT_NOT_FOUND),
      accountLoginErrorKey('vrchat', SESSION_IMPORT_REJECTED),
      accountLoginErrorKey('chilloutvr', SESSION_IMPORT_REJECTED)
    ]).toEqual([
      'settings.accounts.error.importNotFoundVrchat',
      'settings.accounts.error.importNotFoundChilloutvr',
      'settings.accounts.error.importRejectedVrchat',
      'settings.accounts.error.importRejectedChilloutvr'
    ])
    expect(importErrorKey('vrchat', 'invalid_credentials')).toBeNull()
  })
})
