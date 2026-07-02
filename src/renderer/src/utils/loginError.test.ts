import { describe, expect, it } from 'vitest'
import { mapLoginError } from './loginError'

// Table-pins the code→key contract (2026-07 audit W6): known codes map to their
// specific message; EVERYTHING else — including raw http_* codes — collapses to
// the generic key so no raw error code ever reaches the user.
describe('mapLoginError', () => {
  it.each([
    ['invalid_credentials', 'login.error.invalidCredentials'],
    ['network_error', 'login.error.networkError'],
    ['invalid_2fa_code', 'login.error.invalid2faCode'],
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
