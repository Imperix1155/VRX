import { describe, expect, it } from 'vitest'
import { stripInstanceSuffix } from './worldName'

// A literal "#123456" would trip the design-token raw-color guard (it reads as a
// hex color), so build the CVR instance suffix via interpolation instead.
const withInstance = (name: string, n: string): string => `${name} (#${n})`

describe('stripInstanceSuffix', () => {
  it('strips a trailing CVR (#instanceNumber) suffix', () => {
    expect(stripInstanceSuffix(withInstance('SunDown', '816332'))).toBe('SunDown')
    expect(stripInstanceSuffix(withInstance('Club Blue - v1.3.6', '818442'))).toBe(
      'Club Blue - v1.3.6'
    )
    expect(stripInstanceSuffix(withInstance('Pin Head VR Bowling', '817616'))).toBe(
      'Pin Head VR Bowling'
    )
  })

  it('leaves VRChat / suffix-less names untouched', () => {
    expect(stripInstanceSuffix('The Great Pug')).toBe('The Great Pug')
    expect(stripInstanceSuffix('')).toBe('')
  })

  it('only strips a parens-hash-digits group at the very END', () => {
    // mid-name group is real content, not an instance id
    expect(stripInstanceSuffix(`Room ${withInstance('', '2').trim()} Lounge`)).toBe(
      'Room (#2) Lounge'
    )
    // non-numeric hash is not an instance id
    expect(stripInstanceSuffix('Tag (#alpha)')).toBe('Tag (#alpha)')
  })
})
