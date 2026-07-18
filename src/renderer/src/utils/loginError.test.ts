import { describe, expect, it } from 'vitest'
import { mapLoginError } from './loginError'

// Table-pins the code→key contract (VRX-36): every login failure, known or
// unknown, collapses to the single generic key so no raw error code ever
// reaches the user.
describe('mapLoginError', () => {
  it.each([
    ['invalid_credentials', 'login.error.unknown'],
    ['network_error', 'login.error.unknown'],
    ['invalid_2fa_code', 'login.error.unknown'],
    ['http_500', 'login.error.unknown'],
    ['http_403', 'login.error.unknown'],
    ['bad_response', 'login.error.unknown'],
    ['unexpected_response', 'login.error.unknown'],
    ['', 'login.error.unknown'],
    ['SOMETHING_NEW_FROM_API', 'login.error.unknown']
  ])('maps %s → %s', (code, key) => {
    expect(mapLoginError(code)).toBe(key)
  })
})
