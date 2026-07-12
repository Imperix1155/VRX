import { describe, expect, it } from 'vitest'
import { buildCvrJoinUrl } from './buildCvrJoinUrl'

const INSTANCE_ID = 'i+bab275f822c020a0-152002-e81321-1fe976f9'

describe('buildCvrJoinUrl', () => {
  it.each([
    ['desktop', 'false'],
    ['vr', 'true']
  ] as const)('builds the canonical %s URL', (mode, startInVR) => {
    expect(buildCvrJoinUrl(INSTANCE_ID, mode)).toBe(
      `chilloutvr://instance/join?instanceId=i%2Bbab275f822c020a0-152002-e81321-1fe976f9&startInVR=${startInVR}`
    )
  })

  it('percent-encodes the literal plus in the instance id', () => {
    expect(buildCvrJoinUrl(INSTANCE_ID, 'desktop')).toContain('instanceId=i%2B')
  })

  it.each([
    '',
    'i+bab275f822c020a0-152002-e81321-1fe976f',
    'i+bab275f822c020a0-152002-e81321-1fe976f90',
    'i+BAB275F822C020A0-152002-e81321-1fe976f9/evil',
    'i%2Bbab275f822c020a0-152002-e81321-1fe976f9',
    'i+bab275f822c020a0-152002-e81321-1fe976f9&steam=-applaunch',
    `i+${'a'.repeat(2048)}`
  ])('rejects malformed or hostile instance id %j', (value) => {
    expect(buildCvrJoinUrl(value, 'vr')).toBeNull()
  })
})
