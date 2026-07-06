import { describe, expect, it } from 'vitest'
import { extractCvrPlatformUserId } from './cvrPlatformUserId'

describe('extractCvrPlatformUserId (VRX-61)', () => {
  it('normalizes valid CVR GUIDs by trimming and lowercasing', () => {
    expect(extractCvrPlatformUserId('  AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE  ')).toEqual({
      ok: true,
      platformUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    })
  })

  it.each([
    ['00000000-0000-0000-0000-000000000000'],
    ['12345678-90ab-cdef-1234-567890abcdef'],
    ['ffffffff-ffff-ffff-ffff-ffffffffffff']
  ])('accepts GUID shape %s', (id) => {
    expect(extractCvrPlatformUserId(id)).toEqual({ ok: true, platformUserId: id })
  })

  it.each(['', '   ', '\n\t'])('flags empty ids after trimming', (id) => {
    expect(extractCvrPlatformUserId(id)).toEqual({ ok: false, reason: 'empty' })
  })

  it.each([
    'not-a-guid',
    '1234567890ab-cdef-1234-567890abcdef',
    '12345678-90ab-cdef-1234-567890abcde',
    '12345678-90ab-cdef-1234-567890abcdef00',
    '12345678_90ab_cdef_1234_567890abcdef',
    '12345678-90ab-cdef-1234-567890abcdeg',
    '{12345678-90ab-cdef-1234-567890abcdef}',
    'usr_12345678'
  ])('flags malformed GUIDs: %s', (id) => {
    expect(extractCvrPlatformUserId(id)).toEqual({ ok: false, reason: 'malformed' })
  })
})
