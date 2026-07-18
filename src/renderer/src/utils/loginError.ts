/**
 * Map known VRChat login error codes → i18n translation keys.
 * Unknown codes fall back to the generic key (defensive parsing — never surface the raw code).
 *
 * Codes emitted by VrcAdapter:
 *   invalid_credentials  – HTTP 401 on initial auth
 *   network_error        – fetch threw (no connection) on either leg
 *   invalid_2fa_code     – HTTP non-2xx on TOTP/email verify
 *   http_*               – other non-2xx on initial auth  → generic
 *   bad_response         – JSON parse failure             → generic
 *   unexpected_response  – schema mismatch                → generic
 */
export function mapLoginError(code: string): string {
  // Security AC (VRX-36): all login failures surface one uniform generic message;
  // the code is deliberately unused (kept for signature stability at call sites).
  void code
  return 'login.error.unknown'
}
