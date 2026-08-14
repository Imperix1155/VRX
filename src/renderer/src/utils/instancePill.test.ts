import { describe, expect, it } from 'vitest'
import { LABEL_SCHEMES } from '@shared/types'
import type { InstanceType, LabelScheme } from '@shared/types'
import { instancePillFor, OPENNESS_TIER } from './instancePill'
import { LABEL_KEYS_BY_SCHEME } from './instanceTypeLabels'

const VRC_TYPES: InstanceType[] = [
  'public',
  'friends-plus',
  'friends',
  'invite-plus',
  'invite',
  'group-public',
  'group-plus',
  'group'
]
const CVR_TYPES: InstanceType[] = [
  'public',
  'friends-of-friends',
  'friends',
  'everyone-can-invite',
  'owner-must-invite',
  'group-public',
  'friends-of-members',
  'members-only',
  'offline'
]

describe('instancePillFor (VRX-244)', () => {
  it.each(LABEL_SCHEMES)(
    'opennessUnknown:true → the neutral Unknown pill for every VRChat type under the %s scheme',
    (scheme: LabelScheme) => {
      for (const type of VRC_TYPES) {
        expect(instancePillFor({ type, opennessUnknown: true }, scheme)).toEqual({
          labelKey: 'friends.instance.type.unknown',
          tier: null
        })
      }
    }
  )

  it.each(LABEL_SCHEMES)(
    'opennessUnknown:true → the neutral Unknown pill for every CVR type under the %s scheme',
    (scheme: LabelScheme) => {
      for (const type of CVR_TYPES) {
        expect(instancePillFor({ type, opennessUnknown: true }, scheme)).toEqual({
          labelKey: 'friends.instance.type.unknown',
          tier: null
        })
      }
    }
  )

  it.each(LABEL_SCHEMES)(
    'opennessUnknown absent → the existing typed label/tier lookup, unchanged (%s scheme)',
    (scheme: LabelScheme) => {
      for (const type of [...VRC_TYPES, ...CVR_TYPES]) {
        expect(instancePillFor({ type }, scheme)).toEqual({
          labelKey: LABEL_KEYS_BY_SCHEME[scheme][type],
          tier: OPENNESS_TIER[type] ?? null
        })
      }
    }
  )

  it('opennessUnknown:false behaves the same as absent', () => {
    expect(instancePillFor({ type: 'public', opennessUnknown: false }, 'vrchat')).toEqual({
      labelKey: 'friends.instance.type.public',
      tier: 'public'
    })
  })

  it('preserves the unrecognized-type fallback (never throws, falls back to unknownWorld)', () => {
    const bogus = 'bogus-type' as unknown as InstanceType
    expect(instancePillFor({ type: bogus }, 'vrchat')).toEqual({
      labelKey: 'friends.instance.unknownWorld',
      tier: null
    })
  })
})
