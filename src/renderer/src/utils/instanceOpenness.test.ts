import { describe, expect, it } from 'vitest'
import type { InstanceInfo } from '@shared/types'
import { opennessAssessmentFor } from './instanceOpenness'

function instance(
  partial: Partial<InstanceInfo> & { openness: InstanceInfo['openness'] }
): InstanceInfo {
  return {
    worldId: 'wrld_fixture',
    instanceId: 'wrld_fixture:12345~public',
    worldName: 'The Great Pug',
    thumbnailUrl: null,
    type: 'public',
    isGroup: false,
    groupName: null,
    groupId: null,
    groupImageUrl: null,
    region: 'us',
    userCount: 1,
    ...partial
  }
}

describe('opennessAssessmentFor', () => {
  it('non-group public / friends-plus → open', () => {
    expect(opennessAssessmentFor(instance({ openness: 'public' }))).toBe('open')
    expect(opennessAssessmentFor(instance({ openness: 'friends-plus' }))).toBe('open')
  })

  it('non-group friends / invite-plus / invite → closed', () => {
    expect(opennessAssessmentFor(instance({ openness: 'friends' }))).toBe('closed')
    expect(opennessAssessmentFor(instance({ openness: 'invite-plus' }))).toBe('closed')
    expect(opennessAssessmentFor(instance({ openness: 'invite' }))).toBe('closed')
  })

  it('group public / friends-plus → open', () => {
    expect(opennessAssessmentFor(instance({ openness: 'public', isGroup: true }))).toBe('open')
    expect(opennessAssessmentFor(instance({ openness: 'friends-plus', isGroup: true }))).toBe(
      'open'
    )
  })

  it('group members-only → closed', () => {
    expect(opennessAssessmentFor(instance({ openness: 'invite', isGroup: true }))).toBe('closed')
  })

  it('opennessUnknown short-circuits everything to unknown', () => {
    expect(
      opennessAssessmentFor(instance({ openness: 'public', isGroup: false, opennessUnknown: true }))
    ).toBe('unknown')
    expect(
      opennessAssessmentFor(instance({ openness: 'invite', isGroup: true, opennessUnknown: true }))
    ).toBe('unknown')
  })

  it('group offline falls through to unknown rather than guessing closed', () => {
    expect(opennessAssessmentFor(instance({ openness: 'offline', isGroup: true }))).toBe('unknown')
  })

  it('unrecognized values fall through to unknown', () => {
    expect(opennessAssessmentFor(instance({ openness: 'offline' }))).toBe('unknown')
    expect(
      opennessAssessmentFor(
        instance({ openness: 'group-plus' as unknown as InstanceInfo['openness'], isGroup: true })
      )
    ).toBe('unknown')
  })
})
