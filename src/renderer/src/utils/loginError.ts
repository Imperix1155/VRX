import { CREDENTIAL_PERSISTENCE_FAILED } from '@shared/types'

/** What went wrong, in the words both sign-in surfaces use. */
export type SignInProblem =
  | 'credentialPersistence'
  | 'invalidCredentials'
  | 'invalidCode'
  | 'rateLimited'
  | 'offline'
  | 'serviceDown'
  | 'unknown'

/**
 * Sort a sign-in result code from either platform's adapter (or VRX's own
 * request limit) into what the user can act on. Unknown codes stay `unknown`
 * (defensive parsing: the raw code is never shown).
 *
 *   invalid_credentials        → wrong sign-in details
 *   invalid_2fa_code           → wrong or expired code
 *   rate_limited, http_429     → too many tries; wait
 *   network_error              → no answer (offline, timeout)
 *   http_5xx                   → the platform is not answering
 *   bad_response, unexpected_response, other http_* → unknown
 */
export function signInProblem(code?: string): SignInProblem {
  if (code === CREDENTIAL_PERSISTENCE_FAILED) return 'credentialPersistence'
  if (code === 'invalid_credentials') return 'invalidCredentials'
  if (code === 'invalid_2fa_code') return 'invalidCode'
  if (code === 'rate_limited' || code === 'http_429') return 'rateLimited'
  if (code === 'network_error') return 'offline'
  if (code !== undefined && /^http_5\d\d$/.test(code)) return 'serviceDown'
  return 'unknown'
}

const LOGIN_ERROR_KEYS: Record<SignInProblem, string> = {
  credentialPersistence: 'login.error.credentialPersistence',
  invalidCredentials: 'login.error.invalidCredentials',
  invalidCode: 'login.error.invalidCode',
  rateLimited: 'login.error.rateLimited',
  offline: 'login.error.offline',
  serviceDown: 'login.error.serviceDown',
  unknown: 'login.error.unknown'
}

/** The sign-in screen's message for a result code. */
export function mapLoginError(code?: string): string {
  return LOGIN_ERROR_KEYS[signInProblem(code)]
}
