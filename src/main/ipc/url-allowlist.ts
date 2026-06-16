/**
 * URL allowlist for shell.openExternal (VRX-20).
 * Only HTTPS URLs with a known host (or subdomain thereof) are permitted.
 * Pure function — no electron imports — so it stays unit-testable.
 */

const ALLOWED_HOSTS = [
  'vrchat.com',
  'vrchat.cloud',
  'abinteractive.net',
  'chilloutvr.net',
  'github.com'
] as const

export function isAllowedUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}
