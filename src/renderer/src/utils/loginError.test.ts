import { describe, expect, it } from 'vitest'
import { CREDENTIAL_PERSISTENCE_FAILED } from '@shared/types'
import { mapLoginError } from './loginError'

describe('mapLoginError', () => {
  it('maps a rejected credential-store write to the dedicated sign-in error', () => {
    expect(mapLoginError(CREDENTIAL_PERSISTENCE_FAILED)).toBe('login.error.credentialPersistence')
  })

  it('uses the generic key for every other login failure', () => {
    expect([
      mapLoginError(),
      mapLoginError('invalid_credentials'),
      mapLoginError('SOMETHING_NEW_FROM_API')
    ]).toEqual(['login.error.unknown', 'login.error.unknown', 'login.error.unknown'])
  })
})
