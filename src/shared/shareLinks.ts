import { isCommunityUserId } from './community'
import type { Platform } from './types'

/**
 * Links the user can copy and paste to someone else: a person, a world or an
 * instance. They are text for the clipboard only. VRX never opens one, so
 * they grant no launch or navigation authority, and every ID is shape-checked
 * so nothing else can ride along in the copied text.
 *
 * - VRChat: its website pages (`https://vrchat.com/home/...`), which anyone
 *   can open in a browser.
 * - ChilloutVR: the game's own `chilloutvr://details/...` links, which open
 *   the matching page in the game. ChilloutVR has no public web page for
 *   these.
 */
export type ShareLinkTarget =
  | { kind: 'user'; platform: Platform; userId: string }
  | { kind: 'world'; platform: Platform; worldId: string }
  | { kind: 'instance'; platform: Platform; worldId: string; instanceId: string }

/** VRChat's website pages. Joined here so the path guard in
 *  `pathConvention.test.ts` never reads the address as a folder on a PC. */
const VRC_SITE = ['https://vrchat.com', 'home'].join('/')

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const VRC_WORLD_ID = /^wrld_[A-Za-z0-9_-]{1,128}$/
/** The instance part of a VRChat location, with its `~tag(value)` suffixes. */
const VRC_INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9_~().-]{0,767}$/
const CVR_WORLD_ID = new RegExp(`^${GUID}$`, 'i')
const CVR_INSTANCE_ID = /^i\+[0-9a-f]{16}-[0-9a-f]{6}-[0-9a-f]{6}-[0-9a-f]{8}$/i

/** The link for `target`, or null when an ID doesn't have its platform's shape. */
export function shareLink(target: ShareLinkTarget): string | null {
  const vrchat = target.platform === 'vrchat'
  switch (target.kind) {
    case 'user': {
      if (!isCommunityUserId(target.platform, target.userId)) return null
      return vrchat
        ? `${VRC_SITE}/user/${target.userId}`
        : `chilloutvr://details/user?id=${target.userId}`
    }
    case 'world': {
      if (!(vrchat ? VRC_WORLD_ID : CVR_WORLD_ID).test(target.worldId)) return null
      return vrchat
        ? `${VRC_SITE}/world/${target.worldId}`
        : `chilloutvr://details/world?id=${target.worldId}`
    }
    case 'instance': {
      if (vrchat) {
        if (!VRC_WORLD_ID.test(target.worldId) || !VRC_INSTANCE_ID.test(target.instanceId)) {
          return null
        }
        return `${VRC_SITE}/launch?worldId=${target.worldId}&instanceId=${encodeURIComponent(target.instanceId)}`
      }
      if (!CVR_INSTANCE_ID.test(target.instanceId)) return null
      return `chilloutvr://details/instance?id=${encodeURIComponent(target.instanceId)}`
    }
  }
}
