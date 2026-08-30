import { describe, expect, it } from 'vitest'
import { CREDENTIAL_PERSISTENCE_FAILED } from '@shared/types'
import { accountLoginErrorKey } from './accountCard'

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
})
