import type { JoinMode } from '@shared/types'

/** Documented CVR instance-id shape; keep the literal `+` at this boundary. */
export const CVR_INSTANCE_ID_RE = /^i\+[0-9a-f]{16}-[0-9a-f]{6}-[0-9a-f]{6}-[0-9a-f]{8}$/i

/** Build the documented ChilloutVR deep link, or null for any malformed id. */
export function buildCvrJoinUrl(instanceId: string, mode: JoinMode): string | null {
  if (!CVR_INSTANCE_ID_RE.test(instanceId)) return null
  return `chilloutvr://instance/join?instanceId=${encodeURIComponent(instanceId)}&startInVR=${mode === 'vr'}`
}
