import { describe, expect, it } from 'vitest'
import { INBOX_NAME_MAX_LENGTH } from '@shared/inbox'
import { notificationIdOf, parseVrcNotification } from './parseNotification'

describe('parseVrcNotification', () => {
  it('reads the world name from object or string details', () => {
    const base = { id: 'not_1', type: 'invite', senderUserId: 'usr_a', senderUsername: 'Alice' }
    expect(parseVrcNotification({ ...base, details: { worldName: 'Pug' } })?.worldName).toBe('Pug')
    expect(parseVrcNotification({ ...base, details: '{"worldName":"Pug"}' })?.worldName).toBe('Pug')
    expect(parseVrcNotification({ ...base, details: '{broken' })?.worldName).toBeNull()
    expect(parseVrcNotification({ ...base, details: { worldName: 42 } })?.worldName).toBeNull()
  })

  it("reads where an invite leads from the details' location", () => {
    const base = { id: 'not_1', type: 'invite', senderUserId: 'usr_a' }
    const instanceId = '12345~private(usr_0f8fad5b-d9cb-469f-a165-70867728950e)~region(eu)'
    expect(
      parseVrcNotification({ ...base, details: { worldId: `wrld_abc:${instanceId}` } })?.location
    ).toEqual({ worldId: 'wrld_abc', instanceId })
    expect(
      parseVrcNotification({ ...base, details: JSON.stringify({ worldId: 'wrld_abc:77' }) })
        ?.location
    ).toEqual({ worldId: 'wrld_abc', instanceId: '77' })
  })

  it.each([
    undefined,
    42,
    '',
    'wrld_abc',
    'wrld_abc:',
    ':123',
    'private:123',
    'wrld_abc:12 3',
    'wrld_abc:123&x=1',
    'wrld_abc:123#frag',
    'wrld_abc:12%33',
    'wrld_a/b:123',
    `wrld_abc:${'9'.repeat(800)}`
  ])('keeps no location for a malformed one: %s', (worldId) => {
    const entry = parseVrcNotification({
      id: 'not_1',
      type: 'invite',
      senderUserId: 'usr_a',
      details: { worldId, worldName: 'Pug' }
    })
    expect(entry?.worldName).toBe('Pug')
    expect(entry?.location).toBeNull()
  })

  it('keeps no location for an invite request or a friend request', () => {
    for (const type of ['requestInvite', 'friendRequest']) {
      expect(
        parseVrcNotification({
          id: 'not_1',
          type,
          senderUserId: 'usr_a',
          details: { worldId: 'wrld_abc:123' }
        })?.location
      ).toBeUndefined()
    }
  })

  it('names no world for friend requests and invite requests', () => {
    expect(
      parseVrcNotification({
        id: 'not_1',
        type: 'friendRequest',
        senderUserId: 'usr_a',
        details: { worldName: 'Should not show' }
      })?.worldName
    ).toBeNull()
  })

  it('rejects unrelated types, unsafe IDs and prototype keys', () => {
    expect(parseVrcNotification({ id: 'not_1', type: 'message', senderUserId: 'usr_a' })).toBeNull()
    expect(
      parseVrcNotification({ id: 'not_1', type: 'toString', senderUserId: 'usr_a' })
    ).toBeNull()
    expect(parseVrcNotification({ id: 'not 1', type: 'invite', senderUserId: 'usr_a' })).toBeNull()
    expect(
      parseVrcNotification({ id: 'not_1', type: 'invite', senderUserId: 'x'.repeat(200) })
    ).toBeNull()
    expect(parseVrcNotification(null)).toBeNull()
    expect(parseVrcNotification('not_1')).toBeNull()
  })

  it('bounds the sender name and drops a blank one', () => {
    const long = parseVrcNotification({
      id: 'not_1',
      type: 'friendRequest',
      senderUserId: 'usr_a',
      senderUsername: 'n'.repeat(500)
    })
    expect(long?.senderName).toHaveLength(INBOX_NAME_MAX_LENGTH)
    expect(
      parseVrcNotification({
        id: 'not_1',
        type: 'friendRequest',
        senderUserId: 'usr_a',
        senderUsername: '   '
      })?.senderName
    ).toBeNull()
  })
})

describe('notificationIdOf', () => {
  it('reads a bare ID or a response notificationId', () => {
    expect(notificationIdOf('not_1')).toBe('not_1')
    expect(notificationIdOf({ notificationId: 'not_2', responseId: 'not_3' })).toBe('not_2')
    expect(notificationIdOf({ id: 'not_2' })).toBeNull()
    expect(notificationIdOf('')).toBeNull()
    expect(notificationIdOf(7)).toBeNull()
  })
})
