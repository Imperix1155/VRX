import { describe, expect, it } from 'vitest'
import { formatCount, regionLabelKey } from './exploreFormat'

describe('formatCount', () => {
  it('groups digits for the UI language', () => {
    expect(formatCount(12345, 'en')).toBe('12,345')
    expect(formatCount(12345, 'ja')).toBe('12,345')
    expect(formatCount(7, undefined)).toBe('7')
  })
})

describe('regionLabelKey', () => {
  it('names the known VRChat region codes', () => {
    expect(regionLabelKey('vrchat', 'us')).toBe('explore.region.usWest')
    expect(regionLabelKey('vrchat', 'usw')).toBe('explore.region.usWest')
    expect(regionLabelKey('vrchat', 'use')).toBe('explore.region.usEast')
    expect(regionLabelKey('vrchat', 'EU')).toBe('explore.region.europe')
    expect(regionLabelKey('vrchat', 'jp')).toBe('explore.region.japan')
  })

  it('hides unknown or missing codes instead of showing them raw', () => {
    expect(regionLabelKey('vrchat', 'mars')).toBeNull()
    expect(regionLabelKey('chilloutvr', 'use')).toBeNull()
    expect(regionLabelKey('chilloutvr', null)).toBeNull()
  })

  it('names plain ChilloutVR country and continent codes', () => {
    expect(regionLabelKey('chilloutvr', 'eu')).toBe('explore.region.europe')
    expect(regionLabelKey('chilloutvr', 'us')).toBe('explore.region.us')
  })
})
