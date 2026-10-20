import { describe, expect, it } from 'vitest'
import { inPlatformOrder } from './platformOrder'

describe('inPlatformOrder', () => {
  it('lists VRChat before ChilloutVR whatever order the items arrive in', () => {
    const cvrFirst = [
      { platform: 'chilloutvr' as const, id: 'c' },
      { platform: 'vrchat' as const, id: 'v' }
    ]
    expect(inPlatformOrder(cvrFirst).map((item) => item.id)).toEqual(['v', 'c'])
    expect(inPlatformOrder([...cvrFirst].reverse()).map((item) => item.id)).toEqual(['v', 'c'])
  })

  it('returns a copy and leaves the input untouched', () => {
    const input = [{ platform: 'chilloutvr' as const }, { platform: 'vrchat' as const }]
    expect(inPlatformOrder(input)).not.toBe(input)
    expect(input.at(0)?.platform).toBe('chilloutvr')
  })
})
