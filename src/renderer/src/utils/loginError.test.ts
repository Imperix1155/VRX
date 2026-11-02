import { describe, expect, it } from 'vitest'
import { CREDENTIAL_PERSISTENCE_FAILED } from '@shared/types'
import { mapLoginError } from './loginError'

describe('mapLoginError', () => {
  it('maps a rejected credential-store write to the dedicated sign-in error', () => {
    expect(mapLoginError(CREDENTIAL_PERSISTENCE_FAILED)).toBe('login.error.credentialPersistence')
  })

  it('says what went wrong for the failures a user can act on', () => {
    expect({
      invalid_credentials: mapLoginError('invalid_credentials'),
      invalid_2fa_code: mapLoginError('invalid_2fa_code'),
      rate_limited: mapLoginError('rate_limited'),
      http_429: mapLoginError('http_429'),
      network_error: mapLoginError('network_error'),
      http_503: mapLoginError('http_503')
    }).toEqual({
      invalid_credentials: 'login.error.invalidCredentials',
      invalid_2fa_code: 'login.error.invalidCode',
      rate_limited: 'login.error.rateLimited',
      http_429: 'login.error.rateLimited',
      network_error: 'login.error.offline',
      http_503: 'login.error.serviceDown'
    })
  })

  it('uses the generic key for every other login failure, never the raw code', () => {
    expect([
      mapLoginError(),
      mapLoginError('http_404'),
      mapLoginError('bad_response'),
      mapLoginError('SOMETHING_NEW_FROM_API')
    ]).toEqual(Array(4).fill('login.error.unknown'))
  })
})
