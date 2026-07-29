import { describe, expect, it } from 'vitest'
import { mapLoginError } from './loginError'

describe('mapLoginError', () => {
  it('uses the uniform generic key for every login failure', () => {
    expect([mapLoginError('invalid_credentials'), mapLoginError('SOMETHING_NEW_FROM_API')]).toEqual(
      ['login.error.unknown', 'login.error.unknown']
    )
  })
})
