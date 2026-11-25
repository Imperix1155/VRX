import { describe, expect, it } from 'vitest'
import type { OwnProfile } from '@shared/ownProfile'
import { OwnAlertStatus } from './ownAlertStatus'

function profile(status: OwnProfile['status'], bio = 'Hello'): OwnProfile {
  return { platform: 'vrchat', bio, pronouns: '', status, statusText: '' }
}

describe('OwnAlertStatus', () => {
  it('keeps a newer Do Not Disturb when a bio save republishes the older Online status', () => {
    const held = new OwnAlertStatus()
    const asOf = held.revision()
    held.observeProfile({ profile: profile('online'), asOf })
    held.observe('dnd')
    held.observeProfile({
      profile: profile('online', 'New bio'),
      changes: { bio: 'New bio' },
      asOf: held.revision()
    })
    expect(held.current()).toBe('dnd')
  })

  it('applies a status the save itself changed', () => {
    const held = new OwnAlertStatus()
    held.observe('dnd')
    held.observeProfile({
      profile: profile('online'),
      changes: { status: 'online' },
      asOf: 0
    })
    expect(held.current()).toBe('online')
  })

  it('drops a profile read that started before a live status update', () => {
    const held = new OwnAlertStatus()
    const asOf = held.revision()
    held.observe('dnd')
    held.observeProfile({ profile: profile('online'), asOf })
    expect(held.current()).toBe('dnd')
  })

  it('accepts a profile read that is still current, and never clears on a missing status', () => {
    const held = new OwnAlertStatus()
    held.observeProfile({ profile: profile('ask-me'), asOf: held.revision() })
    expect(held.current()).toBe('ask-me')
    const asOf = held.revision()
    held.observeProfile({ profile: profile(null), asOf })
    expect(held.current()).toBe('ask-me')
  })

  it('ignores ChilloutVR, which has no status', () => {
    const held = new OwnAlertStatus()
    held.observe('dnd')
    held.observeProfile({
      profile: { platform: 'chilloutvr', bio: 'x', pronouns: '', status: null, statusText: null },
      changes: { bio: 'x' },
      asOf: held.revision()
    })
    expect(held.current()).toBe('dnd')
  })
})
