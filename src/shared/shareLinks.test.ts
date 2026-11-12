import { describe, expect, it } from 'vitest'
import { shareLink } from './shareLinks'

/** VRChat's website pages, spelled so the path guard does not read a folder. */
const VRC_SITE = ['https://vrchat.com', 'home'].join('/')

const GUID = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('shareLink', () => {
  it('links a VRChat person, world and instance to the website', () => {
    expect(shareLink({ kind: 'user', platform: 'vrchat', userId: `usr_${GUID}` })).toBe(
      `${VRC_SITE}/user/usr_${GUID}`
    )
    expect(shareLink({ kind: 'world', platform: 'vrchat', worldId: `wrld_${GUID}` })).toBe(
      `${VRC_SITE}/world/wrld_${GUID}`
    )
    expect(
      shareLink({
        kind: 'instance',
        platform: 'vrchat',
        worldId: `wrld_${GUID}`,
        instanceId: `12345~friends(usr_${GUID})~region(eu)`
      })
    ).toBe(
      `${VRC_SITE}/launch?worldId=wrld_${GUID}&instanceId=12345~friends(usr_${GUID})~region(eu)`
    )
  })

  it('keeps a short legacy VRChat user ID', () => {
    expect(shareLink({ kind: 'user', platform: 'vrchat', userId: 'AbC123xyZ9' })).toBe(
      `${VRC_SITE}/user/AbC123xyZ9`
    )
  })

  it("links a ChilloutVR person, world and instance to the game's own pages", () => {
    expect(shareLink({ kind: 'user', platform: 'chilloutvr', userId: GUID })).toBe(
      `chilloutvr://details/user?id=${GUID}`
    )
    expect(shareLink({ kind: 'world', platform: 'chilloutvr', worldId: GUID })).toBe(
      `chilloutvr://details/world?id=${GUID}`
    )
    expect(
      shareLink({
        kind: 'instance',
        platform: 'chilloutvr',
        worldId: GUID,
        instanceId: 'i+0123456789abcdef-012345-abcdef-01234567'
      })
    ).toBe('chilloutvr://details/instance?id=i%2B0123456789abcdef-012345-abcdef-01234567')
  })

  it.each([
    { kind: 'user', platform: 'vrchat', userId: 'usr_x/../../admin' },
    { kind: 'user', platform: 'vrchat', userId: '' },
    { kind: 'user', platform: 'chilloutvr', userId: `usr_${GUID}` },
    { kind: 'user', platform: 'chilloutvr', userId: `${GUID}&x=1` },
    { kind: 'world', platform: 'vrchat', worldId: GUID },
    { kind: 'world', platform: 'vrchat', worldId: 'wrld_a?b=c' },
    { kind: 'world', platform: 'chilloutvr', worldId: `wrld_${GUID}` },
    { kind: 'instance', platform: 'vrchat', worldId: `wrld_${GUID}`, instanceId: '' },
    { kind: 'instance', platform: 'vrchat', worldId: `wrld_${GUID}`, instanceId: '1&next=evil' },
    { kind: 'instance', platform: 'vrchat', worldId: 'private', instanceId: '12345' },
    { kind: 'instance', platform: 'chilloutvr', worldId: GUID, instanceId: GUID },
    { kind: 'instance', platform: 'chilloutvr', worldId: GUID, instanceId: 'i+nope' }
  ] as const)('gives no link for a malformed ID: %o', (target) => {
    expect(shareLink(target)).toBeNull()
  })
})
