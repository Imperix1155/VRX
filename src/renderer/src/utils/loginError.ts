/**
 * Map known VRChat login error codes → i18n translation keys.
 * Unknown codes fall back to the generic key (defensive parsing — never surface the raw code).
 *
 * Codes emitted by VrcAdapter:
 *   invalid_credentials  – HTTP 401 on initial auth
 *   network_error        – fetch threw (no connection) on either leg
 *   invalid_2fa_code     – HTTP non-2xx on TOTP/email verify
 *   http_*               – other non-2xx on initial auth  → default
 *   bad_response         – JSON parse failure             → default
 *   unexpected_response  – schema mismatch                → default
 */
export function mapLoginError(code: string): string {
  switch (code) {
    case 'invalid_credentials':
      return 'login.error.invalidCredentials'
    case 'network_error':
      return 'login.error.networkError'
    case 'invalid_2fa_code':
      return 'login.error.invalid2faCode'
    default:
      return 'login.error.unknown'
  }
}
